import { inspect } from 'node:util';
import { describe, expect, it } from 'vitest';
import { FM_DEFAULT_AUDIO_PORT } from '@headunit/shared';
import { FM_NO_CONFIG, FmSecret, readFmConfig, scrubSecret } from './config';

const TOKEN = 'abcdef0123456789abcdef0123456789';

describe('FM configuration from the environment', () => {
  it('is not set up without a token, and says nothing about it', () => {
    expect(readFmConfig({})).toEqual(FM_NO_CONFIG);
    expect(readFmConfig({ FM_NODE_TOKEN: '   ' }).mode).toBe('none');
    expect(readFmConfig({}).problem).toBeNull();
  });

  it('a token alone means the helper on this Pi, with the default ports and source', () => {
    const c = readFmConfig({ FM_NODE_TOKEN: TOKEN });
    expect(c).toMatchObject({ mode: 'local', problem: null, host: '127.0.0.1', controlUrl: 'http://127.0.0.1:8788', audioPort: FM_DEFAULT_AUDIO_PORT, audioSource: '@DEFAULT_MONITOR@' });
    expect(c.token?.reveal()).toBe(TOKEN);
  });

  it('a helper on another address is remote; every way of writing this Pi is local', () => {
    expect(readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_NODE_URL: 'http://192.168.1.50:8788' })).toMatchObject({ mode: 'remote', host: '192.168.1.50', controlUrl: 'http://192.168.1.50:8788' });
    expect(readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_NODE_URL: 'http://fm-node.local:9000' })).toMatchObject({ mode: 'remote', host: 'fm-node.local', controlUrl: 'http://fm-node.local:9000' });
    for (const host of ['localhost', '127.0.0.1', '127.1.2.3', '[::1]', 'LOCALHOST']) {
      expect(readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_NODE_URL: `http://${host}:8788` }).mode, host).toBe('local');
    }
    // not loopback, whatever it looks like
    for (const host of ['127.0.0.1.example.com', '10.0.0.127', 'localhost.example.com']) expect(readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_NODE_URL: `http://${host}:8788` }).mode, host).toBe('remote');
  });

  it('an IPv6 address is connected to without its brackets', () => {
    const c = readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_NODE_URL: 'http://[::1]:8788' });
    expect(c.host).toBe('::1');
    expect(c.controlUrl).toBe('http://[::1]:8788');
  });

  it('no port in the address means the default port of the helper; an explicit :80 is kept', () => {
    expect(readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_NODE_URL: 'http://192.168.1.50' }).controlUrl).toBe('http://192.168.1.50:8788');
    expect(readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_NODE_URL: 'http://192.168.1.50:80' }).controlUrl).toBe('http://192.168.1.50:80');
    expect(readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_NODE_URL: 'http://192.168.1.50:8788/' }).controlUrl).toBe('http://192.168.1.50:8788');
  });

  it('only http: other schemes, passwords in the address, paths and junk are refused with a sentence', () => {
    for (const url of ['https://192.168.1.50:8788', 'ftp://x', 'ws://x', '192.168.1.50:8788', 'not a url', 'http://user:pw@192.168.1.50:8788', 'http://192.168.1.50:8788/v1', 'http://192.168.1.50:8788/?a=1', 'http://192.168.1.50:8788/#x', 'http://']) {
      const c = readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_NODE_URL: url });
      expect(c.mode, url).toBe('none');
      expect(c.token, url).toBeNull();
      expect(c.problem, url).toMatch(/FM_NODE_URL/);
    }
  });

  it('a URL without a token is explained; the token rules are checked', () => {
    expect(readFmConfig({ FM_NODE_URL: 'http://192.168.1.50:8788' }).problem).toMatch(/FM_NODE_TOKEN is empty/);
    for (const bad of ['short', 'has a space in it 0123456789', 'tab\tinside0123456789abcd', 'x'.repeat(101), 'unicode' + String.fromCharCode(233).repeat(10)]) {
      const c = readFmConfig({ FM_NODE_TOKEN: bad });
      expect(c.mode, JSON.stringify(bad)).toBe('none');
      expect(c.problem, JSON.stringify(bad)).toMatch(/FM_NODE_TOKEN/);
      // the value is never repeated in the sentence
      expect(c.problem).not.toContain(bad);
    }
    expect(readFmConfig({ FM_NODE_TOKEN: 'x'.repeat(100) }).mode).toBe('local');
    expect(readFmConfig({ FM_NODE_TOKEN: 'x'.repeat(16) }).mode).toBe('local');
  });

  it('audio port and source: defaults, valid values, and refusals', () => {
    expect(readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_NODE_AUDIO_PORT: '9999' }).audioPort).toBe(9999);
    expect(readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_AUDIO_SOURCE: 'alsa_output.usb.monitor' }).audioSource).toBe('alsa_output.usb.monitor');
    expect(readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_AUDIO_SOURCE: '  ' }).audioSource).toBe('@DEFAULT_MONITOR@');
    for (const port of ['0', '65536', '-1', 'abc', '80.5', '1e3', '123456']) expect(readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_NODE_AUDIO_PORT: port }).problem, port).toMatch(/FM_NODE_AUDIO_PORT/);
    expect(readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_AUDIO_SOURCE: 'a\nb' }).problem).toMatch(/FM_AUDIO_SOURCE/);
    expect(readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_AUDIO_SOURCE: 'x'.repeat(201) }).problem).toMatch(/FM_AUDIO_SOURCE/);
  });
});

describe('the password cannot leak by accident', () => {
  it('prints as stars through JSON, templates, inspect and console formatting', () => {
    const c = readFmConfig({ FM_NODE_TOKEN: TOKEN, FM_NODE_URL: 'http://192.168.1.50:8788' });
    for (const text of [JSON.stringify(c), JSON.stringify({ c }), `${c.token}`, String(c.token), inspect(c, { depth: 5 }), inspect(c.token), JSON.stringify(c.token)]) {
      expect(text).not.toContain(TOKEN);
    }
    expect(JSON.stringify(c)).toContain('***');
    // and a copy made the usual ways does not carry it either
    expect(JSON.stringify(structuredClone({ ...c, token: undefined }))).not.toContain(TOKEN);
  });

  it('scrubSecret removes it wherever it appears, and does nothing without one', () => {
    const t = new FmSecret(TOKEN);
    expect(scrubSecret(`error for ${TOKEN} and again ${TOKEN}`, t)).toBe('error for *** and again ***');
    expect(scrubSecret('nothing here', t)).toBe('nothing here');
    expect(scrubSecret('anything', null)).toBe('anything');
  });
});
