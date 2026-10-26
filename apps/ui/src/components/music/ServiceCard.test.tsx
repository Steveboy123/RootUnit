import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServiceConnection } from '@headunit/shared';
import { CopyButton } from '../CopyButton';
import { QrCode } from '../QrCode';
import { ServiceCard } from './ServiceCard';

// The real lock reads the car's speed from the live store, which server-side rendering can't change; the lock
// rule itself (speed, setting, passenger) is lib/driving.ts. Here we only check what the card does with it.
const car = vi.hoisted(() => ({ locked: false }));
vi.mock('../../lib/driving', () => ({ useTypingLocked: () => car.locked }));

// No DOM in these tests: they render the card to HTML and read it, which covers what each state shows.

const NOW = Date.UTC(2026, 9, 5, 12, 0, 0);
const DAY = 86_400_000;

const spotify = (over: Partial<ServiceConnection> = {}): ServiceConnection => ({
  service: 'spotify',
  label: 'Spotify',
  available: true,
  configured: true,
  clientId: '0123456789abcdef0123456789abcdef',
  clientIdSource: 'saved',
  dashboardUrl: 'https://developer.spotify.com/dashboard',
  redirectUri: 'http://127.0.0.1:8787/auth/spotify/callback',
  redirectUriSource: 'default',
  connected: false,
  loginPending: false,
  ...over,
});
const fresh = (over: Partial<ServiceConnection> = {}) => spotify({ configured: false, clientId: '', clientIdSource: 'none', ...over });
/** The real TIDAL: built into the server, usable on its Client ID + Client Secret, account sign-in optional. */
const tidal = (over: Partial<ServiceConnection> = {}): ServiceConnection =>
  fresh({
    service: 'tidal',
    label: 'TIDAL',
    dashboardUrl: 'https://developer.tidal.com/dashboard',
    redirectUri: 'http://127.0.0.1:8787/auth/tidal/callback',
    ...over,
  });
/** A service this build does not have (`available: false`) — the generic "not in this build" path. Neither real service is in this state. */
const unbuilt = (over: Partial<ServiceConnection> = {}): ServiceConnection => fresh({ available: false, ...over });

const render = (conn: ServiceConnection, props: { collapsible?: boolean; defaultOpen?: boolean } = {}) =>
  renderToStaticMarkup(<ServiceCard conn={conn} onChanged={() => {}} {...props} />);

const text = (html: string) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  car.locked = false;
});
afterEach(() => vi.useRealTimers());

describe('ServiceCard — first set-up', () => {
  it('walks through the four steps in plain words', () => {
    const html = render(fresh());
    const t = text(html);
    expect(t).toContain('Create an app');
    expect(t).toContain('Add this Redirect URI');
    expect(t).toContain('Paste your Client ID');
    expect(t).toContain('Sign in');
    expect(t).toContain('It has to match exactly');
    expect(t).toContain('You do not need the Client secret — this app never asks for it.');
    expect(t).toContain('Not set up');
  });

  it('shows the dashboard address with Copy and an Open link that opens a new tab safely', () => {
    const html = render(fresh());
    expect(html).toContain('https://developer.spotify.com/dashboard');
    expect(html).toMatch(/<a[^>]*href="https:\/\/developer\.spotify\.com\/dashboard"[^>]*>/);
    const open = html.match(/<a[^>]*href="https:\/\/developer\.spotify\.com\/dashboard"[^>]*>/)![0];
    expect(open).toContain('target="_blank"');
    expect(open).toContain('rel="noreferrer"');
    expect(html).toContain('aria-label="Copy dashboard address"');
  });

  it('marks the Open link so the kiosk can hide it (a new window there has no way back; Copy stays)', () => {
    const html = render(fresh());
    expect(html.match(/<a[^>]*href="https:\/\/developer\.spotify\.com\/dashboard"[^>]*>/)![0]).toContain('class="btn small svc-open"');
    expect(html).toContain('aria-label="Copy dashboard address"');
  });

  it('shows the exact Redirect URI in a copy box', () => {
    const html = render(fresh());
    expect(html).toContain('<code class="copy-box">http://127.0.0.1:8787/auth/spotify/callback</code>');
    expect(html).toContain('aria-label="Copy Redirect URI"');
  });

  it('gives the Client ID box the right keyboard hints and the 44px style', () => {
    const html = render(fresh());
    const input = html.match(/<input[^>]*aria-label="Spotify Client ID"[^>]*>/)![0];
    expect(input).toContain('autoCapitalize="off"');
    expect(input).toContain('autoCorrect="off"');
    expect(input).toContain('spellCheck="false"');
    expect(input).toContain('inputMode="text"');
    expect(input).toContain('class="svc-input"');
    expect(text(html)).toContain('32 letters and numbers');
  });

  it('keeps sign-in disabled until a Client ID is saved', () => {
    const html = render(fresh());
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Sign in on this screen<\/button>/);
    expect(html).not.toContain('href="/auth/spotify/login"');
    expect(text(html)).toContain('Save your Client ID first');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^]*?Sign in with your phone/);
  });

  it('does not offer test / sign out / forget before there is a Client ID', () => {
    const t = text(render(fresh()));
    expect(t).not.toContain('Test connection');
    expect(t).not.toContain('Sign out');
    expect(t).not.toContain('Forget Client ID');
  });
});

describe('ServiceCard — a saved Client ID', () => {
  it('shows it (it is not secret) with a Change action instead of the box', () => {
    const html = render(spotify());
    expect(html).toContain('0123456789abcdef0123456789abcdef');
    expect(text(html)).toContain('Change');
    expect(html).not.toContain('aria-label="Spotify Client ID"');
    expect(html).toContain('data-done="true"'); // step 3 is ticked off
  });

  it('offers the two sign-in routes, with the screen route as a link', () => {
    const html = render(spotify());
    expect(html).toMatch(/<a class="btn primary" href="\/auth\/spotify\/login">Sign in on this screen<\/a>/);
    expect(text(html)).toContain('Sign in with your phone');
    expect(text(html)).toContain('Ready to sign in');
  });

  it('offers Test, Sign out (disabled while signed out) and Forget', () => {
    const html = render(spotify());
    expect(text(html)).toContain('Test connection');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^]*?Sign out/);
    expect(text(html)).toContain('Forget Client ID');
  });

  it('does not offer Forget for a Client ID that comes from the environment, and says where it is from', () => {
    const html = render(spotify({ clientIdSource: 'env' }));
    expect(text(html)).not.toContain('Forget Client ID');
    expect(text(html)).toContain('set in the head unit’s environment settings');
  });

  it('shows when you signed in and when the sign-in lapses', () => {
    const html = render(spotify({ connected: true, connectedAt: NOW - 3 * DAY, loginExpiresAt: Date.UTC(2027, 3, 3, 12) }));
    const t = text(html);
    expect(t).toContain('Signed in 3 days ago.');
    expect(t).toMatch(/Spotify sign-ins last about six months — due around \d{1,2} \w+ 2027|Spotify sign-ins last about six months — due around \w+ \d{1,2}, 2027/);
    expect(t).toContain('Connected');
    expect(html).toMatch(/<button[^>]*class="btn danger"[^>]*>[^]*?Sign out/);
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>[^]*?Sign out/);
    // Signing in again is still possible, but no longer the main action.
    expect(html).toMatch(/<a class="btn" href="\/auth\/spotify\/login">Sign in on this screen<\/a>/);
  });

  it('does not claim a six-month limit for a service other than Spotify', () => {
    const t = text(render(tidal({ available: true, configured: true, clientId: 'abc_123-xyz', connected: true, loginExpiresAt: NOW + 10 * DAY })));
    expect(t).not.toContain('six months');
    expect(t).toContain('expected to last until around');
  });

  it('shows the service’s own message as a hint', () => {
    expect(text(render(spotify({ message: 'Spotify Premium is needed to control playback.' })))).toContain('Spotify Premium is needed to control playback.');
  });
});

describe('ServiceCard — problems', () => {
  it('sign-in expired: says so and offers to sign in again', () => {
    const html = render(spotify({ problem: 'login-expired' }));
    expect(text(html)).toContain('Your sign-in expired');
    expect(text(html)).toContain('Sign-in expired');
    expect(html).toMatch(/<a class="btn small primary" href="\/auth\/spotify\/login">Sign in again<\/a>/);
  });

  it('needs permissions: explains and offers to sign in again', () => {
    const html = render(spotify({ connected: true, problem: 'permissions', message: 'Allow “Liked songs” to use the heart button.' }));
    expect(text(html)).toContain('More permissions are needed');
    expect(text(html)).toContain('Allow “Liked songs” to use the heart button.');
    expect(html).toContain('Sign in again');
  });

  it('rejected: points at the Client ID and Redirect URI instead of a sign-in link', () => {
    const html = render(spotify({ problem: 'rejected' }));
    expect(text(html)).toContain('Spotify rejected this app');
    expect(text(html)).toContain('Check steps 2 and 3');
    expect(text(html)).toContain('Check Client ID');
    expect(html).not.toContain('Sign in again');
    expect(text(html)).toContain('Rejected by service');
  });
});

describe('ServiceCard — a service that is not in this build', () => {
  it('still takes the Client ID, but replaces sign-in with a plain note', () => {
    const html = render(unbuilt());
    const t = text(html);
    expect(html).toContain('aria-label="Spotify Client ID"');
    expect(t).toContain('Signing in to Spotify is not available in this version yet');
    expect(t).not.toContain('Sign in on this screen');
    expect(t).not.toContain('Sign in with your phone');
    expect(t).toContain('Not available yet');
    expect(html).toContain('https://developer.spotify.com/dashboard');
    expect(html).toContain('/auth/spotify/callback');
  });

  it('with a saved Client ID: can forget it, but has nothing to test or sign out of', () => {
    const t = text(render(unbuilt({ configured: true, clientId: 'abc_123-xyz', clientIdSource: 'saved' })));
    expect(t).toContain('Forget Client ID');
    expect(t).not.toContain('Test connection');
    expect(t).not.toContain('Sign out');
  });

  it('is the only case that shows the note: both real services offer sign-in', () => {
    expect(text(render(tidal()))).not.toContain('not available in this version');
    expect(text(render(fresh()))).not.toContain('not available in this version');
  });
});

describe('ServiceCard — TIDAL speaks TIDAL, not Spotify', () => {
  const stepTitles = (html: string) => [...html.matchAll(/<h4>([^<]*)<\/h4>/g)].map((m) => m[1]);

  it('has three steps in this order: create the app, paste ID + Secret, then an OPTIONAL sign-in', () => {
    expect(stepTitles(render(tidal()))).toEqual(['Create an app', 'Paste Client ID + Client Secret', 'Optional: sign in to your TIDAL account']);
    // Spotify keeps its four.
    expect(stepTitles(render(fresh()))).toEqual(['Create an app', 'Add this Redirect URI', 'Paste your Client ID', 'Sign in']);
  });

  it('numbers the steps 1, 2, 3', () => {
    const nums = [...render(tidal()).matchAll(/<span class="svc-num" aria-hidden="true">(?:<svg[^]*?<\/svg>|(\d))<\/span>/g)].map((m) => m[1]);
    expect(nums).toEqual(['1', '2', '3']);
  });

  it('asks for the Client ID AND the Client Secret (a password box) before anything else', () => {
    const html = render(tidal());
    expect(html).toContain('aria-label="TIDAL Client ID"');
    expect(html.match(/<input[^>]*aria-label="TIDAL Client Secret"[^>]*>/)![0]).toContain('type="password"');
    expect(text(html)).toContain('Copy both the Client ID and Client Secret');
    expect(text(html)).toContain('Client Secret is stored server-side');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>[^]*?Sign in on this screen/); // nothing to sign in with yet
    expect(text(html)).toContain('Save your Client ID and Client Secret first (step 2)');
  });

  it('folds the Redirect URI into the optional sign-in step instead of making it a mandatory-looking step 2', () => {
    const html = render(tidal());
    const signIn = html.slice(html.indexOf('Optional: sign in to your TIDAL account'));
    expect(signIn).toContain('<code class="copy-box">http://127.0.0.1:8787/auth/tidal/callback</code>');
    expect(text(signIn)).toContain('To sign in, first add this address as a Redirect URI');
    expect(html.indexOf('/auth/tidal/callback')).toBeGreaterThan(html.indexOf('Paste Client ID + Client Secret'));
    expect(text(html)).not.toContain('Add this Redirect URI');
  });

  it('carries no Spotify wording', () => {
    const t = text(render(tidal()));
    expect(t).not.toContain('Spotify');
    expect(t).not.toContain('Web API');
    expect(t).not.toContain('You do not need the Client secret');
  });

  it('says search and playback already work once the credentials are saved, with sign-in left optional', () => {
    const html = render(tidal({ configured: true, clientId: 'abc_123-xyz', clientIdSource: 'saved', clientSecretConfigured: true, clientSecretSource: 'saved' }));
    const t = text(html);
    expect(t).toContain('Search and playback already work. Signing in is optional');
    expect(t).toContain('Catalog ready');
    expect(t).toContain('Client Secret saved securely on the head unit');
    expect(html).toMatch(/<a class="btn primary" href="\/auth\/tidal\/login">Sign in on this screen<\/a>/);
    expect(t).toContain('Test connection');
    expect(t).toContain('Forget credentials');
  });

  it('a rejected TIDAL app mentions the Secret too', () => {
    const t = text(render(tidal({ configured: true, clientId: 'abc_123-xyz', problem: 'rejected' })));
    expect(t).toContain('TIDAL rejected this app');
    expect(t).toContain('The Client ID, the Client Secret or the Redirect URI does not match your developer app');
    expect(t).toContain('Check steps 2 and 3');
  });

  it('the driving lock names both fields', () => {
    car.locked = true;
    const t = text(render(tidal()));
    expect(t).toContain('Entering your Client ID and Client Secret is locked while driving');
    expect(t).toContain('I’m a passenger');
  });
});

describe('ServiceCard — Advanced', () => {
  it('needs a saved Client ID first', () => {
    expect(text(render(fresh()))).toContain('Save your Client ID first, then you can change these.');
  });

  it('offers a custom Redirect URI, and Reset only when one is in use', () => {
    expect(render(spotify())).toContain('Redirect URI</label>');
    expect(text(render(spotify()))).not.toContain('Reset to default');
    expect(text(render(spotify({ redirectUriSource: 'saved', redirectUri: 'https://car.example.com/cb' })))).toContain('Reset to default');
  });

  it('offers the permissions box for TIDAL only, with the blank-means-default hint', () => {
    expect(text(render(spotify()))).not.toContain('Permissions to ask for');
    const t = text(render(tidal({ configured: true, clientId: 'abc_123-xyz', clientIdSource: 'saved', requestedScopes: 'user.read' })));
    expect(t).toContain('Permissions to ask for');
    expect(t).toContain('Leave it blank to use the default permissions');
  });
});

describe('ServiceCard — layout wrapper', () => {
  it('is always open, with no fold, when not collapsible (sheets)', () => {
    const html = render(spotify());
    expect(html).toMatch(/^<section class="svc"/);
    expect(html).not.toContain('<details class="svc"');
  });

  it('is a <details> when collapsible, open only when asked', () => {
    expect(render(spotify(), { collapsible: true })).toMatch(/^<details class="svc" data-tone="idle"><summary/);
    expect(render(spotify(), { collapsible: true, defaultOpen: true })).toMatch(/^<details class="svc" data-tone="idle" open="">/);
  });

  it('puts the name, one-line summary and status pill in the header', () => {
    const html = render(spotify({ connected: true, connectedAt: NOW - 2 * DAY }), { collapsible: true });
    const head = html.match(/<summary[^]*?<\/summary>/)![0];
    expect(text(head)).toContain('Spotify');
    expect(text(head)).toContain('Signed in 2 days ago');
    expect(head).toContain('data-tone="ok"');
    expect(text(head)).toContain('Connected');
  });
});

describe('ServiceCard — locked while driving', () => {
  beforeEach(() => {
    car.locked = true;
  });

  it('replaces the Client ID box with the usual driving notice but keeps the read-only steps', () => {
    const html = render(fresh());
    expect(text(html)).toContain('Entering your Client ID is locked while driving');
    expect(text(html)).toContain('I’m a passenger');
    expect(html).not.toContain('<input');
    expect(html).toContain('http://127.0.0.1:8787/auth/spotify/callback');
    expect(text(html)).toContain('You do not need the Client secret');
  });

  it('also locks the advanced fields', () => {
    const html = render(spotify());
    expect(text(html)).toContain('Changing these settings is locked while driving');
    expect(html).not.toContain('<input');
  });

  it('shows the inputs again when the lock lifts', () => {
    car.locked = false;
    expect(render(fresh())).toContain('<input');
    expect(text(render(fresh()))).not.toContain('locked while driving');
  });
});

describe('QrCode', () => {
  const url = 'https://accounts.spotify.com/authorize?client_id=0123456789abcdef0123456789abcdef&state=' + 'z'.repeat(300);

  it('draws dark modules on a white square with a 4-module quiet zone, inline', () => {
    const html = renderToStaticMarkup(<QrCode value={url} label="QR code to sign in" />);
    expect(html).toMatch(/^<svg class="qr" viewBox="-4 -4 (\d+) \1"/);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="QR code to sign in"');
    expect(html).toMatch(/<rect[^>]*fill="#fff"/);
    expect(html).toMatch(/<path d="M[^"]+" fill="#000"/);
    expect(html).not.toContain('<canvas');
    expect(html).not.toContain('<img');
  });

  it('falls back to a plain note when the address cannot fit in a QR code', () => {
    const html = renderToStaticMarkup(<QrCode value={'x'.repeat(4000)} />);
    expect(html).not.toContain('<svg');
    expect(text(html)).toContain('too long to show as a QR code');
  });
});

describe('CopyButton', () => {
  it('starts as "Copy" with an accessible name that says what it copies', () => {
    const html = renderToStaticMarkup(<CopyButton text="abc" what="Redirect URI" />);
    expect(html).toContain('aria-label="Copy Redirect URI"');
    expect(text(html).trim()).toBe('Copy');
    expect(html).toContain('data-state="idle"');
  });
});
