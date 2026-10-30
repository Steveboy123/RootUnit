#!/usr/bin/env bash
# Non-destructive Spotify login diagnostics. Never prints OAuth codes, tokens,
# client secrets, credential files, cookies, or full private URLs.
set -u
section() { printf '\n=== %s ===\n' "$1"; }
check_curl() {
  local label="$1" family="$2" target="$3" response=0
  if ! command -v curl >/dev/null 2>&1; then echo 'curl is not installed'; return; fi
  printf '%s: ' "$label"
  # HTTP 400/404/405 are fine: they demonstrate a working TLS connection.
  local code
  code="$(curl "$family" --noproxy '*' -sS -o /dev/null --connect-timeout 5 --max-time 10 -w '%{http_code}' "$target" 2>/dev/null)" || response=$?
  if [[ "$response" -ne 0 ]]; then echo "FAIL (curl code $response)"; else echo "HTTP $code (TLS connection works if not 000)"; fi
}
section 'Clock & runtime'
date -Is 2>/dev/null || date
node --version 2>/dev/null || echo 'Node.js not found'
if command -v timedatectl >/dev/null 2>&1; then
  timedatectl show -p NTPSynchronized --value 2>/dev/null | sed 's/^/Clock synchronized (systemd): /'
fi
section 'Head unit and callback listeners'
if command -v systemctl >/dev/null 2>&1; then systemctl is-active headunit.service 2>/dev/null || true; fi
for port in 8787 5173; do
  if ! command -v curl >/dev/null 2>&1; then break; fi
  code="$(curl --noproxy '*' -s -o /dev/null --max-time 3 -w '%{http_code}' "http://127.0.0.1:$port/auth/spotify/callback" 2>/dev/null)" || code='000'
  echo "127.0.0.1:$port callback: HTTP $code (400 or 302 is expected without a code; 000 is unreachable)"
done
section 'Spotify server connectivity (no account access required)'
check_curl 'accounts.spotify.com via IPv4' '-4' 'https://accounts.spotify.com/api/token'
check_curl 'accounts.spotify.com via IPv6' '-6' 'https://accounts.spotify.com/api/token'
check_curl 'api.spotify.com via IPv4' '-4' 'https://api.spotify.com/v1/me'
section 'Node.js fetch, same runtime used by the head unit'
node --input-type=module - <<'NODE'
import { setDefaultResultOrder } from 'node:dns';
setDefaultResultOrder('ipv4first');
const addr = ['https://accounts.spotify.com/api/token', 'https://api.spotify.com/v1/me'];
for (const url of addr) {
  const name = new URL(url).hostname;
  try {
    const r = await fetch(url, { method: 'GET', signal: AbortSignal.timeout(10000) });
    console.log(`${name}: HTTP ${r.status} — network/TLS OK (not an OAuth test)`);
    await r.body?.cancel();
  } catch (e) {
    const codes = [];
    function scan(v, depth = 0) {
      if (!v || typeof v !== 'object' || depth > 4) return;
      if (typeof v.code === 'string') codes.push(v.code);
      scan(v.cause, depth + 1);
      if (Array.isArray(v.errors)) for (const er of v.errors.slice(0, 5)) scan(er, depth + 1);
    }
    scan(e);
    console.log(`${name}: FAILED (${[...new Set(codes)].join(', ') || e.name})`);
  }
}
NODE
printf '\nIf IPv4 works but IPv6 fails, v2.8.4 prefers IPv4. If Node fails while curl works, check DNS/proxy/TLS.\n'
printf 'Share only this report, not any Spotify redirect URL containing code= or state=.\n'
