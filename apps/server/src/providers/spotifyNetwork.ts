/**
 * Inspect Node/Undici connection failures without ever showing the underlying
 * request, response, OAuth code, cookies, or access/refresh tokens.
 * Errors from fetch can wrap the real code in cause.errors (AggregateError).
 */
const RETRYABLE = new Set(['EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'UND_ERR_CONNECT_TIMEOUT', 'ECONNREFUSED']);

export function networkCodes(error: unknown): string[] {
  const codes: string[] = [];
  const visited = new Set<object>();
  const visit = (value: unknown, depth: number) => {
    if (depth > 5 || !value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    const e = value as { code?: unknown; cause?: unknown; errors?: unknown };
    if (typeof e.code === 'string' && /^[A-Z][A-Z0-9_]{1,49}$/.test(e.code)) codes.push(e.code);
    visit(e.cause, depth + 1);
    if (Array.isArray(e.errors)) for (const child of e.errors.slice(0, 10)) visit(child, depth + 1);
  };
  visit(error, 0);
  return [...new Set(codes)];
}

/** Diagnoses token-exchange connection failures without exposing codes, tokens or URL query data. */
export function oauthNetworkFailure(service: 'Spotify' | 'TIDAL', error: unknown): string {
  const codes = networkCodes(error);
  if (codes.some((c) => ['EAI_AGAIN', 'ENOTFOUND', 'EAI_NONAME'].includes(c))) {
    return `Could not reach ${service} — the Pi could not resolve the token server (DNS). Check Wi-Fi and DNS.`;
  }
  if (codes.some((c) => ['ENETUNREACH', 'EHOSTUNREACH'].includes(c))) {
    return `Could not reach ${service} — the Pi has no network route to the token server (check IPv6 and routing).`;
  }
  if (codes.some((c) => ['UND_ERR_CONNECT_TIMEOUT', 'ETIMEDOUT', 'UND_ERR_HEADERS_TIMEOUT'].includes(c)) ||
      (error instanceof Error && error.name === 'TimeoutError')) {
    return `Could not reach ${service} — token server connection timed out. Check network routing and firewall.`;
  }
  if (codes.some((c) => ['CERT_HAS_EXPIRED', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN', 'ERR_TLS_CERT_ALTNAME_INVALID'].includes(c))) {
    return `Could not connect securely to ${service} (TLS certificate error). Check the Pi's clock and certificates.`;
  }
  if (codes.includes('ECONNREFUSED')) {
    return `Could not reach ${service} — token server connection refused. Check proxy, firewall and network.`;
  }
  return `Could not reach ${service} token server from Node.js. The login page loading in Chromium does not prove the backend connection works. Run the OAuth diagnostic.`;
}

export function spotifyNetworkFailure(error: unknown): string {
  // Preserve established wording used by the Spotify settings UI.
  return oauthNetworkFailure('Spotify', error).replace('Could not reach Spotify', "Couldn't reach Spotify");
}

/** Only retry failures that occurred while finding/establishing a connection. */
export function retryableSpotifyConnection(error: unknown): boolean {
  return networkCodes(error).some((c) => RETRYABLE.has(c));
}
