import { DEFAULT_SETTINGS, LOOK_KEYS, cleanLookName, lookFromUntrusted, type LookValues } from '@headunit/shared';

/**
 * Share codes for saved looks: `RU1.` and the look as base64url JSON, holding only what differs from the defaults (so a code is short
 * enough to paste in a message). Reading one goes through the same checks as any settings change: a damaged or hostile code can only
 * ever produce a valid look, or nothing.
 */
const PREFIX = 'RU1.';
/** Longer than any real code; anything bigger is refused before it is decoded. */
const MAX_CODE = 6000;

const toBase64Url = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64Url = (b64: string) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

/** The code for a look and its name. */
export function encodeLook(name: string, look: LookValues): string {
  const diff: Record<string, unknown> = {};
  for (const k of LOOK_KEYS) if (look[k] !== DEFAULT_SETTINGS[k]) diff[k] = look[k];
  return PREFIX + toBase64Url(JSON.stringify({ n: cleanLookName(name), l: diff }));
}

/** A look from a pasted code, or null if it is not one. White space around and inside (a code split over lines) is ignored. */
export function decodeLook(code: string): { name: string; look: LookValues } | null {
  const text = code.replace(/\s+/g, '');
  // base64url as written by encodeLook, or plain base64 (+ / =) from anything else that made one.
  if (!text.startsWith(PREFIX) || text.length > MAX_CODE || !/^[A-Za-z0-9_+/-]+={0,2}$/.test(text.slice(PREFIX.length))) return null;
  try {
    const raw: unknown = JSON.parse(fromBase64Url(text.slice(PREFIX.length)));
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const { n, l } = raw as { n?: unknown; l?: unknown };
    if (typeof l !== 'object' || l === null || Array.isArray(l)) return null;
    return { name: cleanLookName(n) || 'Shared look', look: lookFromUntrusted(l) };
  } catch {
    return null;
  }
}
