import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, apiRequest, apiSend } from './api';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const stub = (r: Response | Error) => {
  const fn = vi.fn(async () => {
    if (r instanceof Error) throw r;
    return r.clone();
  });
  vi.stubGlobal('fetch', fn);
  return fn;
};
const init = (fn: ReturnType<typeof stub>) => (fn.mock.calls[0] as unknown as [string, RequestInit])[1];

afterEach(() => vi.unstubAllGlobals());

describe('apiSend', () => {
  it('POSTs JSON by default (existing callers)', async () => {
    const fn = stub(reply(200, { ok: true }));
    expect(await apiSend('/api/x', { a: 1 })).toEqual({ data: { ok: true } });
    expect(init(fn)).toEqual({ method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"a":1}' });
  });

  it('supports PUT and DELETE, and sends no body when there is none', async () => {
    let fn = stub(reply(200, {}));
    await apiSend('/api/x', { a: 1 }, 'PUT');
    expect(init(fn).method).toBe('PUT');
    fn = stub(reply(200, {}));
    await apiSend('/api/x', undefined, 'DELETE');
    expect(init(fn)).toEqual({ method: 'DELETE' });
  });

  it('never throws: errors come back as { error }, with the server’s message and code', async () => {
    stub(reply(400, { error: 'Nope', code: 'scope' }));
    expect(await apiSend('/api/x', {})).toEqual({ error: { message: 'Nope', code: 'scope' } });
    stub(reply(500, {}));
    expect(await apiSend('/api/x', {})).toEqual({ error: { message: 'Error 500', code: undefined } });
    stub(new TypeError('offline'));
    expect(await apiSend('/api/x', {})).toEqual({ error: { message: 'Can’t reach the head unit' } });
  });
});

describe('apiRequest', () => {
  it('GETs by default and resolves with the body', async () => {
    const fn = stub(reply(200, { n: 1 }));
    expect(await apiRequest<{ n: number }>('/api/x')).toEqual({ n: 1 });
    expect(init(fn)).toEqual({ method: 'GET' });
  });

  it('throws an ApiRequestError carrying the message and code', async () => {
    stub(reply(403, { error: 'Sign in again.', code: 'auth' }));
    const err = await apiRequest('/api/x', 'POST', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toBeInstanceOf(Error);
    expect((err as ApiRequestError).message).toBe('Sign in again.');
    expect((err as ApiRequestError).code).toBe('auth');
  });
});
