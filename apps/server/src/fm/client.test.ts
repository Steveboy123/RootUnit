import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FM_PROTOCOL } from '@headunit/shared';
import { FmNodeClient } from './client';
import { FmSecret } from './config';
import { BASE_URL, FakeHelper, TOKEN, sleepFor } from './testing/fakes';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  expect(vi.getTimerCount(), 'a timer was left behind').toBe(0);
  vi.useRealTimers();
});

const make = (helper: FakeHelper) => new FmNodeClient({ baseUrl: BASE_URL, token: new FmSecret(TOKEN), fetch: helper.fetch as unknown as typeof fetch });

describe('FmNodeClient: what goes out', () => {
  it('status: GET /v1/status with the password as a bearer token, one request per connection, redirects refused', async () => {
    const h = new FakeHelper();
    const seen: RequestInit[] = [];
    const client = new FmNodeClient({
      baseUrl: BASE_URL,
      token: new FmSecret(TOKEN),
      fetch: (async (u: string, init: RequestInit) => {
        seen.push(init);
        return h.fetch(u, init);
      }) as unknown as typeof fetch,
    });
    const r = await client.status();
    expect(r.kind).toBe('ok');
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]).toMatchObject({ method: 'GET', path: '/v1/status' });
    expect(h.calls[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    expect(h.calls[0]!.headers.connection).toBe('close');
    expect(h.calls[0]!.body).toBeUndefined();
    expect(seen[0]!.redirect).toBe('error');
    expect(seen[0]!.cache).toBe('no-store');
  });

  it('start: POST /v1/start with a JSON body of exactly frequency and bandwidth', async () => {
    const h = new FakeHelper();
    const r = await make(h).start(100.6, 100);
    expect(r.kind).toBe('ok');
    expect(h.calls[0]).toMatchObject({ method: 'POST', path: '/v1/start', body: { frequency: 100.6, bandwidth: 100 } });
    expect(h.calls[0]!.headers['content-type']).toBe('application/json');
    expect(h.calls[0]!.headers.authorization).toBe(`Bearer ${TOKEN}`);
    if (r.kind === 'ok') expect(r.status).toMatchObject({ state: 'transmitting', frequency: 100.6 });
  });

  it('stop: POST /v1/stop', async () => {
    const h = new FakeHelper();
    expect((await make(h).stop()).kind).toBe('ok');
    expect(h.calls[0]).toMatchObject({ method: 'POST', path: '/v1/stop' });
  });

  it('the address is used as given, with no extra path', async () => {
    const h = new FakeHelper();
    const urls: string[] = [];
    const client = new FmNodeClient({ baseUrl: 'http://fm-node.local:9000', token: new FmSecret(TOKEN), fetch: (async (u: string, i: RequestInit) => (urls.push(u), h.fetch(u, i))) as unknown as typeof fetch });
    await client.status();
    expect(urls).toEqual(['http://fm-node.local:9000/v1/status']);
  });
});

describe('FmNodeClient: every way an answer can go', () => {
  it('401 is "the password does not match"', async () => {
    const h = new FakeHelper();
    h.token = 'another-password-entirely-1234';
    expect(await make(h).status()).toEqual({ kind: 'unauthorized' });
    expect(await make(h).start(100, 100)).toEqual({ kind: 'unauthorized' });
  });

  it('a helper that is down, slow or a router are all "not working", each with a short fixed reason', async () => {
    const h = new FakeHelper();
    h.mode = 'down';
    const down = await make(h).status();
    expect(down).toMatchObject({ kind: 'unreachable', why: 'connection refused' });
    h.mode = 'error500';
    expect(await make(h).status()).toMatchObject({ kind: 'unreachable' });
    h.mode = 'html';
    expect(await make(h).status()).toMatchObject({ kind: 'notahelper', why: 'not JSON' });
    h.mode = 'garbage';
    expect(await make(h).status()).toMatchObject({ kind: 'notahelper' });
    h.mode = 'redirect';
    expect(await make(h).status()).toMatchObject({ kind: 'unreachable' });
  });

  it('nothing the library says about a failure (it can hold the address, even the password) reaches the reason', async () => {
    const h = new FakeHelper();
    h.mode = 'down';
    const r = await make(h).status();
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(JSON.stringify(r)).not.toContain('192.168');
    const throwing = new FmNodeClient({ baseUrl: BASE_URL, token: new FmSecret(TOKEN), fetch: (async () => { throw new Error(`connect failed to ${BASE_URL} with ${TOKEN}`); }) as unknown as typeof fetch });
    const t = await throwing.status();
    expect(t).toEqual({ kind: 'unreachable', why: 'no answer' });
  });

  it('the reason is read from the error the library wraps, however deep, and is one of a few fixed phrases', async () => {
    const reason = async (error: unknown) => {
      const client = new FmNodeClient({
        baseUrl: BASE_URL,
        token: new FmSecret(TOKEN),
        fetch: (async () => {
          throw error;
        }) as unknown as typeof fetch,
      });
      const r = await client.status();
      return r.kind === 'unreachable' ? r.why : r.kind;
    };
    const wrapped = (code: string) => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(`connect ${code} 192.168.1.50:8788`), { code }) });
    expect(await reason(wrapped('ECONNREFUSED'))).toBe('connection refused');
    expect(await reason(wrapped('ENOTFOUND'))).toBe('unknown name');
    expect(await reason(wrapped('EHOSTUNREACH'))).toBe('no route');
    expect(await reason(wrapped('ECONNRESET'))).toBe('connection dropped');
    expect(await reason(wrapped('ETIMEDOUT'))).toBe('did not answer in time');
    expect(await reason(wrapped('SOMETHING_ELSE'))).toBe('no answer');
    // an address with both IPv4 and IPv6 gives several errors at once
    expect(await reason(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new AggregateError([]), { errors: [{ code: 'ECONNREFUSED' }, { code: 'ECONNREFUSED' }] }) }))).toBe('connection refused');
    // things that are not errors at all
    for (const odd of ['text', 42, null, undefined, { cause: { cause: { cause: { cause: { cause: { cause: { cause: { cause: { cause: { code: 'ECONNREFUSED' } } } } } } } } } }]) {
      expect(await reason(odd), String(odd)).toBe('no answer');
    }
  });

  it('gives up after 3 seconds and cancels the request', async () => {
    const h = new FakeHelper();
    h.mode = 'hang';
    const p = make(h).status();
    await sleepFor(2999);
    expect(h.aborted).toBe(0);
    await sleepFor(2);
    expect(await p).toEqual({ kind: 'unreachable', why: 'did not answer in time' });
    expect(h.aborted).toBe(1);
  });

  it('stop can be given a shorter time', async () => {
    const h = new FakeHelper();
    h.mode = 'hang';
    const p = make(h).stop(1000);
    await sleepFor(1001);
    expect(await p).toMatchObject({ kind: 'unreachable' });
  });

  it('an outside cancel ends the request at once', async () => {
    const h = new FakeHelper();
    h.mode = 'hang';
    const ctl = new AbortController();
    const p = make(h).status(ctl.signal);
    ctl.abort();
    expect(await p).toEqual({ kind: 'unreachable', why: 'cancelled' });
  });

  it('an already cancelled signal never sends anything useful and leaves no timer', async () => {
    const h = new FakeHelper();
    h.mode = 'hang';
    const ctl = new AbortController();
    ctl.abort();
    expect(await make(h).status(ctl.signal)).toMatchObject({ kind: 'unreachable' });
  });

  it('an answer that is far too long is not read to the end', async () => {
    const h = new FakeHelper();
    h.mode = 'huge';
    expect(await make(h).status()).toEqual({ kind: 'notahelper', why: 'answer too long' });
  });

  it('start: 400, 403 and 409 are the helper saying no, in its own words (cleaned and cut)', async () => {
    const h = new FakeHelper();
    h.nextStart = { status: 400, body: { error: 'The frequency\u0007 is\noutside the band.' + 'x'.repeat(500) } };
    const r = await make(h).start(100, 100);
    expect(r).toMatchObject({ kind: 'refused', code: 400 });
    if (r.kind === 'refused') {
      expect(r.message).toMatch(/^The frequency is outside the band\.x+$/);
      expect(r.message.length).toBeLessThanOrEqual(200);
      expect(r.message).not.toMatch(/[\u0000-\u001f]/);
    }
    h.nextStart = { status: 403, body: { error: 'Raspberry Pi 5 is not supported.' } };
    expect(await make(h).start(100, 100)).toEqual({ kind: 'refused', code: 403, message: 'Raspberry Pi 5 is not supported.' });
    h.nextStart = { status: 409, body: 'not json' };
    expect(await make(h).start(100, 100)).toMatchObject({ kind: 'refused', code: 409, message: expect.stringMatching(/failed to start/) });
    h.nextStart = { status: 400, body: { error: 42 } };
    expect(await make(h).start(100, 100)).toMatchObject({ kind: 'refused', code: 400, message: expect.stringMatching(/did not accept/) });
  });

  it('other answers (404, 405 ...) mean it is not the helper', async () => {
    const h = new FakeHelper();
    h.nextStart = { status: 404, body: {} };
    expect(await make(h).start(100, 100)).toMatchObject({ kind: 'notahelper', why: 'answer 404' });
  });

  it('the answer of the helper is cleaned the way the shared parser cleans it', async () => {
    const h = new FakeHelper();
    h.node.board = 'Pi\u0007 4\n';
    h.node.limits.min = 5; // clamped by the parser
    h.node.protocol = 7;
    const r = await make(h).status();
    expect(r.kind).toBe('ok');
    if (r.kind === 'ok') {
      expect(r.status.board).toBe('Pi  4 ');
      expect(r.status.limits.min).toBeGreaterThanOrEqual(60);
      expect(r.status.protocol).toBe(7);
      expect(r.status.protocol).not.toBe(FM_PROTOCOL);
    }
  });
});
