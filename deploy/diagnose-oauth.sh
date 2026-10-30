#!/usr/bin/env bash
# Safe read-only OAuth diagnosis. Does not print client IDs, secrets, codes, tokens or query strings.
set -uo pipefail
section() { printf '\n=== %s ===\n' "$1"; }
section 'Clock and head unit'
date -Is 2>/dev/null || date
node --version 2>/dev/null || echo 'Node.js not found'
if command -v timedatectl >/dev/null 2>&1; then
  timedatectl show -p NTPSynchronized --value 2>/dev/null | sed 's/^/NTP synchronized: /'
fi
if command -v systemctl >/dev/null 2>&1; then
  printf 'headunit.service: '; systemctl is-active headunit.service 2>/dev/null || true
fi
section 'Local callback addresses (HTTP 400 means reachable; no login was attempted)'
for entry in '8787 auth/spotify/callback' '5173 auth/spotify/callback' '8787 auth/tidal/callback'; do
  read -r port path <<< "$entry"
  if command -v curl >/dev/null 2>&1; then
    result="$(curl --noproxy '*' --silent -o /dev/null --max-time 3 -w '%{http_code}' "http://127.0.0.1:${port}/${path}" 2>/dev/null)" || result=000
    echo "127.0.0.1:${port}/${path}: HTTP ${result}"
  fi
done
section 'Configured redirect addresses (no private credentials shown)'
node --input-type=module - <<'NODE'
try {
  const r = await fetch('http://127.0.0.1:8787/api/connections', {signal:AbortSignal.timeout(3500)});
  if(!r.ok) throw new Error('HTTP '+r.status);
  const d = await r.json();
  for (const v of d.services ?? []) {
    if (!['spotify','tidal'].includes(v.service)) continue;
    // Redirect URL is safe (no authorization code/query); user login status is non-secret.
    console.log(`${v.service}: callback=${v.redirectUri ?? 'missing'}, connected=${Boolean(v.connected)}, pending=${Boolean(v.loginPending)}`);
  }
} catch (e) { console.log('Head-unit settings unavailable:', e.name); }
NODE
section 'Token server TLS reachability: curl IPv4 (any HTTP response confirms connection)'
for entry in 'Spotify https://accounts.spotify.com/api/token' 'TIDAL https://auth.tidal.com/v1/oauth2/token'; do
  read -r name url <<< "$entry"
  if command -v curl >/dev/null 2>&1; then
    code="$(curl --noproxy '*' -4 -sS -o /dev/null --connect-timeout 5 --max-time 12 -w '%{http_code}' "$url" 2>/dev/null)"; status=$?
    if [[ "$status" -eq 0 ]]; then echo "${name}: HTTP $code (TLS reachable if not 000)"; else echo "${name}: FAILED (curl exit $status)"; fi
  fi
done
section 'Token server TLS reachability: head-unit Node.js fetch (no authorization sent)'
node --input-type=module - <<'NODE'
import {setDefaultResultOrder} from 'node:dns';
setDefaultResultOrder('ipv4first');
const urls=[['Spotify','https://accounts.spotify.com/api/token'],['TIDAL','https://auth.tidal.com/v1/oauth2/token']];
for (const [name,url] of urls) {
  try {
    const r=await fetch(url,{method:'GET',signal:AbortSignal.timeout(12000)});
    console.log(`${name}: HTTP ${r.status} (TLS reachable)`);
    await r.body?.cancel();
  } catch(e) {
    const codes=new Set(); const visited=new Set();
    function walk(v,level=0){if(level>5||!v||typeof v!=='object'||visited.has(v))return;visited.add(v);if(typeof v.code==='string')codes.add(v.code);walk(v.cause,level+1);if(Array.isArray(v.errors))v.errors.slice(0,6).forEach(x=>walk(x,level+1));}
    walk(e);
    console.log(`${name}: FAILED (${[...codes].join(', ') || e.name || 'unknown'})`);
  }
}
NODE
printf '\nNo Spotify or TIDAL account credentials have been displayed.\n'
printf 'If curl succeeds but Node fails, investigate the Pi Node TLS/proxy/IPv6 configuration.\n'
printf 'If the callback HTTP status is 000, that local listener is not accepting connections.\n'
