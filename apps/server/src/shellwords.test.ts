import { describe, expect, it } from 'vitest';
import { joinCommand, quoteWord, splitCommand } from './shellwords';

describe('splitCommand', () => {
  it('splits on whitespace and groups quotes', () => {
    expect(splitCommand('a b   c')).toEqual(['a', 'b', 'c']);
    expect(splitCommand(`wmctrl -xa "my app" 'x y'`)).toEqual(['wmctrl', '-xa', 'my app', 'x y']);
    expect(splitCommand('')).toEqual([]);
    expect(splitCommand('   ')).toEqual([]);
  });
  it('keeps empty quoted args and Windows paths', () => {
    expect(splitCommand('a "" b')).toEqual(['a', '', 'b']);
    expect(splitCommand('"C:\\Program Files\\aa\\autoapp.exe" --full')).toEqual(['C:\\Program Files\\aa\\autoapp.exe', '--full']);
  });
  it('never interprets shell metacharacters', () => {
    expect(splitCommand('echo $(rm -rf /) ; reboot')).toEqual(['echo', '$(rm', '-rf', '/)', ';', 'reboot']);
  });
});

describe('quoteWord / joinCommand', () => {
  it('round-trips through splitCommand, whatever the word contains', () => {
    const words = [
      'plain',
      '/home/pi/RPI Head Unit/deploy/focus-window.sh',
      'C:\\Program Files\\aa\\autoapp.exe',
      'tab\there',
      "it's",
      'say "hi"',
      `both ' and "`,
      '',
      '$(reboot); `x`',
    ];
    for (const w of words) expect(splitCommand(quoteWord(w))).toEqual([w]);
    expect(splitCommand(joinCommand(...words))).toEqual(words);
  });
  it('leaves plain words alone and uses double quotes when it can', () => {
    expect(quoteWord('android-auto')).toBe('android-auto');
    expect(quoteWord('a b')).toBe('"a b"');
    expect(joinCommand('/opt/My Car/focus.sh', 'android-auto')).toBe('"/opt/My Car/focus.sh" android-auto');
  });
  it('keeps a helper path with spaces as one argv entry, followed by its argument', () => {
    const helper = '/home/pi/RPI Head Unit/deploy/focus-window.sh';
    expect(splitCommand(joinCommand(helper, 'android-auto'))).toEqual([helper, 'android-auto']);
    expect(splitCommand(joinCommand(helper, 'dashboard'))).toEqual([helper, 'dashboard']);
  });
});
