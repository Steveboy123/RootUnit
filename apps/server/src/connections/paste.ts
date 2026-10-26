/**
 * Sign-in from another device: the phone approves the app, is redirected to http://127.0.0.1:…/callback?code=…&state=…
 * (which can't load on the phone) and the user pastes that address — or just its query string — into the head unit.
 */
export function parsePastedLogin(text: unknown, serviceLabel: string): { code: string; state: string } {
  if (typeof text !== 'string') throw new Error('Paste the address you were sent to.');
  // Strip whitespace/newlines (copied URLs often wrap), quotes and <angle brackets>.
  const cleaned = text.replace(/\s+/g, '').replace(/^["'`<(]+|[>"'`)]+$/g, '');
  if (cleaned === '') throw new Error('Paste the address you were sent to.');
  if (cleaned.length > 4096) throw new Error('That is too long to be the address — copy just the web address from the browser’s address bar.');

  let query: string;
  const q = cleaned.indexOf('?');
  if (q >= 0) query = cleaned.slice(q + 1);
  else if (/^[a-z0-9_.~%-]+=/i.test(cleaned)) query = cleaned;
  else query = '';
  // Some providers append a #fragment.
  const hash = query.indexOf('#');
  if (hash >= 0) query = query.slice(0, hash);

  const params = new URLSearchParams(query);
  const error = params.get('error');
  if (error) {
    const detail = params.get('error_description');
    throw new Error(`${serviceLabel} said: ${error}${detail ? ` (${detail})` : ''}. Try signing in again.`);
  }
  const code = params.get('code');
  const state = params.get('state');
  if (!code || !state) {
    throw new Error(
      'That doesn’t look like the address you were sent to after approving. It should contain “code=” and “state=”. Copy the whole address from the browser’s address bar.',
    );
  }
  return { code, state };
}
