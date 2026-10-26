import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APPEARANCE_CSS_VARS, PALETTE_CSS_VARS } from '../lib/themes';

/**
 * The Pi's performance budget, held over every stylesheet. A Raspberry Pi 5 drives a 1024×600 panel smoothly as long as animation
 * stays on the compositor (transform and opacity), nothing animates layout, and the expensive effects (filter, backdrop blur) are
 * spent in exactly one place each. A later change that breaks any of this fails here rather than on the car.
 */

const DIR = fileURLToPath(new URL('.', import.meta.url));
const SRC = fileURLToPath(new URL('..', import.meta.url));
const FILES = readdirSync(DIR).filter((f) => f.endsWith('.css'));
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const CSS = Object.fromEntries(FILES.map((f) => [f, strip(readFileSync(join(DIR, f), 'utf8'))]));

interface Decl {
  file: string;
  selector: string;
  prop: string;
  value: string;
}

/** Top-level rules and the rules inside @media / @container / @supports, flattened; @keyframes are returned separately. */
function parse(file: string, css: string) {
  const decls: Decl[] = [];
  const keyframes: Array<{ file: string; name: string; body: string }> = [];
  const walk = (text: string) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      const head = text.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const body = text.slice(open + 1, j - 1);
      if (head.startsWith('@keyframes')) keyframes.push({ file, name: head.slice(10).trim(), body });
      else if (head.startsWith('@')) walk(body);
      else
        for (const d of body.split(';')) {
          const k = d.indexOf(':');
          if (k > 0) decls.push({ file, selector: head, prop: d.slice(0, k).trim(), value: d.slice(k + 1).trim() });
        }
      i = j;
    }
  };
  walk(css);
  return { decls, keyframes };
}

const parsed = FILES.map((f) => parse(f, CSS[f]!));
const decls = parsed.flatMap((p) => p.decls);
const keyframes = parsed.flatMap((p) => p.keyframes);

describe('stylesheets', () => {
  it('are all found and parsed', () => {
    expect(FILES.length).toBeGreaterThanOrEqual(15);
    expect(decls.length).toBeGreaterThan(2000);
    expect(keyframes.length).toBeGreaterThan(40);
  });
});

describe('motion stays on the compositor', () => {
  it('every @keyframes animates only transform and opacity (translate, rotate and scale are transforms)', () => {
    const allowed = new Set(['transform', 'opacity', 'translate', 'rotate', 'scale', 'animation-timing-function', 'offset-distance']);
    const bad: string[] = [];
    for (const k of keyframes) {
      for (const m of k.body.matchAll(/([a-z-]+)\s*:/g)) if (!allowed.has(m[1]!)) bad.push(`${k.file} @keyframes ${k.name}: ${m[1]}`);
    }
    expect(bad).toEqual([]);
  });

  it('no transition moves layout (left, top, width, height, margin, padding, inset, or "all")', () => {
    const layout = /^(left|right|top|bottom|width|height|min-[a-z]+|max-[a-z]+|margin(-[a-z]+)?|padding(-[a-z]+)?|inset|all|flex[a-z-]*|grid[a-z-]*|font-size)$/;
    const bad = decls
      .filter((d) => d.prop === 'transition' || d.prop === 'transition-property')
      .flatMap((d) => d.value.split(',').map((e) => ({ d, prop: e.trim().split(/\s+/)[0]! })))
      .filter(({ prop }) => layout.test(prop))
      .map(({ d, prop }) => `${d.file} ${d.selector}: ${prop}`);
    expect(bad).toEqual([]);
  });

  it('every animation names a @keyframes that exists', () => {
    const names = new Set(keyframes.map((k) => k.name));
    const css = new Set(['none', 'infinite', 'linear', 'both', 'forwards', 'backwards', 'alternate', 'alternate-reverse', 'reverse', 'ease', 'ease-in', 'ease-out', 'ease-in-out', 'paused', 'running', 'normal']);
    const bad: string[] = [];
    for (const d of decls.filter((x) => x.prop === 'animation' || x.prop === 'animation-name')) {
      let value = d.value;
      for (let prev = ''; prev !== value; ) [prev, value] = [value, value.replace(/[a-z-]*\([^()]*\)/g, ' ')];
      for (const part of value.split(',')) {
        const words = part
          .trim()
          .split(/\s+/)
          .filter((w) => /^[a-z][a-z0-9-]*$/.test(w) && !css.has(w));
        for (const w of words) if (!names.has(w)) bad.push(`${d.file} ${d.selector}: ${w}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('calm mode and driving stop the decorative motion', () => {
    expect(CSS['motion.css']).toMatch(/html\[data-calm='true'\] \.fx[^{]*\{[^}]*animation: none/);
    expect(CSS['motion.css']).toMatch(/html\[data-moving='true'\] \.fx:not\(\.fx-drive\)/);
    expect(CSS['motion.css']).toContain('prefers-reduced-motion');
  });
});

describe('the expensive effects are spent once', () => {
  it('filter is used only by the backdrop layer', () => {
    const uses = decls.filter((d) => d.prop === 'filter' && d.value !== 'none');
    expect(uses.map((d) => d.file)).toEqual(uses.map(() => 'layers.css'));
    expect(uses.length).toBeLessThanOrEqual(2);
  });

  it('backdrop-filter only ever reads --surface-blur (which is empty unless effects are Full)', () => {
    const bad = decls.filter((d) => /^(-webkit-)?backdrop-filter$/.test(d.prop) && !/^(var\(--surface-blur\)|none)$/.test(d.value));
    expect(bad.map((d) => `${d.file} ${d.selector}: ${d.value}`)).toEqual([]);
  });
});

describe('custom properties', () => {
  it('every var(--x) read in CSS is declared in CSS, set by the theme engine, or set inline by a component', () => {
    const declared = new Set<string>([...PALETTE_CSS_VARS, ...APPEARANCE_CSS_VARS].map(String));
    for (const d of decls) if (d.prop.startsWith('--')) declared.add(d.prop);
    // Components set some per element (an index for staggering, a hue, a needle position).
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
    for (const f of walk(SRC)) for (const m of readFileSync(f, 'utf8').matchAll(/['"`](--[a-z0-9-]+)['"`]/g)) declared.add(m[1]!);
    const missing = new Set<string>();
    for (const css of Object.values(CSS)) {
      for (const m of css.matchAll(/var\((--[a-z0-9-]+)\s*(,)?/g)) if (!declared.has(m[1]!) && !m[2]) missing.add(m[1]!);
    }
    expect([...missing].sort()).toEqual([]);
  });
});
