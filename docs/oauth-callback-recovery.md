# Spotify + TIDAL OAuth callback recovery (v2.8.5)

After pressing **Allow**, the provider redirects to the local Raspberry Pi callback.
The Pi then makes a separate outbound HTTPS **token exchange**. Chromium being able
to display the Spotify/TIDAL approval page does not prove the Node.js backend can
reach the token server. Success is only reported after tokens were saved locally.

- Spotify configured redirect: `http://127.0.0.1:8787/auth/spotify/callback`.
  The installed backend receives this callback directly; 5173 is reserved for the development UI.
- TIDAL normally redirects to `http://127.0.0.1:8787/auth/tidal/callback`.
- The callback URL must match the provider developer dashboard exactly.
- Always start the sign-in on the **Pi touchscreen** when using a `127.0.0.1`
  callback. If authorizing on a phone, `127.0.0.1` refers to the phone, not the Pi.
  The head unit has a separate **Sign in with your phone** / paste URL flow.

If the callback reports a DNS/network/TLS failure, try refreshing it **once**
within the authorization-code lifetime. v2.8.5 temporarily retains PKCE state
for that attempt (it does not consider the account connected unless tokens were saved).
If Spotify/TIDAL refuses the authorization code, start a fresh sign-in, since a
code might have been consumed by the remote server.

Run the safe combined diagnostic on the Pi:

```bash
cd "$(systemctl show -p WorkingDirectory --value headunit.service)"
bash ./deploy/diagnose-oauth.sh
```

It checks callback ports, configured redirect addresses, clock, outbound TLS to
both token endpoints via curl **and** via the same Node.js fetch used by the
head unit. It does not print OAuth codes, tokens or developer secrets.

**If Node.js fails while curl succeeds:** look for a proxy environment variable,
broken IPv6, DNS issues, system clock/certificates. Report the diagnostic output
rather than pasting an OAuth redirect URL (which contains short-lived credentials).

**If 8787 reports HTTP 000:** check `journalctl -u headunit.service -b --no-pager`
for a backend listener error. The backend on port 8787 must be running. Avoid copying log lines containing `code=` or `state=`.
