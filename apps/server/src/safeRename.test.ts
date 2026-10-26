import { describe, expect, it, vi } from 'vitest';
import { safeRename } from './safeRename';

const busy = (code: string) => Object.assign(new Error(code), { code });
const noWait = () => Promise.resolve();

describe('safeRename', () => {
  it('on Windows, waits out a file that is briefly held open, then renames', async () => {
    const rename = vi.fn().mockRejectedValueOnce(busy('EPERM')).mockRejectedValueOnce(busy('EBUSY')).mockResolvedValueOnce(undefined);
    await safeRename('a.tmp', 'a', { rename, platform: 'win32', wait: noWait });
    expect(rename).toHaveBeenCalledTimes(3);
  });

  it('gives up after a few tries and reports the real error', async () => {
    const rename = vi.fn().mockRejectedValue(busy('EACCES'));
    await expect(safeRename('a.tmp', 'a', { rename, platform: 'win32', wait: noWait, attempts: 4 })).rejects.toMatchObject({ code: 'EACCES' });
    expect(rename).toHaveBeenCalledTimes(4);
  });

  it('does not retry an error that waiting cannot fix, or anywhere but Windows', async () => {
    const missing = vi.fn().mockRejectedValue(busy('ENOENT'));
    await expect(safeRename('a.tmp', 'a', { rename: missing, platform: 'win32', wait: noWait })).rejects.toMatchObject({ code: 'ENOENT' });
    expect(missing).toHaveBeenCalledTimes(1);
    const linux = vi.fn().mockRejectedValue(busy('EPERM'));
    await expect(safeRename('a.tmp', 'a', { rename: linux, platform: 'linux', wait: noWait })).rejects.toMatchObject({ code: 'EPERM' });
    expect(linux).toHaveBeenCalledTimes(1);
  });
});
