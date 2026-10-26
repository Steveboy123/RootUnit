import type { ConnectionProblem, TestConnectionResult } from '@headunit/shared';
import type { MediaProvider } from '../providers/media';

/** What a service reports about its own sign-in. Never contains tokens. */
export interface ServiceAuthInfo {
  connected: boolean;
  /** A login link was issued and the redirect hasn't come back yet. */
  loginPending: boolean;
  problem?: ConnectionProblem;
  message?: string;
  /** Epoch ms of the last successful sign-in. */
  connectedAt?: number;
  /** Epoch ms when the sign-in is expected to lapse, if the service says so. */
  loginExpiresAt?: number;
  /** Permissions the current sign-in was granted. */
  scopes?: string[];
}

/** Sign-in operations every music service implements (Spotify, TIDAL). */
export interface ServiceAuth {
  /** Start a sign-in and return the web address to send the user to. */
  beginLogin(): string;
  /** Finish a sign-in with the `code`/`state` from the redirect. Throws an Error with a plain-language message. */
  finishLogin(code: string, state: string): Promise<void>;
  /** Finish a sign-in from whatever the user pasted (see `parsePastedLogin`). Throws a plain-language Error. */
  finishLoginFromPaste(text: string): Promise<void>;
  /** Forget the tokens (does not touch the saved Client ID). */
  logout(): Promise<void>;
  connection(): ServiceAuthInfo;
  /** Make one cheap authenticated request to prove the sign-in works. */
  test(): Promise<TestConnectionResult>;
}

/** Short-lived credentials supplied only to the local kiosk for TIDAL's official Web Player SDK. Never includes a refresh token or Client Secret. */
export interface TidalPlayerCredential {
  clientId: string;
  accessToken: string;
  expiresAt: number;
  scopes: string[];
  source: 'user' | 'client';
}

export interface TidalPlayerCredentialBundle {
  primary: TidalPlayerCredential;
  fallback?: TidalPlayerCredential;
}

/** Short-lived Spotify token handed only to the local kiosk for Spotify's official Web Playback SDK. */
export interface SpotifyPlayerCredential {
  accessToken: string;
  expiresAt: number;
  scopes: string[];
}

/** A music service: a player + library (MediaProvider) that also knows how to sign in. */
export type MusicServiceProvider = MediaProvider & ServiceAuth & {
  /** TIDAL implements this; other services leave it undefined. */
  playerCredentials?(): Promise<TidalPlayerCredentialBundle>;
  /** Spotify implements this for the local Chromium Web Playback SDK. */
  spotifyPlayerCredentials?(): Promise<SpotifyPlayerCredential>;
};

/** What a service needs from the user, resolved from saved credentials > environment > defaults. */
export interface ServiceSettings {
  clientId: string;
  /** TIDAL catalog Client Credentials secret. Never expose this through connection responses. */
  clientSecret?: string;
  redirectUri: string;
  /** Space-separated; empty = the service's default permissions. */
  scopes: string;
}
