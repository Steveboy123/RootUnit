import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeQuickAction } from '@headunit/shared';
import { JsonStore } from '../store';
import { ActionError, QuickActions, classifyAddress } from './actions';

describe('classifyAddress', () => {
  it.each([
    ['127.0.0.1', 'loopback'],
    ['127.8.9.10', 'loopback'],
    ['::1', 'loopback'],
    ['10.1.2.3', 'private'],
    ['172.16.0.1', 'private'],
    ['172.31.255.255', 'private'],
    ['172.32.0.1', 'public'],
    ['192.168.1.20', 'private'],
    ['192.169.1.20', 'public'],
    ['100.64.0.1', 'private'], // carrier-grade NAT, where Tailscale lives
    ['100.128.0.1', 'public'],
    ['169.254.169.254', 'linklocal'],
    ['fe80::1', 'linklocal'],
    ['fd12:3456::1', 'private'],
    ['0.0.0.0', 'invalid'],
    ['224.0.0.1', 'invalid'],
    ['::', 'invalid'],
    ['ff02::1', 'invalid'],
    ['8.8.8.8', 'public'],
    ['2606:4700::1111', 'public'],
    ['::ffff:192.168.1.5', 'private'],
    ['::ffff:8.8.8.8', 'public'],
    ['not-an-ip', 'invalid'],
    ['', 'invalid'],
  ])('%s is %s', (ip, kind) => expect(classifyAddress(ip)).toBe(kind));
});

describe('sanitizeQuickAction', () => {
  const ok = { name: 'Garage', url: 'http://192.168.1.50/open', method: 'POST', body: '{"a":1}', icon: 'door', confirm: true };
  it('accepts a good one and normalises the address', () => {
    expect(sanitizeQuickAction(ok)).toEqual({ name: 'Garage', url: 'http://192.168.1.50/open', method: 'POST', body: '{"a":1}', icon: 'door', confirm: true });
  });
  it('defaults: GET, no body, the zap icon, no confirmation', () => {
    expect(sanitizeQuickAction({ name: 'x', url: 'https://example.com/a?b=1', body: 'ignored' })).toEqual({ name: 'x', url: 'https://example.com/a?b=1', method: 'GET', body: '', icon: 'zap', confirm: false });
  });
  it('refuses other schemes, embedded credentials and nonsense', () => {
    for (const bad of [null, 5, {}, { name: 'x' }, { url: 'http://a.b' }, { name: 'x', url: 'file:///etc/passwd' }, { name: 'x', url: 'ftp://a.b' }, { name: 'x', url: 'javascript:alert(1)' }, { name: 'x', url: 'http://user:pw@a.b/' }, { name: 'x', url: 'not a url' }, { name: '  ', url: 'http://a.b' }]) {
      expect(sanitizeQuickAction(bad)).toBeNull();
    }
  });
});

describe('QuickActions', () => {
  let dir: string;
  let store: JsonStore;
  let n = 0;
  beforeEach(async () => {
    n = 0;
    dir = await mkdtemp(join(tmpdir(), 'actions-'));
    store = new JsonStore(dir);
  });
  afterEach(async () => {
    await store.flush();
    await rm(dir, { recursive: true, force: true });
  });

  const make = (f: typeof fetch, resolve = async (host: string) => [host === 'ha.local' ? '192.168.1.10' : host === 'evil.example' ? '10.0.0.1' : '93.184.216.34']) => new QuickActions(store, { fetch: f, resolve, newId: () => `a${++n}000` });
  const fetchOk = (status = 200) => vi.fn(async () => new Response('secret body', { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

  it('never broadcasts the address: screens only get the name, icon and whether to confirm', async () => {
    const q = make(fetchOk());
    await q.start();
    await q.replace({ items: [{ name: 'Garage', url: 'http://ha.local:8123/api/webhook/SECRET-TOKEN', icon: 'door', confirm: true }] });
    expect(q.state.get()).toEqual([{ id: 'a1000', name: 'Garage', icon: 'door', confirm: true }]);
    expect(JSON.stringify(q.state.get())).not.toContain('SECRET-TOKEN');
    expect(q.config().items[0]!.url).toContain('SECRET-TOKEN'); // the editor does get it
  });

  it('calls a device on the car network and reports only the status, never the body', async () => {
    const f = fetchOk();
    const q = make(f);
    await q.start();
    await q.replace({ items: [{ name: 'Light', url: 'http://ha.local/api/light/on', method: 'POST', body: '{"on":true}' }] });
    const r = await q.run('a1000');
    expect(r).toEqual({ ok: true, status: 200, message: 'Done' });
    expect(JSON.stringify(r)).not.toContain('secret body');
    const [url, init] = (f as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://ha.local/api/light/on');
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual', body: '{"on":true}' });
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });

  it('refuses the internet unless the owner has allowed it, and never calls out', async () => {
    const f = fetchOk();
    const q = make(f);
    await q.start();
    await q.replace({ items: [{ name: 'Cloud', url: 'https://hooks.example.com/abc' }] });
    await expect(q.run('a1000')).rejects.toThrow('on the internet');
    expect(f).not.toHaveBeenCalled();
    await q.replace({ allowInternet: true, items: [{ id: 'a1000', name: 'Cloud', url: 'https://hooks.example.com/abc' }] });
    expect((await q.run('a1000')).ok).toBe(true);
  });

  it('checks where a NAME leads, not how it looks: a friendly name that points at the internet is refused', async () => {
    const q = make(fetchOk(), async () => ['8.8.8.8']);
    await q.start();
    await q.replace({ items: [{ name: 'Trick', url: 'http://printer.lan/x' }] });
    await expect(q.run('a1000')).rejects.toThrow('on the internet');
  });

  it('refuses a name with ANY public address among its answers', async () => {
    const q = make(fetchOk(), async () => ['192.168.1.5', '8.8.8.8']);
    await q.start();
    await q.replace({ items: [{ name: 'Mixed', url: 'http://mixed.lan/x' }] });
    await expect(q.run('a1000')).rejects.toThrow('on the internet');
  });

  it('never reaches link-local addresses (cloud metadata) even with the internet allowed', async () => {
    const f = fetchOk();
    const q = make(f);
    await q.start();
    await q.replace({ allowInternet: true, items: [{ name: 'Meta', url: 'http://169.254.169.254/latest/meta-data/' }, { name: 'Zero', url: 'http://0.0.0.0:8787/' }] });
    await expect(q.run('a1000')).rejects.toThrow('not allowed');
    await expect(q.run('a2000')).rejects.toThrow('not allowed');
    expect(f).not.toHaveBeenCalled();
  });

  it('reaches this very machine (a script on the Pi)', async () => {
    const f = fetchOk();
    const q = make(f);
    await q.start();
    await q.replace({ items: [{ name: 'Local', url: 'http://127.0.0.1:9000/go' }, { name: 'Local6', url: 'http://[::1]:9000/go' }] });
    expect((await q.run('a1000')).ok).toBe(true);
    expect((await q.run('a2000')).ok).toBe(true);
  });

  it('never follows a redirect, and treats a 3xx as the answer rather than chasing it', async () => {
    const f = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/' } }));
    const q = make(f as unknown as typeof fetch);
    await q.start();
    await q.replace({ items: [{ name: 'Redirect', url: 'http://ha.local/r' }] });
    const r = await q.run('a1000');
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as unknown as [string, RequestInit])[1].redirect).toBe('manual');
    expect(r.status).toBe(302);
  });

  it('says what went wrong in plain words', async () => {
    const down = make((async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch);
    await down.start();
    await down.replace({ items: [{ name: 'A', url: 'http://ha.local/' }] });
    expect(await down.run(down.config().items[0]!.id)).toEqual({ ok: false, status: null, message: 'Could not reach it.' });

    const slow = make((async () => {
      throw Object.assign(new Error('timeout'), { name: 'TimeoutError' });
    }) as unknown as typeof fetch);
    await slow.start();
    await slow.replace({ items: [{ name: 'A', url: 'http://ha.local/' }] });
    expect((await slow.run(slow.config().items[0]!.id)).message).toBe('No answer within 5 seconds.');

    const err500 = make(fetchOk(500));
    await err500.start();
    await err500.replace({ items: [{ name: 'A', url: 'http://ha.local/' }] });
    expect(await err500.run(err500.config().items[0]!.id)).toEqual({ ok: false, status: 500, message: 'The device answered 500.' });

    const gone = make(fetchOk(), async () => {
      throw new Error('ENOTFOUND');
    });
    await gone.start();
    await gone.replace({ items: [{ name: 'A', url: 'http://nope.invalid/' }] });
    await expect(gone.run(gone.config().items[0]!.id)).rejects.toThrow('Could not find');
  });

  it('keeps the ids of buttons that were edited, and gives new ones to new buttons', async () => {
    const q = make(fetchOk());
    await q.start();
    await q.replace({ items: [{ name: 'A', url: 'http://ha.local/a' }, { name: 'B', url: 'http://ha.local/b' }] });
    const [a, b] = q.config().items;
    await q.replace({ items: [{ id: b!.id, name: 'B renamed', url: 'http://ha.local/b' }, { id: 'forged', name: 'C', url: 'http://ha.local/c' }, { id: a!.id, name: 'A', url: 'http://ha.local/a' }] });
    const ids = q.config().items.map((i) => i.id);
    expect(ids[0]).toBe(b!.id);
    expect(ids[2]).toBe(a!.id);
    expect(ids[1]).not.toBe('forged');
  });

  it('rejects a bad list in one piece, naming the offending row, and keeps what it had', async () => {
    const q = make(fetchOk());
    await q.start();
    await q.replace({ items: [{ name: 'A', url: 'http://ha.local/a' }] });
    await expect(q.replace({ items: [{ name: 'Fine', url: 'http://ha.local/x' }, { name: 'Bad', url: 'javascript:1' }] })).rejects.toThrow('Action 2');
    await expect(q.replace({ items: 'nope' })).rejects.toBeInstanceOf(ActionError);
    await expect(q.replace({ items: Array.from({ length: 17 }, (_, i) => ({ name: `n${i}`, url: 'http://ha.local/' })) })).rejects.toThrow('At most 16');
    expect(q.state.get()).toHaveLength(1);
  });

  it('survives a restart, and an unknown id is a 404', async () => {
    const q = make(fetchOk());
    await q.start();
    await q.replace({ allowInternet: true, items: [{ name: 'A', url: 'http://ha.local/a' }] });
    await store.flush();
    const again = make(fetchOk());
    await again.start();
    expect(again.config().allowInternet).toBe(true);
    expect(again.config().items).toHaveLength(1);
    await expect(again.run('missing')).rejects.toMatchObject({ status: 404 });
  });
});
