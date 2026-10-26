const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

/** "host:port" / "[::1]:port" → bare lowercase hostname. */
export function hostnameOf(hostHeader: string): string {
  const h = hostHeader.trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(1, h.indexOf(']'));
  return h.split(':')[0] ?? '';
}

/**
 * Guards against DNS rebinding: a hostile page can't make the browser send a
 * request to this server with an attacker-controlled Host header.
 */
export function isAllowedHost(hostHeader: string | undefined, extra: string[] = []): boolean {
  if (!hostHeader) return false;
  const name = hostnameOf(hostHeader);
  return LOOPBACK.has(name) || extra.includes(name);
}

/**
 * Guards against cross-site WebSocket / POST abuse. Requests without an Origin
 * (curl, native apps) are allowed — they can't be driven by a web page.
 */
export function isAllowedOrigin(origin: string | undefined, extra: string[] = []): boolean {
  if (!origin) return true;
  try {
    const name = hostnameOf(new URL(origin).host);
    return LOOPBACK.has(name) || extra.includes(name);
  } catch {
    return false;
  }
}
