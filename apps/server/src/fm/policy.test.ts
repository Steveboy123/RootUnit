import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The server never runs the transmitter program, and never touches the radio hardware. It talks to a helper that does (on a board
 * that has been checked). These tests read the source to keep it that way: a new line that starts the program would be noticed.
 */
const here = dirname(fileURLToPath(import.meta.url));
const sources = readdirSync(here)
  .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
  .map((f) => ({ file: f, text: readFileSync(join(here, f), 'utf8') }));
// comments removed, so that explanations may mention what is forbidden
const code = (text: string) => text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\s\/\/ .*$/gm, '');

describe('the server and the transmitter program', () => {
  it('has sources to look at', () => {
    expect(sources.map((s) => s.file)).toEqual(expect.arrayContaining(['capture.ts', 'client.ts', 'config.ts', 'service.ts', 'remote.ts', 'routes.ts', 'store.ts', 'demo.ts']));
  });

  it('only the default spawn in service.ts starts any process, and only the sound recorder', () => {
    for (const { file, text } of sources) {
      const c = code(text);
      // (a type-only import starts nothing)
      const importsProcesses = /^import (?!type\b)[^;]*from 'node:child_process'/m.test(c) || /require\(['"](node:)?child_process['"]\)/.test(c);
      expect(importsProcesses, `${file} imports child_process`).toBe(file === 'service.ts');
      // (not a method of something else, like RegExp.exec)
      expect(c, file).not.toMatch(/(?<![.\w])(exec|execFile|execSync|execFileSync|spawnSync|fork)\s*\(/);
    }
    const service = code(sources.find((s) => s.file === 'service.ts')!.text);
    expect(service).toMatch(/import \{ spawn as spawnProcess \} from 'node:child_process'/);
    // the only place a command is named: the recorder
    const capture = code(sources.find((s) => s.file === 'capture.ts')!.text);
    expect(capture).toMatch(/opts\.command \?\? 'parec'/);
  });

  it('nothing names the transmitter program or the memory device', () => {
    for (const { file, text } of sources) {
      const c = code(text);
      expect(c, file).not.toMatch(/fm_transmitter/);
      expect(c, file).not.toMatch(/\/dev\/(mem|vcio|gpiomem)/);
      expect(c, file).not.toMatch(/vendor\//);
    }
  });

  it('opens a connection only to the host and ports it is configured with', () => {
    for (const { file, text } of sources) {
      const c = code(text);
      // no address of any kind is written into the code (the defaults are ports; the default host is in the configuration reader)
      if (file === 'config.ts') continue;
      expect(c, file).not.toMatch(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
      expect(c, file).not.toMatch(/https?:\/\//);
    }
  });

  it('the password is read out of its wrapper in two places only: the control request and the first line of the sound', () => {
    const where = sources.filter(({ text }) => /\.reveal\(\)/.test(code(text))).map((s) => s.file);
    expect(where.sort()).toEqual(['capture.ts', 'client.ts', 'config.ts']);
    for (const { file, text } of sources) {
      const n = (code(text).match(/\.reveal\(\)/g) ?? []).length;
      if (file === 'client.ts' || file === 'capture.ts') expect(n, file).toBe(1);
    }
  });
});
