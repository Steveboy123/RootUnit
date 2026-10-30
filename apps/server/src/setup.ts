/**
 * `npm run setup` — save each music service's Client ID without editing .env.
 *
 *   npm run setup                          asks questions, one service at a time
 *   npm run setup -- --show                prints what is saved (never tokens)
 *   npm run setup -- --spotify <id>        non-interactive; see --help for the rest
 *
 * Spotify only needs a Client ID. TIDAL catalog/search also needs a Client Secret; enter that through
 * Settings > Music services or TIDAL_CLIENT_SECRET in the environment so it is not exposed in shell history.
 * Values go to data/credentials.json (the same file Settings > Music services edits).
 *
 * Output is plain ASCII on purpose: a Windows console with a legacy code page garbles anything else.
 */
import { realpathSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import type { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import {
  MUSIC_SERVICES,
  SERVICE_INFO,
  defaultRedirectUri,
  validateClientId,
  validateRedirectUri,
  validateScopes,
  type Checked,
  type MusicService,
} from '@headunit/shared';
import { config } from './config';
import {
  CREDENTIALS_FILE,
  loadCredentials,
  resolveService,
  saveServiceCredentials,
  type EnvService,
  type ResolvedService,
  type SavedCredentials,
} from './connections/credentials';
import { JsonStore } from './store';

export const EXIT_OK = 0;
export const EXIT_INVALID = 1;
export const EXIT_ERROR = 2;

/** How many times a typed answer may be rejected before that question is given up. */
export const MAX_TRIES = 3;

/** Terminal in/out, injected so the wizard can be driven by a script in tests. */
export interface SetupIO {
  /** Ask a question and resolve with the typed line, or null when the input has ended (Ctrl+D, Ctrl+C, closed pipe). */
  prompt(question: string): Promise<string | null>;
  print(line?: string): void;
  /** Same as print, for the error stream. */
  error(line: string): void;
}

export interface SetupOptions {
  argv: string[];
  env: Record<string, string | undefined>;
  io: SetupIO;
  store: JsonStore;
  port: number;
  /** Only used to show the credentials file's location. */
  dataDir?: string;
}

const ENV_NAMES: Record<MusicService, { clientId: string; clientSecret?: string; redirectUri: string; scopes?: string }> = {
  spotify: { clientId: 'SPOTIFY_CLIENT_ID', redirectUri: 'SPOTIFY_REDIRECT_URI' },
  tidal: { clientId: 'TIDAL_CLIENT_ID', clientSecret: 'TIDAL_CLIENT_SECRET', redirectUri: 'TIDAL_REDIRECT_URI', scopes: 'TIDAL_SCOPES' },
};

const HELP = `Music services setup

Spotify needs a Client ID. TIDAL catalog/search needs a Client ID + Client Secret.
For TIDAL, enter the secret in the on-screen setup or TIDAL_CLIENT_SECRET in .env (not a command-line flag).

Usage
  npm run setup                          Ask questions, one service at a time
  npm run setup -- --show                Show what is saved
  npm run setup -- --spotify <id>        Save a Spotify Client ID
  npm run setup -- --tidal <id>          Save a TIDAL Client ID
  npm run setup -- --spotify-redirect <address>
  npm run setup -- --tidal-redirect <address>
                                         Use a different Redirect URI ("default" = back to the standard one)
  npm run setup -- --tidal-scopes "<list>"
                                         The permissions to ask TIDAL for, separated by spaces ("default" = built-in list)
  npm run setup -- --forget spotify      Remove everything saved for a service (repeat for tidal)
  npm run setup -- --help                This text

The lone -- after "setup" is how npm passes the options on. Options can be combined; if any of them is
wrong, nothing is saved. A value may also be written --spotify=<id>.

Saved values win over SPOTIFY_CLIENT_ID / TIDAL_CLIENT_ID / TIDAL_CLIENT_SECRET in .env, which win over the built-in defaults.

Exit codes: 0 done, 1 something you typed was not valid, 2 something unexpected went wrong.`;

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

type Field = 'clientId' | 'redirect' | 'scopes';
const VALUE_FLAGS: Record<string, { field: Field; service: MusicService }> = {
  '--spotify': { field: 'clientId', service: 'spotify' },
  '--tidal': { field: 'clientId', service: 'tidal' },
  '--spotify-redirect': { field: 'redirect', service: 'spotify' },
  '--tidal-redirect': { field: 'redirect', service: 'tidal' },
  '--tidal-scopes': { field: 'scopes', service: 'tidal' },
};

interface Parsed {
  help: boolean;
  show: boolean;
  values: Partial<Record<Field, Partial<Record<MusicService, string>>>>;
  forget: MusicService[];
}

function parseArgs(argv: string[]): Checked<Parsed> {
  const out: Parsed = { help: false, show: false, values: {}, forget: [] };
  const fail = (error: string): Checked<Parsed> => ({ ok: false, error });
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i] ?? '';
    if (token === '--help' || token === '-h') {
      out.help = true;
      continue;
    }
    if (token === '--show') {
      out.show = true;
      continue;
    }
    if (!token.startsWith('--')) {
      // Never echo it: it could be a Client secret typed without its flag.
      return fail('Unexpected text on the command line. Run it with --help to see the options.');
    }
    const eq = token.indexOf('=');
    const name = eq === -1 ? token : token.slice(0, eq);
    let value: string | undefined = eq === -1 ? undefined : token.slice(eq + 1);
    const isValueFlag = name in VALUE_FLAGS || name === '--forget';
    if (!isValueFlag) {
      return fail(`${/^--[a-z0-9-]{1,30}$/.test(name) ? name : 'That option'} is not an option. Run it with --help to see the options.`);
    }
    if (value === undefined) {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) return fail(`${name} needs a value after it.`);
      value = next;
      i++;
    }
    if (name === '--forget') {
      if (value !== 'spotify' && value !== 'tidal') return fail('--forget needs "spotify" or "tidal".');
      if (!out.forget.includes(value)) out.forget.push(value);
      continue;
    }
    const spec = VALUE_FLAGS[name]!;
    const bucket = (out.values[spec.field] ??= {});
    if (bucket[spec.service] !== undefined) return fail(`${name} was given more than once.`);
    bucket[spec.service] = value;
  }
  for (const service of out.forget) {
    if ((['clientId', 'redirect', 'scopes'] as const).some((f) => out.values[f]?.[service] !== undefined)) {
      return fail(`Use either --forget ${service} or the options that set ${SERVICE_INFO[service].label}, not both.`);
    }
  }
  return { ok: true, value: out };
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function envFor(service: MusicService, env: SetupOptions['env']): EnvService {
  const names = ENV_NAMES[service];
  return {
    clientId: env[names.clientId],
    redirectUri: env[names.redirectUri],
    ...(names.clientSecret ? { clientSecret: env[names.clientSecret] } : {}),
    ...(names.scopes ? { scopes: env[names.scopes] } : {}),
  };
}

async function resolveAll(opts: SetupOptions): Promise<Record<MusicService, ResolvedService>> {
  const saved = await loadCredentials(opts.store);
  return Object.fromEntries(
    MUSIC_SERVICES.map((s) => [s, resolveService(s, saved, envFor(s, opts.env), opts.port)]),
  ) as Record<MusicService, ResolvedService>;
}

/** Save, then read the file back: JsonStore only logs a failed write, so this is how a full or read-only disk shows up. */
async function save(
  store: JsonStore,
  service: MusicService,
  patch: { clientId?: string | null; clientSecret?: string | null; redirectUri?: string | null; scopes?: string | null },
): Promise<void> {
  await saveServiceCredentials(store, service, patch);
  await store.flush();
  const after = (await loadCredentials(store))[service] ?? {};
  const wanted: Array<[string | null | undefined, string | undefined]> = [
    [patch.clientId, after.clientId],
    [patch.clientSecret, after.clientSecret],
    [patch.redirectUri, after.redirectUri],
    [patch.scopes, after.scopes],
  ];
  for (const [want, got] of wanted) {
    if (want === undefined) continue;
    const expected = want === null || want === '' ? undefined : want;
    if (got !== expected) {
      throw new Error(`Could not write ${CREDENTIALS_FILE}. Check that the data folder exists and can be written to.`);
    }
  }
}

/**
 * A TIDAL Client Secret belongs to one Client ID (Settings drops it when the Client ID changes). Does saving
 * `newId` leave a saved secret that belonged to a different Client ID? An environment secret is not ours to remove.
 */
function orphansSavedSecret(service: MusicService, saved: SavedCredentials, currentClientId: string, newId: string): boolean {
  return service === 'tidal' && Boolean(saved.tidal?.clientSecret) && currentClientId !== '' && currentClientId !== newId;
}

const SECRET_REMOVED = 'The saved Client Secret belonged to the old Client ID, so it was removed. Enter the new one in Settings > Music services > TIDAL.';

function describeSource(source: 'saved' | 'env' | 'none' | 'default', envName: string): string {
  if (source === 'saved') return 'saved here';
  if (source === 'env') return `from ${envName} in .env or the environment`;
  return source === 'default' ? 'standard' : 'not set';
}

function fileLabel(opts: SetupOptions): string {
  return opts.dataDir ? join(opts.dataDir, CREDENTIALS_FILE) : `data/${CREDENTIALS_FILE}`;
}

// ---------------------------------------------------------------------------
// --show
// ---------------------------------------------------------------------------

async function show(opts: SetupOptions): Promise<void> {
  const { io, env } = opts;
  const resolved = await resolveAll(opts);
  const saved = await loadCredentials(opts.store);
  for (const service of MUSIC_SERVICES) {
    const r = resolved[service];
    const names = ENV_NAMES[service];
    io.print(SERVICE_INFO[service].label);
    if (r.clientIdSource === 'none') {
      io.print('  Client ID     not set');
      const rawEnv = env[names.clientId];
      if (rawEnv && !validateClientId(service, rawEnv).ok) {
        io.print(`  (${names.clientId} is set but is not a valid ${SERVICE_INFO[service].label} Client ID, so it is ignored.)`);
      }
    } else {
      const note =
        r.clientIdSource === 'saved' && env[names.clientId]
          ? `saved here, this overrides ${names.clientId}`
          : describeSource(r.clientIdSource, names.clientId);
      io.print(`  Client ID     ${r.clientId}  (${note})`);
    }
    if (service === 'tidal') {
      // Only whether there is one, never the value.
      if (!r.clientSecret) io.print('  Client Secret not set');
      else io.print(`  Client Secret configured  (${r.clientSecretSource === 'saved' ? 'saved here' : `from ${names.clientSecret} in .env or the environment`})`);
    }
    io.print(`  Redirect URI  ${r.redirectUri}  (${describeSource(r.redirectUriSource, names.redirectUri)})`);
    if (names.scopes || r.scopes) {
      const source = saved[service]?.scopes ? 'saved here' : r.scopes ? `from ${names.scopes} in .env or the environment` : 'built-in default';
      io.print(`  Permissions   ${r.scopes || 'built-in default'}${r.scopes ? `  (${source})` : ''}`);
    }
  }
  io.print();
  io.print(`Saved values are in ${fileLabel(opts)}. Sign-in tokens are kept elsewhere and are never shown.`);
}

// ---------------------------------------------------------------------------
// Non-interactive (flags)
// ---------------------------------------------------------------------------

type Patch = { clientId?: string | null; clientSecret?: string | null; redirectUri?: string | null; scopes?: string | null };

function isReset(text: string): boolean {
  return text.trim() === '' || text.trim().toLowerCase() === 'default';
}

async function applyFlags(opts: SetupOptions, parsed: Parsed): Promise<number> {
  const { io } = opts;
  const patches: Partial<Record<MusicService, Patch>> = {};
  const errors: string[] = [];
  const patchFor = (s: MusicService) => (patches[s] ??= {});

  for (const service of MUSIC_SERVICES) {
    const id = parsed.values.clientId?.[service];
    if (id !== undefined) {
      const v = validateClientId(service, id);
      if (v.ok) patchFor(service).clientId = v.value;
      else errors.push(`--${service}: ${v.error}`);
    }
    const uri = parsed.values.redirect?.[service];
    if (uri !== undefined) {
      if (isReset(uri)) patchFor(service).redirectUri = null;
      else {
        const v = validateRedirectUri(service, uri);
        if (v.ok) patchFor(service).redirectUri = v.value;
        else errors.push(`--${service}-redirect: ${v.error}`);
      }
    }
    const scopes = parsed.values.scopes?.[service];
    if (scopes !== undefined) {
      if (isReset(scopes)) patchFor(service).scopes = null;
      else {
        const v = validateScopes(scopes);
        if (v.ok) patchFor(service).scopes = v.value;
        else errors.push(`--${service}-scopes: ${v.error}`);
      }
    }
  }
  if (errors.length) {
    for (const line of errors) io.error(line);
    io.error('Nothing was saved.');
    return EXIT_INVALID;
  }

  const before = await resolveAll(opts);
  const savedBefore = await loadCredentials(opts.store);
  let forgotAny = false;
  for (const service of parsed.forget) {
    const label = SERVICE_INFO[service].label;
    if (!savedBefore[service]) {
      io.print(`Nothing was saved for ${label}.`);
      continue;
    }
    await save(opts.store, service, { clientId: null, ...(service === 'tidal' ? { clientSecret: null } : {}), redirectUri: null, scopes: null });
    io.print(`Removed everything saved here for ${label}.`);
    forgotAny = true;
  }
  const touched: MusicService[] = [];
  for (const service of MUSIC_SERVICES) {
    const patch = patches[service];
    if (!patch || Object.keys(patch).length === 0) continue;
    const dropsSecret = typeof patch.clientId === 'string' && orphansSavedSecret(service, savedBefore, before[service].clientId, patch.clientId);
    if (dropsSecret) patch.clientSecret = null;
    await save(opts.store, service, patch);
    touched.push(service);
    const label = SERVICE_INFO[service].label;
    if (patch.clientId !== undefined) {
      io.print(`Saved the ${label} Client ID.`);
      if (before[service].clientId && before[service].clientId !== patch.clientId) {
        io.print(`  A sign-in belongs to one Client ID, so sign in to ${label} again.`);
      }
      if (dropsSecret) io.print(`  ${SECRET_REMOVED}`);
    }
    if (patch.redirectUri !== undefined) io.print(patch.redirectUri === null ? `${label} will use the standard Redirect URI again.` : `Saved the ${label} Redirect URI.`);
    if (patch.scopes !== undefined) io.print(patch.scopes === null ? `${label} will ask for its built-in permissions again.` : `Saved the ${label} permissions.`);
  }
  if (forgotAny) io.print('Signing out is separate: use Settings > Music services > Sign out.');
  const after = await resolveAll(opts);
  for (const service of touched) {
    if (!after[service].clientId) continue;
    io.print();
    io.print(
      service === 'tidal'
        ? 'Only if you will sign in with a TIDAL account (catalog search and playback do not need it), register this Redirect URI in your TIDAL app, exactly as written:'
        : `Register this Redirect URI in your ${SERVICE_INFO[service].label} app, exactly as written:`,
    );
    io.print(`  ${after[service].redirectUri}`);
  }
  if (touched.length || forgotAny) {
    io.print();
    io.print('If the app is already running, restart it so it picks this up.');
  }
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// Interactive wizard
// ---------------------------------------------------------------------------

type Answer<T> = { kind: 'value'; value: T } | { kind: 'skip' } | { kind: 'gave-up' } | { kind: 'ended' };

/** Ask until the answer passes `check`, up to MAX_TRIES times. Enter skips. The rejected text is never printed back. */
async function ask<T>(io: SetupIO, question: string, check: (text: string) => Checked<T>): Promise<Answer<T>> {
  for (let attempt = 1; attempt <= MAX_TRIES; attempt++) {
    const line = await io.prompt(question);
    if (line === null) return { kind: 'ended' };
    if (line.trim() === '') return { kind: 'skip' };
    const checked = check(line);
    if (checked.ok) return { kind: 'value', value: checked.value };
    io.print(`  ${checked.error}`);
    if (attempt < MAX_TRIES) io.print(`  Try again (${MAX_TRIES - attempt} more ${MAX_TRIES - attempt === 1 ? 'try' : 'tries'}), or press Enter to skip.`);
  }
  io.print('  That did not work three times, so this question is skipped. Nothing was changed for it.');
  return { kind: 'gave-up' };
}

type ServiceOutcome = 'done' | 'gave-up' | 'ended';

async function setupService(opts: SetupOptions, service: MusicService): Promise<ServiceOutcome> {
  const { io, store, port } = opts;
  const info = SERVICE_INFO[service];
  const names = ENV_NAMES[service];
  const saved = await loadCredentials(store);
  const current = resolveService(service, saved, envFor(service, opts.env), port);
  let outcome: ServiceOutcome = 'done';

  io.print();
  io.print(`-- ${info.label} ${'-'.repeat(Math.max(3, 56 - info.label.length))}`);
  if (service === 'tidal') {
    io.print('TIDAL catalog/search needs both a Client ID and Client Secret.');
    io.print('This terminal wizard saves the Client ID; enter the secret later in Settings > Music services > TIDAL');
    io.print('or set TIDAL_CLIENT_SECRET in .env so the secret is not exposed in shell history.');
    io.print();
  }
  io.print(`1. Create an app (or open yours) at ${info.dashboardUrl}`);
  if (service === 'spotify') {
    io.print('2. Add this Redirect URI to the app, exactly as written:');
    io.print(`     ${defaultRedirectUri(service, port)}`);
    io.print('   (It must be 127.0.0.1 - Spotify does not accept "localhost".)');
    io.print(`   It uses port ${port}. If you change PORT later, register the new address too.`);
    io.print('3. When it asks which APIs you plan to use, tick "Web API".');
    io.print('4. Copy the app\'s Client ID. (Not the Client secret.)');
    io.print('5. Under User Management, add the Spotify account you will sign in with');
    io.print('   (an app in development mode only works for accounts listed there).');
  } else {
    // TIDAL catalog search and playback use the Client ID + Secret only (Client Credentials). The Redirect URI is
    // needed just for the optional account sign-in.
    io.print("2. Copy the app's Client ID for this wizard.");
    io.print('3. Keep the Client Secret private; enter it in the on-screen TIDAL setup or .env.');
    io.print('4. Optional, only for signing in with a TIDAL account (catalog search and playback do not need it):');
    io.print('   add this Redirect URI to the app, exactly as written:');
    io.print(`     ${defaultRedirectUri(service, port)}`);
    io.print(`   It uses port ${port}. If you change PORT later, register the new address too.`);
  }
  io.print();
  if (current.clientIdSource === 'none') io.print('Client ID now: none');
  else io.print(`Client ID now: ${current.clientId}  (${describeSource(current.clientIdSource, names.clientId)})`);

  const question =
    current.clientIdSource === 'none'
      ? `${info.label} Client ID (${info.clientIdHint}; Enter to skip): `
      : `${info.label} Client ID (Enter to keep the current one): `;
  const id = await ask(io, question, (text) => validateClientId(service, text));
  if (id.kind === 'ended') return 'ended';
  if (id.kind === 'gave-up') outcome = 'gave-up';
  let clientId = current.clientId;
  if (id.kind === 'value') {
    const dropsSecret = orphansSavedSecret(service, saved, current.clientId, id.value);
    await save(store, service, { clientId: id.value, ...(dropsSecret ? { clientSecret: null } : {}) });
    io.print('  Saved.');
    if (current.clientId && current.clientId !== id.value) {
      io.print(`  A sign-in belongs to one Client ID, so you will need to sign in to ${info.label} again.`);
    }
    if (dropsSecret) io.print(`  ${SECRET_REMOVED}`);
    clientId = id.value;
  }

  if (clientId) {
    const more = await io.prompt('Press Enter to continue, or a for advanced options: ');
    if (more === null) return 'ended';
    if (more.trim().toLowerCase() === 'a') {
      const advanced = await advancedOptions(opts, service, current);
      if (advanced === 'ended') return 'ended';
      if (advanced === 'gave-up') outcome = 'gave-up';
    }
  }
  return outcome;
}

/** Redirect URI override, and (TIDAL) the permissions to request. Each answer is saved as soon as it is valid. */
async function advancedOptions(opts: SetupOptions, service: MusicService, current: ResolvedService): Promise<ServiceOutcome> {
  const { io, store } = opts;
  const info = SERVICE_INFO[service];
  let outcome: ServiceOutcome = 'done';

  io.print();
  io.print('The Redirect URI must match, character for character, the one registered in your app.');
  if (service === 'tidal') io.print('TIDAL only uses it for the optional account sign-in.');
  io.print(`Now: ${current.redirectUri}  (${describeSource(current.redirectUriSource, ENV_NAMES[service].redirectUri)})`);
  const uri = await ask<string | null>(io, 'Redirect URI (Enter to keep it, "default" for the standard one): ', (text) =>
    isReset(text) ? { ok: true, value: null } : validateRedirectUri(service, text),
  );
  if (uri.kind === 'ended') return 'ended';
  if (uri.kind === 'gave-up') outcome = 'gave-up';
  if (uri.kind === 'value') {
    await save(store, service, { redirectUri: uri.value });
    io.print(
      uri.value === null
        ? '  Saved: the standard Redirect URI.'
        : `  Saved. Register ${uri.value} in your ${info.label} app${service === 'tidal' ? ' if you use account sign-in' : ''}.`,
    );
  }

  if (service === 'tidal') {
    io.print();
    io.print('Permissions are what the app asks TIDAL for at sign-in, separated by spaces.');
    io.print(`Now: ${current.scopes || 'built-in default'}`);
    const scopes = await ask<string | null>(io, 'Permissions (Enter to keep, "default" for the built-in list): ', (text) =>
      isReset(text) ? { ok: true, value: null } : validateScopes(text),
    );
    if (scopes.kind === 'ended') return 'ended';
    if (scopes.kind === 'gave-up') outcome = 'gave-up';
    if (scopes.kind === 'value') {
      await save(store, service, { scopes: scopes.value });
      io.print('  Saved.');
    }
  }
  return outcome;
}

async function wizard(opts: SetupOptions): Promise<number> {
  const { io, port } = opts;
  io.print('Music services setup');
  io.print('====================');
  io.print('Spotify needs a Client ID. TIDAL catalog/search needs a Client ID + Client Secret.');
  io.print('For TIDAL, enter the secret in Settings or TIDAL_CLIENT_SECRET in .env; this wizard does not print it.');
  io.print('TIDAL account sign-in is optional for catalog search/playback.');
  io.print();
  io.print('Press Enter at any question to skip it and keep what is there now.');
  io.print('Each answer is saved as soon as you give it, so Ctrl+C never loses earlier ones.');

  const gaveUp: MusicService[] = [];
  let ended = false;
  for (const service of MUSIC_SERVICES) {
    const outcome = await setupService(opts, service);
    if (outcome === 'gave-up') gaveUp.push(service);
    if (outcome === 'ended') {
      ended = true;
      break;
    }
  }
  if (ended) {
    io.print();
    io.print('The input ended, so setup stops here. Anything you already answered was saved.');
  }

  const resolved = await resolveAll(opts);
  io.print();
  io.print(`Saved values are in ${fileLabel(opts)} (private to your account).`);
  for (const service of MUSIC_SERVICES) {
    const r = resolved[service];
    const status =
      service === 'tidal'
        ? r.clientId && r.clientSecret
          ? `developer credentials ready (${r.clientSecretSource === 'env' ? 'secret from .env' : 'secret saved'})`
          : r.clientId
            ? 'Client ID present; Client Secret still needed'
            : 'no Client ID yet'
        : r.clientIdSource === 'saved'
          ? 'Client ID saved'
          : r.clientIdSource === 'env'
            ? `Client ID from ${ENV_NAMES[service].clientId} in .env`
            : 'no Client ID yet';
    io.print(`  ${SERVICE_INFO[service].label.padEnd(8)} ${status}${gaveUp.includes(service) ? ' (the last answer was not accepted)' : ''}`);
  }

  const ready = MUSIC_SERVICES.filter((s) => resolved[s].clientIdSource !== 'none' && (s !== 'tidal' || resolved[s].clientSecretSource !== 'none'));
  io.print();
  if (ready.length === 0) {
    io.print('No complete music-service credentials are saved yet. The Music page will show the service setup prompt until Spotify or TIDAL is configured.');
    io.print('Run setup again when you have them, or use Settings > Music services.');
  } else {
    io.print('Next steps');
    io.print('  1. Start the app (npm run dev on your computer; on the head unit: sudo systemctl restart headunit).');
    io.print('     If it is already running, restart it so it picks up what you saved.');
    let step = 2;
    if (ready.includes('spotify')) {
      io.print(`  ${step++}. Sign in to Spotify once. Any of these works:`);
      io.print('       - On the screen: Settings > Music services > Sign in on this screen.');
      io.print(`       - Spotify in the head unit's browser: http://127.0.0.1:${port}/auth/spotify/login`);
      io.print('       - From your phone: Settings > Music services > Sign in with your phone (it shows a QR code).');
    }
    if (ready.includes('tidal')) {
      io.print(`  ${step++}. TIDAL catalog search and playback work without signing in. Check it with Settings > Music services > TIDAL > Test connection.`);
      io.print('     Signing in with a TIDAL account there is optional.');
    }
  }
  if (gaveUp.length) {
    io.print();
    io.print(`Not accepted: ${gaveUp.map((s) => SERVICE_INFO[s].label).join(', ')}. Run npm run setup again to retry.`);
    return EXIT_INVALID;
  }
  return EXIT_OK;
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

/** Run the setup. Resolves with the exit code: 0 ok, 1 invalid input, 2 unexpected error. Never throws. */
export async function runSetup(opts: SetupOptions): Promise<number> {
  const { io } = opts;
  try {
    const parsed = parseArgs(opts.argv);
    if (!parsed.ok) {
      io.error(parsed.error);
      return EXIT_INVALID;
    }
    const p = parsed.value;
    if (p.help) {
      io.print(HELP);
      return EXIT_OK;
    }
    const changes =
      p.forget.length > 0 || Object.values(p.values).some((byService) => byService && Object.keys(byService).length > 0);
    if (changes) {
      const code = await applyFlags(opts, p);
      if (code !== EXIT_OK) return code;
      if (p.show) {
        io.print();
        await show(opts);
      }
      return EXIT_OK;
    }
    if (p.show) {
      await show(opts);
      return EXIT_OK;
    }
    return await wizard(opts);
  } catch (err) {
    io.error(`Something went wrong: ${err instanceof Error ? err.message : 'unknown error'}`);
    return EXIT_ERROR;
  }
}

const ASCII_FOR: Record<string, string> = {
  '\u2018': "'",
  '\u2019': "'",
  '\u201c': '"',
  '\u201d': '"',
  '\u2013': '-',
  '\u2014': '-',
  '\u2026': '...',
  '\u2192': '>',
};

/** The shared error texts use typographic quotes and dashes; a legacy Windows console would garble them. */
export function toAscii(text: string): string {
  return text.replace(/[\u2018\u2019\u201c\u201d\u2013\u2014\u2026\u2192]/g, (c) => ASCII_FOR[c] ?? c);
}

/**
 * Line-based IO over real streams. Lines are queued, so input that is piped in (or ends early) behaves: a question
 * asked after the input closed resolves null instead of hanging. When input is not a terminal the typed text is
 * not echoed, only a newline, so a secret pasted by mistake never lands in a log.
 */
export function createTerminalIO(input: Readable, output: Writable, errorOutput: Writable = output): SetupIO & { close(): void } {
  const interactive = Boolean((input as { isTTY?: boolean }).isTTY);
  const rl = createInterface({ input, output, terminal: interactive });
  const queue: string[] = [];
  let closed = false;
  let waiter: ((line: string | null) => void) | null = null;
  const settle = (line: string | null) => {
    const w = waiter;
    waiter = null;
    w?.(line);
  };
  rl.on('line', (line) => {
    if (waiter) settle(line);
    else queue.push(line);
  });
  rl.on('close', () => {
    closed = true;
    settle(null);
  });
  return {
    prompt(question) {
      const text = toAscii(question);
      const queued = queue.shift();
      if (queued !== undefined) {
        output.write(`${text}\n`);
        return Promise.resolve(queued);
      }
      if (closed) return Promise.resolve(null);
      if (interactive) {
        rl.setPrompt(text);
        rl.prompt();
      } else {
        output.write(`${text}\n`);
      }
      return new Promise((resolve) => {
        waiter = resolve;
      });
    },
    print: (line = '') => void output.write(`${toAscii(line)}\n`),
    error: (line) => void errorOutput.write(`${toAscii(line)}\n`),
    close: () => rl.close(),
  };
}

function isMainModule(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  // `npm run setup -- --show | head` closes the pipe early; that is not an error worth a stack trace.
  for (const stream of [process.stdout, process.stderr]) stream.on('error', () => undefined);
  const io = createTerminalIO(process.stdin, process.stdout, process.stderr);
  try {
    process.exitCode = await runSetup({
      argv: process.argv.slice(2),
      env: process.env,
      io,
      store: new JsonStore(config.dataDir),
      port: config.port,
      dataDir: config.dataDir,
    });
  } finally {
    io.close();
  }
}

if (isMainModule()) void main();
