import { spawn } from 'node:child_process';
import { access, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CREDENTIALS_FILE, loadCredentials, saveServiceCredentials } from './connections/credentials';
import { createTerminalIO, runSetup, toAscii, type SetupIO } from './setup';
import { JsonStore } from './store';

const SPOTIFY_ID = '0123456789abcdef0123456789abcdef';
const OTHER_SPOTIFY_ID = 'fedcba9876543210fedcba9876543210';
const TIDAL_ID = 'Tidal_Client-123';
const OTHER_TIDAL_ID = 'Other_Tidal-456';
/** A TIDAL Client Secret: it must never appear in anything the wizard prints. */
const TIDAL_SECRET = 'tidal-secret-9f8e7d6c5b4a3';
/** Looks like a Client secret / token a person might paste into the wrong place. */
const SECRETISH = 'sk_live_SECRETISH_9f8e7d6c5b4a';

let dir: string;
let store: JsonStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'headunit-setup-'));
  store = new JsonStore(dir);
});
afterEach(async () => {
  vi.restoreAllMocks();
  await rm(dir, { recursive: true, force: true });
});

/** A scripted terminal: answers come from `lines` (null/exhausted = input ended). Everything printed is recorded. */
function scripted(lines: Array<string | null> = []) {
  const queue = [...lines];
  const out: string[] = [];
  const err: string[] = [];
  const asked: string[] = [];
  const io: SetupIO = {
    prompt: async (question) => {
      asked.push(question);
      out.push(question);
      return queue.shift() ?? null;
    },
    print: (line = '') => void out.push(line),
    error: (line) => void err.push(line),
  };
  return {
    io,
    asked,
    err,
    /** Everything the user would have seen, prompts included. */
    text: () => [...out, ...err].join('\n'),
    unusedAnswers: () => queue.length,
  };
}

interface RunOptions {
  lines?: Array<string | null>;
  env?: Record<string, string | undefined>;
  port?: number;
  store?: JsonStore;
}
async function run(argv: string[], options: RunOptions = {}) {
  const term = scripted(options.lines);
  const code = await runSetup({
    argv,
    env: options.env ?? {},
    io: term.io,
    store: options.store ?? store,
    port: options.port ?? 8787,
    dataDir: dir,
  });
  return { code, ...term };
}

const savedFile = async () => JSON.parse(await readFile(join(dir, CREDENTIALS_FILE), 'utf8')) as Record<string, unknown>;
const exists = (name: string) =>
  access(join(dir, name)).then(
    () => true,
    () => false,
  );

describe('interactive wizard', () => {
  it('explains what is needed, shows each Redirect URI, saves the Client ID and lists next steps', async () => {
    const r = await run([], { lines: [SPOTIFY_ID, '', ''] });
    expect(r.code).toBe(0);
    expect(r.unusedAnswers()).toBe(0);
    const text = r.text();
    expect(text).toContain('Spotify needs a Client ID. TIDAL catalog/search needs a Client ID + Client Secret.');
    expect(text).toContain('this wizard does not print it');
    expect(text).toContain("Copy the app's Client ID. (Not the Client secret.)"); // Spotify
    expect(text).toContain('https://developer.spotify.com/dashboard');
    expect(text).toContain('https://developer.tidal.com/dashboard');
    expect(text).toContain('http://127.0.0.1:8787/auth/spotify/callback');
    expect(text).toContain('http://127.0.0.1:8787/auth/tidal/callback');
    expect(text).toContain('Next steps');
    expect(text).toContain('Sign in to Spotify once');
    expect(text).toContain('Settings > Music services > Sign in on this screen');
    expect(text).toContain('http://127.0.0.1:8787/auth/spotify/login');
    expect(text).toContain('Sign in with your phone');
    expect(text).not.toContain('TIDAL catalog search and playback work'); // TIDAL has no Client ID here
    expect(await savedFile()).toEqual({ spotify: { clientId: SPOTIFY_ID } });
  });

  it('TIDAL: says where the Client Secret goes, never asks for it, and calls the Redirect URI optional', async () => {
    const r = await run([], { lines: ['', TIDAL_ID, ''] });
    expect(r.code).toBe(0);
    expect(r.unusedAnswers()).toBe(0);
    const text = r.text();
    expect(r.asked.some((q) => /secret/i.test(q))).toBe(false); // by design: the secret is not typed into a terminal
    expect(text).toContain('TIDAL catalog/search needs both a Client ID and Client Secret.');
    expect(text).toContain('Keep the Client Secret private; enter it in the on-screen TIDAL setup or .env.');
    expect(text).toContain('Optional, only for signing in with a TIDAL account (catalog search and playback do not need it)');
    expect(text).toContain('http://127.0.0.1:8787/auth/tidal/callback');
    expect(text).not.toContain('Add this Redirect URI to the app, exactly as written:\n     http://127.0.0.1:8787/auth/tidal'); // only Spotify's is required
    // A Client ID alone is not a usable TIDAL setup: say so, and keep the demo.
    expect(text).toContain('TIDAL    Client ID present; Client Secret still needed');
    expect(text).toContain('No complete music-service credentials are saved yet');
    expect(text).not.toContain('Next steps');
    expect(await savedFile()).toEqual({ tidal: { clientId: TIDAL_ID } });
  });

  it('TIDAL with a Client Secret in the environment is ready, and the secret is never printed or saved by the wizard', async () => {
    const r = await run([], { env: { TIDAL_CLIENT_SECRET: TIDAL_SECRET }, lines: ['', TIDAL_ID, ''] });
    expect(r.code).toBe(0);
    const text = r.text();
    expect(text).toContain('TIDAL    developer credentials ready (secret from .env)');
    expect(text).toContain('Next steps');
    expect(text).toContain('TIDAL catalog search and playback work without signing in');
    expect(text).toContain('Test connection');
    expect(text).not.toContain('Sign in to Spotify'); // Spotify is not set up, so it has no sign-in step
    expect(text).not.toContain(TIDAL_SECRET);
    expect(await savedFile()).toEqual({ tidal: { clientId: TIDAL_ID } });
  });

  it('TIDAL with a saved Client Secret is ready; the same Client ID (or Enter) keeps the secret', async () => {
    await saveServiceCredentials(store, 'tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET });
    const kept = await run([], { lines: ['', '', ''] });
    expect(kept.text()).toContain('TIDAL    developer credentials ready (secret saved)');
    expect(kept.text()).not.toContain(TIDAL_SECRET);
    const same = await run([], { lines: ['', TIDAL_ID, ''] });
    expect(same.text()).not.toContain('Client Secret belonged to the old Client ID');
    expect(await loadCredentials(store)).toEqual({ tidal: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET } });
  });

  it('TIDAL: a different Client ID removes the saved Client Secret, which belonged to the old one', async () => {
    await saveServiceCredentials(store, 'tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET, scopes: 'a.read' });
    const r = await run([], { lines: ['', OTHER_TIDAL_ID, ''] });
    expect(r.code).toBe(0);
    expect(r.text()).toContain('The saved Client Secret belonged to the old Client ID, so it was removed.');
    expect(r.text()).toContain('Client ID present; Client Secret still needed');
    expect(r.text()).not.toContain(TIDAL_SECRET);
    expect(await loadCredentials(store)).toEqual({ tidal: { clientId: OTHER_TIDAL_ID, scopes: 'a.read' } });
  });

  it('TIDAL: a different Client ID does not touch a Client Secret that comes from the environment', async () => {
    const r = await run([], { env: { TIDAL_CLIENT_SECRET: TIDAL_SECRET, TIDAL_CLIENT_ID: TIDAL_ID }, lines: ['', OTHER_TIDAL_ID, ''] });
    expect(r.text()).not.toContain('belonged to the old Client ID');
    expect(r.text()).toContain('developer credentials ready (secret from .env)');
    expect(await loadCredentials(store)).toEqual({ tidal: { clientId: OTHER_TIDAL_ID } });
  });

  it('writes the credentials file private to the owner', async () => {
    await run([], { lines: [SPOTIFY_ID, '', ''] });
    if (process.platform !== 'win32') expect((await stat(join(dir, CREDENTIALS_FILE))).mode & 0o777).toBe(0o600);
  });

  it('uses the given port in every address it prints', async () => {
    const r = await run([], { port: 9100, lines: [SPOTIFY_ID, '', ''] });
    expect(r.text()).toContain('http://127.0.0.1:9100/auth/spotify/callback');
    expect(r.text()).toContain('http://127.0.0.1:9100/auth/tidal/callback');
    expect(r.text()).toContain('http://127.0.0.1:9100/auth/spotify/login');
    expect(r.text()).not.toContain('8787');
  });

  it('Enter skips a service and keeps what is saved', async () => {
    await saveServiceCredentials(store, 'spotify', { clientId: SPOTIFY_ID });
    const r = await run([], { lines: ['', '', ''] });
    expect(r.code).toBe(0);
    expect(r.text()).toContain(`Client ID now: ${SPOTIFY_ID}  (saved here)`);
    expect(r.text()).toContain('Enter to keep the current one');
    expect(await loadCredentials(store)).toEqual({ spotify: { clientId: SPOTIFY_ID } });
  });

  it('with nothing entered it saves nothing and says the Music page will ask for setup', async () => {
    const r = await run([], { lines: ['', ''] });
    expect(r.code).toBe(0);
    expect(r.text()).toContain('The Music page will show the service setup prompt');
    expect(await exists(CREDENTIALS_FILE)).toBe(false);
  });

  it('only offers the advanced prompt once there is a Client ID, and only acts on "a"', async () => {
    const skipped = await run([], { lines: ['', ''] });
    expect(skipped.asked.some((q) => q.includes('advanced options'))).toBe(false);
    const entered = await run([], { lines: [SPOTIFY_ID, 'nope', ''] });
    expect(entered.asked.filter((q) => q.includes('Press Enter to continue, or a for advanced options')).length).toBe(1);
    expect(entered.asked.some((q) => q.startsWith('Redirect URI'))).toBe(false);
  });

  it('advanced options: Redirect URI override, and for TIDAL the permissions', async () => {
    const r = await run([], {
      lines: [SPOTIFY_ID, 'a', 'https://car.example.com/spotify/cb', TIDAL_ID, 'A', 'https://car.example.com/tidal/cb', 'collection.read, playlists.read'],
    });
    expect(r.code).toBe(0);
    expect(r.unusedAnswers()).toBe(0);
    expect(await savedFile()).toEqual({
      spotify: { clientId: SPOTIFY_ID, redirectUri: 'https://car.example.com/spotify/cb' },
      tidal: { clientId: TIDAL_ID, redirectUri: 'https://car.example.com/tidal/cb', scopes: 'collection.read playlists.read' },
    });
    // Spotify's permissions are fixed by the app, so only TIDAL is asked for them.
    expect(r.asked.filter((q) => q.startsWith('Permissions')).length).toBe(1);
    expect(r.text()).toContain('Register https://car.example.com/spotify/cb in your Spotify app.');
    // TIDAL's Redirect URI is only for the optional account sign-in.
    expect(r.text()).toContain('TIDAL only uses it for the optional account sign-in.');
    expect(r.text()).toContain('Register https://car.example.com/tidal/cb in your TIDAL app if you use account sign-in.');
  });

  it('"default" at the advanced prompts goes back to the standard values', async () => {
    await saveServiceCredentials(store, 'tidal', { clientId: TIDAL_ID, redirectUri: 'https://car.example.com/cb', scopes: 'a.read' });
    // Spotify: Enter (nothing saved, so no advanced prompt). TIDAL: Enter keeps the ID, then a, then reset both.
    const r = await run([], { lines: ['', '', 'a', 'default', 'default'] });
    expect(r.unusedAnswers()).toBe(0);
    expect(r.code).toBe(0);
    expect(await loadCredentials(store)).toEqual({ tidal: { clientId: TIDAL_ID } });
  });

  it('retries a rejected Client ID and accepts a good one within three tries', async () => {
    const r = await run([], { lines: ['bad', 'worse', SPOTIFY_ID, '', ''] });
    expect(r.code).toBe(0);
    expect(r.asked.filter((q) => q.startsWith('Spotify Client ID')).length).toBe(3);
    expect(r.text()).toContain('A Spotify Client ID is 32 letters and numbers');
    expect(r.text()).toContain('Try again (2 more tries)');
    expect(r.text()).toContain('Try again (1 more try)');
    expect(await savedFile()).toEqual({ spotify: { clientId: SPOTIFY_ID } });
  });

  it('gives up after three rejected tries, writes nothing, goes on to the next service and exits 1', async () => {
    const r = await run([], { lines: [`${SECRETISH}1`, `${SECRETISH}2`, `${SECRETISH}3`, ''] });
    expect(r.code).toBe(1);
    expect(r.asked.filter((q) => q.startsWith('Spotify Client ID')).length).toBe(3);
    expect(r.asked.some((q) => q.startsWith('TIDAL Client ID'))).toBe(true);
    expect(r.text()).toContain('Not accepted: Spotify');
    expect(await exists(CREDENTIALS_FILE)).toBe(false);
  });

  it('never prints back what was typed into a rejected prompt', async () => {
    const r = await run([], {
      lines: [`${SECRETISH}1`, `${SECRETISH}2`, `${SECRETISH}3`, `${SECRETISH}4 ${SECRETISH}5`, `${SECRETISH}6`, `${SECRETISH}7`],
    });
    expect(r.text()).not.toContain('SECRETISH');
    expect(r.code).toBe(1);
  });

  it('a rejected advanced answer keeps the Client ID that was already saved', async () => {
    const r = await run([], { lines: [SPOTIFY_ID, 'a', 'http://localhost:8787/cb', SECRETISH, 'x y;z', ''] });
    expect(r.code).toBe(1);
    expect(r.text()).toContain('Spotify only accepts https:// addresses');
    expect(r.text()).not.toContain('SECRETISH');
    expect(await savedFile()).toEqual({ spotify: { clientId: SPOTIFY_ID } });
  });

  it('a different Client ID warns that the sign-in has to be redone', async () => {
    await saveServiceCredentials(store, 'spotify', { clientId: SPOTIFY_ID });
    const r = await run([], { lines: [OTHER_SPOTIFY_ID, '', ''] });
    expect(r.text()).toContain('sign in to Spotify again');
    expect(await loadCredentials(store)).toEqual({ spotify: { clientId: OTHER_SPOTIFY_ID } });
  });

  it('keeps what was answered when the input ends, and does not hang or ask more', async () => {
    const r = await run([], { lines: [SPOTIFY_ID, null] });
    expect(r.code).toBe(0);
    expect(r.text()).toContain('The input ended');
    expect(r.asked.some((q) => q.startsWith('TIDAL Client ID'))).toBe(false);
    expect(await loadCredentials(store)).toEqual({ spotify: { clientId: SPOTIFY_ID } });
  });

  it('shows a Client ID that came from the environment, and a saved one replaces it', async () => {
    const env = { SPOTIFY_CLIENT_ID: SPOTIFY_ID };
    const kept = await run([], { env, lines: ['', '', ''] });
    expect(kept.text()).toContain(`Client ID now: ${SPOTIFY_ID}  (from SPOTIFY_CLIENT_ID in .env or the environment)`);
    expect(kept.text()).toContain('Client ID from SPOTIFY_CLIENT_ID in .env');
    expect(await exists(CREDENTIALS_FILE)).toBe(false);
    await run([], { env, lines: [OTHER_SPOTIFY_ID, '', ''] });
    expect(await loadCredentials(store)).toEqual({ spotify: { clientId: OTHER_SPOTIFY_ID } });
  });
});

describe('flags', () => {
  it('--spotify saves the Client ID without asking anything, and prints the Redirect URI to register', async () => {
    const r = await run(['--spotify', SPOTIFY_ID.toUpperCase()]);
    expect(r.code).toBe(0);
    expect(r.asked).toEqual([]);
    expect(await savedFile()).toEqual({ spotify: { clientId: SPOTIFY_ID } });
    expect(r.text()).toContain('Saved the Spotify Client ID.');
    expect(r.text()).toContain('http://127.0.0.1:8787/auth/spotify/callback');
    expect(r.text()).toContain('restart it');
    if (process.platform !== 'win32') expect((await stat(join(dir, CREDENTIALS_FILE))).mode & 0o777).toBe(0o600);
  });

  it('accepts every flag at once, in either spelling, and merges with what is saved', async () => {
    await saveServiceCredentials(store, 'spotify', { clientId: SPOTIFY_ID });
    const r = await run([
      `--tidal=${TIDAL_ID}`,
      '--tidal-redirect',
      'https://car.example.com/tidal/cb',
      '--tidal-scopes',
      'a.read, b.write',
      '--spotify-redirect=https://car.example.com/spotify/cb',
    ]);
    expect(r.code).toBe(0);
    expect(await loadCredentials(store)).toEqual({
      spotify: { clientId: SPOTIFY_ID, redirectUri: 'https://car.example.com/spotify/cb' },
      tidal: { clientId: TIDAL_ID, redirectUri: 'https://car.example.com/tidal/cb', scopes: 'a.read b.write' },
    });
  });

  it('"default" removes a saved Redirect URI or permissions list', async () => {
    await saveServiceCredentials(store, 'tidal', { clientId: TIDAL_ID, redirectUri: 'https://car.example.com/cb', scopes: 'a.read' });
    const r = await run(['--tidal-redirect', 'default', '--tidal-scopes', '']);
    expect(r.code).toBe(0);
    expect(await loadCredentials(store)).toEqual({ tidal: { clientId: TIDAL_ID } });
  });

  it('a different Client ID warns that the sign-in has to be redone', async () => {
    await saveServiceCredentials(store, 'spotify', { clientId: SPOTIFY_ID });
    const r = await run(['--spotify', OTHER_SPOTIFY_ID]);
    expect(r.text()).toContain('sign in to Spotify again');
  });

  it('an invalid Client ID exits 1, writes nothing and never repeats the input', async () => {
    const r = await run(['--spotify', SECRETISH]);
    expect(r.code).toBe(1);
    expect(r.text()).toContain('A Spotify Client ID is 32 letters and numbers');
    expect(r.text()).toContain('Nothing was saved.');
    expect(r.text()).not.toContain('SECRETISH');
    expect(await exists(CREDENTIALS_FILE)).toBe(false);
  });

  it('one invalid value stops everything, even a valid one given with it and anything already saved stays', async () => {
    await saveServiceCredentials(store, 'tidal', { clientId: TIDAL_ID });
    const r = await run(['--spotify', SPOTIFY_ID, '--tidal-redirect', 'http://localhost:1/cb', '--tidal-scopes', 'bad;scope']);
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toContain('--tidal-scopes');
    expect(await loadCredentials(store)).toEqual({ tidal: { clientId: TIDAL_ID } });
  });

  it('Spotify rejects a "localhost" Redirect URI', async () => {
    const r = await run(['--spotify-redirect', 'http://localhost:8787/auth/spotify/callback']);
    expect(r.code).toBe(1);
    expect(r.text()).toContain('Spotify only accepts https://');
    expect(await exists(CREDENTIALS_FILE)).toBe(false);
  });

  it.each([
    [['--nonsense'], /--nonsense is not an option/],
    [['--spotify'], /--spotify needs a value/],
    [['--spotify', '--show'], /--spotify needs a value/],
    [['--spotify', SPOTIFY_ID, '--spotify', OTHER_SPOTIFY_ID], /more than once/],
    [['--forget', 'deezer'], /--forget needs/],
    [['--forget'], /--forget needs a value/],
    [['--forget', 'spotify', '--spotify', SPOTIFY_ID], /either --forget spotify or/],
  ])('bad command line %j exits 1 and writes nothing', async (argv, message) => {
    const r = await run(argv);
    expect(r.code).toBe(1);
    expect(r.err.join('\n')).toMatch(message);
    expect(r.asked).toEqual([]);
    expect(await exists(CREDENTIALS_FILE)).toBe(false);
  });

  it('stray text and odd option names are never echoed (they could be a secret)', async () => {
    for (const argv of [[SECRETISH], [`--${SECRETISH}`], [`--${SECRETISH}=1`]]) {
      const r = await run(argv);
      expect(r.code).toBe(1);
      expect(r.text()).not.toContain('SECRETISH');
    }
  });

  it('there is no option for the TIDAL Client Secret, and what was typed after one is never echoed', async () => {
    for (const argv of [['--tidal-secret', SECRETISH], [`--tidal-secret=${SECRETISH}`], ['--tidal-client-secret', SECRETISH]]) {
      const r = await run(argv);
      expect(r.code).toBe(1);
      expect(r.err.join('\n')).toMatch(/is not an option/);
      expect(r.text()).not.toContain('SECRETISH');
      expect(await exists(CREDENTIALS_FILE)).toBe(false);
    }
  });

  it('--tidal with a different Client ID removes the saved Client Secret; the same one and other options keep it', async () => {
    await saveServiceCredentials(store, 'tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET });
    const same = await run(['--tidal', TIDAL_ID, '--tidal-redirect', 'https://car.example.com/cb']);
    expect(same.code).toBe(0);
    expect(same.text()).not.toContain('belonged to the old Client ID');
    expect(await loadCredentials(store)).toEqual({ tidal: { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET, redirectUri: 'https://car.example.com/cb' } });
    const other = await run(['--tidal', OTHER_TIDAL_ID]);
    expect(other.code).toBe(0);
    expect(other.text()).toContain('The saved Client Secret belonged to the old Client ID, so it was removed.');
    expect(other.text()).not.toContain(TIDAL_SECRET);
    expect(await loadCredentials(store)).toEqual({ tidal: { clientId: OTHER_TIDAL_ID, redirectUri: 'https://car.example.com/cb' } });
  });

  it('the Redirect URI printed for TIDAL is called optional; Spotify\'s is required', async () => {
    const tidal = await run(['--tidal', TIDAL_ID]);
    expect(tidal.text()).toContain('Only if you will sign in with a TIDAL account');
    expect(tidal.text()).toContain('http://127.0.0.1:8787/auth/tidal/callback');
    expect(tidal.text()).not.toContain('Register this Redirect URI in your TIDAL app');
    const spotify = await run(['--spotify', SPOTIFY_ID]);
    expect(spotify.text()).toContain('Register this Redirect URI in your Spotify app, exactly as written:');
  });

  it('--help prints the usage and exit codes, and changes nothing', async () => {
    const r = await run(['--help', '--spotify', SPOTIFY_ID]);
    expect(r.code).toBe(0);
    expect(r.text()).toContain('Usage');
    expect(r.text()).toContain('--forget');
    expect(r.text()).toContain('Exit codes');
    expect(r.text()).toContain('Spotify needs a Client ID. TIDAL catalog/search needs a Client ID + Client Secret.');
    expect(r.text()).toContain('TIDAL_CLIENT_SECRET in .env (not a command-line flag)');
    expect(r.text()).toContain('Saved values win over SPOTIFY_CLIENT_ID / TIDAL_CLIENT_ID / TIDAL_CLIENT_SECRET');
    expect(r.text()).not.toContain('--tidal-secret'); // there is no such option
    expect(await exists(CREDENTIALS_FILE)).toBe(false);
    expect((await run(['-h'])).code).toBe(0);
  });
});

describe('--show', () => {
  it('says what is missing and still prints the Redirect URI to register', async () => {
    const r = await run(['--show']);
    expect(r.code).toBe(0);
    expect(r.asked).toEqual([]);
    expect(r.text()).toMatch(/Spotify\n {2}Client ID {5}not set\n {2}Redirect URI {2}http:\/\/127\.0\.0\.1:8787\/auth\/spotify\/callback {2}\(standard\)/);
    expect(r.text()).toMatch(/TIDAL\n {2}Client ID {5}not set/);
    expect(r.text()).toContain('built-in default');
    expect(await exists(CREDENTIALS_FILE)).toBe(false);
  });

  it('prints a saved Client ID in full and a chosen Redirect URI', async () => {
    await saveServiceCredentials(store, 'spotify', { clientId: SPOTIFY_ID, redirectUri: 'https://car.example.com/cb' });
    const r = await run(['--show']);
    expect(r.text()).toContain(`${SPOTIFY_ID}  (saved here)`);
    expect(r.text()).toContain('https://car.example.com/cb  (saved here)');
  });

  it('tells apart saved, environment and missing values, and what overrides what', async () => {
    const env = {
      SPOTIFY_CLIENT_ID: OTHER_SPOTIFY_ID,
      TIDAL_CLIENT_ID: TIDAL_ID,
      TIDAL_REDIRECT_URI: 'https://env.example.com/cb',
      TIDAL_SCOPES: 'x.read y.read',
    };
    const fromEnv = await run(['--show'], { env });
    expect(fromEnv.text()).toContain(`${OTHER_SPOTIFY_ID}  (from SPOTIFY_CLIENT_ID in .env or the environment)`);
    expect(fromEnv.text()).toContain(`${TIDAL_ID}  (from TIDAL_CLIENT_ID in .env or the environment)`);
    expect(fromEnv.text()).toContain('https://env.example.com/cb  (from TIDAL_REDIRECT_URI in .env or the environment)');
    expect(fromEnv.text()).toContain('x.read y.read  (from TIDAL_SCOPES in .env or the environment)');

    await saveServiceCredentials(store, 'spotify', { clientId: SPOTIFY_ID });
    const overridden = await run(['--show'], { env });
    expect(overridden.text()).toContain(`${SPOTIFY_ID}  (saved here, this overrides SPOTIFY_CLIENT_ID)`);
    expect(overridden.text()).not.toContain(OTHER_SPOTIFY_ID);
  });

  it('warns about an unusable environment Client ID without printing it', async () => {
    const r = await run(['--show'], { env: { SPOTIFY_CLIENT_ID: SECRETISH } });
    expect(r.text()).toContain('SPOTIFY_CLIENT_ID is set but is not a valid Spotify Client ID');
    expect(r.text()).not.toContain('SECRETISH');
  });

  it('never prints tokens, secrets or anything else found in the data folder', async () => {
    await writeFile(
      join(dir, 'spotify.json'),
      JSON.stringify({ accessToken: 'ACCESS-TOKEN-AAA', refreshToken: 'REFRESH-TOKEN-BBB', clientId: SPOTIFY_ID }),
    );
    await writeFile(
      join(dir, CREDENTIALS_FILE),
      JSON.stringify({
        spotify: { clientId: SPOTIFY_ID, clientSecret: 'CLIENT-SECRET-CCC', refreshToken: 'REFRESH-TOKEN-DDD' },
        clientSecret: 'CLIENT-SECRET-EEE',
      }),
    );
    const r = await run(['--show']);
    expect(r.text()).toContain(SPOTIFY_ID);
    expect(r.text()).not.toMatch(/TOKEN|SECRET-/);
  });

  it('shows whether a TIDAL Client Secret is configured and where it came from, never the secret itself', async () => {
    const none = await run(['--show']);
    expect(none.text()).toMatch(/TIDAL\n {2}Client ID {5}not set\n {2}Client Secret not set\n {2}Redirect URI/);
    expect(none.text().split('\nTIDAL\n')[0]).not.toContain('Client Secret'); // Spotify has none

    await saveServiceCredentials(store, 'tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET });
    const saved = await run(['--show'], { env: { TIDAL_CLIENT_SECRET: 'another-env-secret-123' } });
    expect(saved.text()).toContain('Client Secret configured  (saved here)'); // saved wins over the environment
    expect(saved.text()).not.toContain(TIDAL_SECRET);
    expect(saved.text()).not.toContain('another-env-secret');

    await run(['--forget', 'tidal']);
    const fromEnv = await run(['--show'], { env: { TIDAL_CLIENT_ID: TIDAL_ID, TIDAL_CLIENT_SECRET: TIDAL_SECRET } });
    expect(fromEnv.text()).toContain('Client Secret configured  (from TIDAL_CLIENT_SECRET in .env or the environment)');
    expect(fromEnv.text()).not.toContain(TIDAL_SECRET);

    // An environment secret the app would refuse counts as not set (and is not printed).
    const unusable = await run(['--show'], { env: { TIDAL_CLIENT_SECRET: 'has a space' } });
    expect(unusable.text()).toContain('Client Secret not set');
    expect(unusable.text()).not.toContain('has a space');
  });

  it('after changes made with flags, shows the result', async () => {
    const r = await run(['--show', '--spotify', SPOTIFY_ID]);
    expect(r.code).toBe(0);
    expect(r.text()).toContain('Saved the Spotify Client ID.');
    expect(r.text()).toContain(`${SPOTIFY_ID}  (saved here)`);
  });
});

describe('--forget', () => {
  it('removes everything saved for one service and leaves the other and the sign-in file alone', async () => {
    await saveServiceCredentials(store, 'spotify', { clientId: SPOTIFY_ID, redirectUri: 'https://car.example.com/cb' });
    await saveServiceCredentials(store, 'tidal', { clientId: TIDAL_ID, scopes: 'a.read' });
    await writeFile(join(dir, 'spotify.json'), '{"refreshToken":"KEEP-ME"}');
    const r = await run(['--forget', 'spotify']);
    expect(r.code).toBe(0);
    expect(r.text()).toContain('Removed everything saved here for Spotify.');
    expect(r.text()).toContain('Signing out is separate');
    expect(await savedFile()).toEqual({ tidal: { clientId: TIDAL_ID, scopes: 'a.read' } });
    expect(await readFile(join(dir, 'spotify.json'), 'utf8')).toContain('KEEP-ME');
  });

  it('removes a saved TIDAL Client Secret together with everything else saved for TIDAL', async () => {
    await saveServiceCredentials(store, 'tidal', { clientId: TIDAL_ID, clientSecret: TIDAL_SECRET, redirectUri: 'https://car.example.com/cb' });
    const r = await run(['--forget', 'tidal']);
    expect(r.code).toBe(0);
    expect(r.text()).toContain('Removed everything saved here for TIDAL.');
    expect(r.text()).not.toContain(TIDAL_SECRET);
    expect(await savedFile()).toEqual({});
  });

  it('can forget both, and says so when there was nothing to forget', async () => {
    await saveServiceCredentials(store, 'tidal', { clientId: TIDAL_ID });
    const r = await run(['--forget', 'spotify', '--forget', 'tidal']);
    expect(r.code).toBe(0);
    expect(r.text()).toContain('Nothing was saved for Spotify.');
    expect(r.text()).toContain('Removed everything saved here for TIDAL.');
    expect(await savedFile()).toEqual({});
  });

  it('forgetting a service that has nothing saved does not create the file', async () => {
    const r = await run(['--forget', 'tidal']);
    expect(r.code).toBe(0);
    expect(await exists(CREDENTIALS_FILE)).toBe(false);
  });
});

describe('unexpected failures', () => {
  it('exits 2 with a plain message when the store throws', async () => {
    const broken = {
      read: async () => null,
      flush: async () => undefined,
      write: async () => {
        throw new Error('disk on fire');
      },
    } as unknown as JsonStore;
    const r = await run(['--spotify', SPOTIFY_ID], { store: broken });
    expect(r.code).toBe(2);
    expect(r.err.join('\n')).toBe('Something went wrong: disk on fire');
  });

  it('notices a write that JsonStore only logs (unwritable folder) and exits 2 instead of claiming success', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const blocker = join(dir, 'not-a-folder');
    await writeFile(blocker, 'x');
    const r = await run(['--spotify', SPOTIFY_ID], { store: new JsonStore(join(blocker, 'data')) });
    expect(r.code).toBe(2);
    expect(r.text()).toContain('Could not write credentials.json');
    expect(r.text()).not.toContain('Saved the Spotify Client ID');
  });
});

describe('terminal IO', () => {
  function pair() {
    const input = new PassThrough();
    const chunks: string[] = [];
    const output = new Writable({
      write(chunk, _enc, done) {
        chunks.push(String(chunk));
        done();
      },
    });
    const io = createTerminalIO(input, output);
    return { input, io, written: () => chunks.join('') };
  }

  it('hands out typed lines in order, then null at the end of the input, without echoing what was typed', async () => {
    const { input, io, written } = pair();
    input.write(`first-${SECRETISH}\nsecond\n`);
    input.end();
    expect(await io.prompt('Q1?')).toBe(`first-${SECRETISH}`);
    expect(await io.prompt('Q2?')).toBe('second');
    expect(await io.prompt('Q3?')).toBeNull();
    expect(await io.prompt('Q4?')).toBeNull();
    expect(written()).toContain('Q1?');
    expect(written()).toContain('Q2?');
    expect(written()).not.toContain('SECRETISH');
    expect(written()).not.toContain('Q4?');
    io.close();
  });

  it('a question waiting for an answer resolves null when the input closes (no hang)', async () => {
    const { input, io } = pair();
    const pending = io.prompt('Anyone there?');
    input.end();
    expect(await pending).toBeNull();
    io.close();
  });

  it('answers typed later reach the waiting question', async () => {
    const { input, io } = pair();
    const pending = io.prompt('Q?');
    input.write('late\r\n');
    expect(await pending).toBe('late');
    io.close();
  });

  it('turns typographic quotes and dashes into plain ASCII', () => {
    expect(toAscii('your app’s page — not “this”… 0–9')).toBe('your app\'s page - not "this"... 0-9');
  });

  it('the whole wizard prints ASCII only, including the shared error texts', async () => {
    const { input, io, written } = pair();
    input.write(`${SECRETISH}\n${SPOTIFY_ID}\n\n\n`);
    input.end();
    const code = await runSetup({ argv: [], env: {}, io, store, port: 8787, dataDir: dir });
    io.close();
    expect(code).toBe(0);
    expect(written()).toContain('A Spotify Client ID is 32 letters and numbers (0-9, a-f)');
    expect(written()).toMatch(/^[\x20-\x7e\n]*$/);
    expect(written()).not.toContain('SECRETISH');
  });
});

// The real thing: `tsx src/setup.ts` as a child process with piped stdin, like `npm run setup`.
const serverDir = fileURLToPath(new URL('..', import.meta.url));
const tsxAvailable = (() => {
  try {
    createRequire(join(serverDir, 'package.json')).resolve('tsx');
    return true;
  } catch {
    return false;
  }
})();

function spawnSetup(args: string[], stdin: string): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', 'tsx', 'src/setup.ts', ...args], {
      cwd: serverDir,
      env: { ...process.env, HEADUNIT_DATA_DIR: dir, PORT: '9123', SPOTIFY_CLIENT_ID: '', TIDAL_CLIENT_ID: '', TIDAL_CLIENT_SECRET: '' },
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
    child.stdin.end(stdin);
  });
}

describe.skipIf(!tsxAvailable)('as a program', () => {
  it('runs the wizard from piped input, saves to HEADUNIT_DATA_DIR and uses PORT', async () => {
    const r = await spawnSetup([], `${SPOTIFY_ID}\n\n${TIDAL_ID}\n\n`);
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('http://127.0.0.1:9123/auth/spotify/callback');
    expect(r.stdout).toContain('Next steps');
    expect(await savedFile()).toEqual({ spotify: { clientId: SPOTIFY_ID }, tidal: { clientId: TIDAL_ID } });
    if (process.platform !== 'win32') expect((await stat(join(dir, CREDENTIALS_FILE))).mode & 0o777).toBe(0o600);
  }, 30_000);

  it('exits 1 on a bad flag and 0 on --show, and ends cleanly when the input stops early', async () => {
    const bad = await spawnSetup(['--spotify', SECRETISH], '');
    expect(bad.code).toBe(1);
    expect(bad.stdout + bad.stderr).not.toContain('SECRETISH');
    const shown = await spawnSetup(['--show'], '');
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain('Client ID     not set');
    const early = await spawnSetup([], '');
    expect(early.code).toBe(0);
    expect(early.stdout).toContain('The input ended');
    expect(await exists(CREDENTIALS_FILE)).toBe(false);
  }, 60_000);
});
