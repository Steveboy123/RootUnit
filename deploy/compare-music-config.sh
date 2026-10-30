#!/usr/bin/env bash
# Read-only diagnostic: outputs no credentials, secrets, OAuth codes, or access tokens.
set -euo pipefail
project="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project"
echo '=== Music service settings / preservation check ==='
echo "Project release: $(node -p "require('./package.json').version" 2>/dev/null || echo unknown)"
if [[ -f "$project/.env" ]]; then env_args=("--env-file=$project/.env"); else env_args=(); fi
node "${env_args[@]}" --input-type=module - "$project" <<'NODE'
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const root=process.argv[2];
const data=resolve(process.env.HEADUNIT_DATA_DIR || join(root,'data'));
const safeJson=(path)=>{try{return JSON.parse(readFileSync(path,'utf8'))}catch{return null}};
const saved=safeJson(join(data,'credentials.json'))||{};
const digest=(s)=>typeof s==='string'&&s.length?createHash('sha256').update(s).digest('hex').slice(0,10):'none';
for(const [name,vars] of Object.entries({
  spotify:['SPOTIFY_CLIENT_ID','SPOTIFY_REDIRECT_URI'],
  tidal:['TIDAL_CLIENT_ID','TIDAL_REDIRECT_URI']
})){
  const c=saved[name]||{};
  const env=process.env[vars[0]]||'';
  const activeId=c.clientId||env;
  const source=c.clientId?'saved':env?'environment':'none';
  const savedUri=c.redirectUri;
  const envUri=process.env[vars[1]];
  const uriSource=savedUri?'saved':envUri?'environment':'default';
  const suffix=name==='spotify'?'spotify.json':'tidal.json';
  const token=safeJson(join(data,suffix));
  const tokenId=typeof token?.clientId==='string'?token.clientId:'';
  const matched=tokenId&&activeId?tokenId===activeId?'matches':'DIFFERENT CLIENT ID':'unknown';
  const ownSecret=name==='tidal'?(c.clientSecret?'saved':process.env.TIDAL_CLIENT_SECRET?'environment':'not set'):'n/a';
  console.log(`${name}: client source=${source}, ID fingerprint=${digest(activeId)}, callback source=${uriSource}, saved tokens=${Boolean(token?.refreshToken)}, token client=${matched}${name==='tidal'?`, secret source=${ownSecret}`:''}`);
  if(name==='spotify')console.log('  callback configured for port 5173:',(savedUri||envUri||`http://127.0.0.1:${process.env.PORT||8787}/auth/spotify/callback`).includes(':5173/'));
}
const staging=join(root,'private/music-services.json');
console.log('Unconsumed bundled provisioning file:',existsSync(staging)?'present (do not post its contents)':'absent');
console.log('No Client IDs, secrets, callback codes, or tokens were printed.');
NODE
node --input-type=module - <<'NODE'
try {
  const response=await fetch('http://127.0.0.1:8787/api/connections',{signal:AbortSignal.timeout(3000)});
  const result=await response.json();
  if(!response.ok)throw Error('API HTTP '+response.status);
  console.log('=== Running head unit connection state ===');
  for(const s of result.services||[]){
    if(!['spotify','tidal'].includes(s.service))continue;
    console.log(`${s.service}: configured=${Boolean(s.configured)}, connected=${Boolean(s.connected)}, pending=${Boolean(s.loginPending)}, client source=${s.clientIdSource||'unknown'}, redirect source=${s.redirectUriSource||'unknown'}`);
  }
}catch(err){console.log('Running API state unavailable:',err.name||'unknown');}
NODE
