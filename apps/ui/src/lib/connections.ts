import { useCallback, useEffect, useRef, useState } from 'react';
import {
  SERVICE_INFO,
  type ConnectionsResponse,
  type MediaState,
  type MusicService,
  type SaveConnectionRequest,
  type ServiceConnection,
  type TestConnectionResult,
} from '@headunit/shared';
import { apiRequest } from './api';

// ---------------------------------------------------------------------------
// Status wording
// ---------------------------------------------------------------------------

export type StatusTone = 'ok' | 'warn' | 'bad' | 'idle';
export interface ConnectionStatus {
  tone: StatusTone;
  label: string;
}

/** One short phrase (and a colour) for where a service is in the setup, for the pill on its card. */
export function statusOf(conn: ServiceConnection): ConnectionStatus {
  if (!conn.available) return { tone: 'idle', label: 'Not available yet' };
  if (!conn.configured) return { tone: 'idle', label: 'Not set up' };
  if (conn.loginPending) return { tone: 'warn', label: 'Signing in…' };
  switch (conn.problem) {
    case 'login-expired':
      return { tone: 'warn', label: 'Sign-in expired' };
    case 'permissions':
      return { tone: 'warn', label: 'Needs permissions' };
    case 'rejected':
      return { tone: 'bad', label: 'Rejected by service' };
  }
  if (conn.connected) return { tone: 'ok', label: 'Connected' };
  if (conn.service === 'tidal') return { tone: 'ok', label: 'Catalog ready' };
  return { tone: 'idle', label: 'Ready to sign in' };
}

/** Nothing left to do for this service: signed in, or (TIDAL) credentials saved without trouble: its catalog works without an account sign-in. */
const isSetUp = (s: ServiceConnection) => s.connected || (s.available && s.service === 'tidal' && s.configured && !s.problem);

/**
 * Which card starts open in Settings: the first service with something to fix or finish; failing that, the
 * first available service while nothing is set up yet (so a first-time visit shows the steps).
 */
export function pickOpenService(services: ServiceConnection[]): MusicService | null {
  const broken = services.find((s) => s.available && (s.problem || (s.service !== 'tidal' && s.configured && !s.connected)));
  if (broken) return broken.service;
  if (services.some(isSetUp)) return null;
  return services.find((s) => s.available)?.service ?? null;
}

/** "Signed in 3 days ago". */
export function timeAgo(then: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'} ago`;
  if (s < 60) return 'just now';
  if (s < 3600) return unit(Math.floor(s / 60), 'minute');
  if (s < 86_400) return unit(Math.floor(s / 3600), 'hour');
  if (s < 86_400 * 45) return unit(Math.floor(s / 86_400), 'day');
  return unit(Math.floor(s / (86_400 * 30)), 'month');
}

/** The one-line summary under a service's name on its card. */
export function hintOf(conn: ServiceConnection, now: number = Date.now()): string {
  if (!conn.available) return `Sign-in for ${conn.label} is not part of this version yet`;
  if (!conn.configured) return conn.service === 'tidal' ? 'Add your Client ID + Client Secret to get started' : 'Add your Client ID to get started';
  if (conn.loginPending) return 'Waiting for you to approve the sign-in';
  if (conn.problem === 'login-expired') return 'Sign in again to carry on';
  if (conn.problem === 'permissions') return 'Sign in again and allow every permission';
  if (conn.problem === 'rejected') return 'Check the Client ID and Redirect URI';
  if (conn.connected) return conn.connectedAt ? `Signed in ${timeAgo(conn.connectedAt, now)}` : 'Signed in';
  if (conn.service === 'tidal') return 'Catalog API ready — account sign-in optional';
  return 'Client ID saved — sign in to finish';
}

/**
 * The sentence under "Set up {label}" on the Music page. TIDAL takes a Client ID AND a Client Secret and plays without any account
 * sign-in; Spotify takes just a Client ID and then needs a sign-in. (Saying "sign in" for TIDAL promised a library that is not there.)
 */
export function setupBlurb(service: MusicService): string {
  return service === 'tidal'
    ? 'Create a developer app, then paste its Client ID and Client Secret. Search and playback work as soon as they are saved; signing in to a TIDAL account is optional. It takes a couple of minutes and you only do it once.'
    : `Add your ${SERVICE_INFO[service].label} Client ID once, then sign in. It takes a couple of minutes and you only do it once.`;
}

/** The sentence under "Connect {label}": credentials are saved but there is no usable sign-in. */
export function connectBlurb(service: MusicService): string {
  return service === 'tidal'
    ? 'Search and playback work without signing in. Sign in only if you want the TIDAL account features that third-party apps are allowed to use.'
    : 'Sign in once and your library, playlists and now-playing appear here. Spotify Premium is required for playback control.';
}

/** For a service this build really does not have (`conn.available === false`). */
export function unavailableBlurb(label: string): string {
  return `This version of the head unit was built without ${label}. You can pick a different music source in Settings.`;
}

/** "5 Nov 2026" (in the browser's language unless a locale is given). */
export function formatDate(ts: number, locale?: string): string {
  return new Date(ts).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Which service is the player using?
// ---------------------------------------------------------------------------

/** The real service behind the active player, or null while state is unavailable. */
export function serviceOfProvider(provider: MediaState['provider'] | undefined): MusicService | null {
  return provider === 'spotify' || provider === 'tidal' ? provider : null;
}

/** "Spotify" / "TIDAL" — for the Music tab and active-player messages. */
export function providerLabel(provider: MediaState['provider'] | undefined): string {
  const service = serviceOfProvider(provider);
  return service ? SERVICE_INFO[service].label : 'Music service';
}

// ---------------------------------------------------------------------------
// API wrappers — each resolves with the data or throws an Error with the server's plain-language message
// ---------------------------------------------------------------------------

const base = (service: MusicService) => `/api/connections/${service}`;

export async function fetchConnections(): Promise<ServiceConnection[]> {
  const r = await apiRequest<ConnectionsResponse>('/api/connections');
  return r.services;
}

export function saveConnection(service: MusicService, req: SaveConnectionRequest): Promise<ServiceConnection> {
  return apiRequest<ServiceConnection>(base(service), 'PUT', req);
}

/** Sign out; with `forget`, also remove the saved Client ID (and Redirect URI / permissions). */
export function signOut(service: MusicService, forget = false): Promise<ServiceConnection> {
  return apiRequest<ServiceConnection>(`${base(service)}${forget ? '?forget=1' : ''}`, 'DELETE');
}

/** Start a sign-in and get the service's authorize address (nothing is redirected). */
export async function beginLogin(service: MusicService): Promise<string> {
  const r = await apiRequest<{ url?: unknown }>(`${base(service)}/login`, 'POST');
  if (typeof r.url !== 'string' || r.url === '') throw new Error('The head unit did not return a sign-in address. Try again.');
  return r.url;
}

/** Finish a sign-in from the address the phone ended up on. */
export function pasteLogin(service: MusicService, text: string): Promise<ServiceConnection> {
  const t = text.trim();
  if (t === '') return Promise.reject(new Error('Paste the address from your phone first.'));
  return apiRequest<ServiceConnection>(`${base(service)}/paste`, 'POST', { text: t });
}

export function testConnection(service: MusicService): Promise<TestConnectionResult> {
  return apiRequest<TestConnectionResult>(`${base(service)}/test`, 'POST');
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

/** While a sign-in is waiting (e.g. approved on a phone), look again this often. */
export const POLL_MS = 3000;

export const shouldPoll = (services: ServiceConnection[] | null): boolean => !!services?.some((s) => s.loginPending);

const messageOf = (e: unknown) => (e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.');

/**
 * The state of every service. Reloads when the tab regains focus (you come back from approving on the phone)
 * and every few seconds while a sign-in is pending.
 */
export function useConnections() {
  const [services, setServices] = useState<ServiceConnection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const live = useRef(true);

  const reload = useCallback(async () => {
    const mine = ++seq.current; // a newer request supersedes this one, so a slow reply can't overwrite fresh data
    setBusy(true);
    try {
      const list = await fetchConnections();
      if (!live.current || mine !== seq.current) return;
      setServices(list);
      setError(null);
    } catch (e) {
      if (!live.current || mine !== seq.current) return;
      setError(messageOf(e));
    } finally {
      if (live.current && mine === seq.current) setBusy(false);
    }
  }, []);

  /** Show a state a change just returned straight away, then confirm it with the server. */
  const update = useCallback(
    (conn?: ServiceConnection) => {
      if (conn) setServices((prev) => prev?.map((s) => (s.service === conn.service ? conn : s)) ?? prev);
      void reload();
    },
    [reload],
  );

  useEffect(() => {
    live.current = true;
    void reload();
    return () => {
      live.current = false;
    };
  }, [reload]);

  useEffect(() => {
    const again = () => {
      if (document.visibilityState !== 'hidden') void reload();
    };
    window.addEventListener('focus', again);
    document.addEventListener('visibilitychange', again);
    return () => {
      window.removeEventListener('focus', again);
      document.removeEventListener('visibilitychange', again);
    };
  }, [reload]);

  const polling = shouldPoll(services);
  useEffect(() => {
    if (!polling) return;
    const t = window.setInterval(() => void reload(), POLL_MS);
    return () => window.clearInterval(t);
  }, [polling, reload]);

  return { services, error, busy, reload, update };
}
