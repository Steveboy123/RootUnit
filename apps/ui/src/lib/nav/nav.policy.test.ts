import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { APPEARANCE_CSS_VARS, PALETTE_CSS_VARS } from '../themes';

/**
 * The Pi performance and colour policy, applied to the navigation CSS (the rail, the editor, the Quick Panel's body and footer).
 * apply.test.ts holds the app-wide rules; these are the stricter ones the navigation work agreed to, scanned over every stylesheet that
 * the work touches, so a later change to any of them cannot quietly break the policy.
 */
const SRC = fileURLToPath(new URL('../../', import.meta.url));
const FILES = ['v2/nav.css', 'v2/navedit.css', 'v2/surfaces.css', 'styles.css', 'v2/shell.css'] as const;
/** Files that are new with the navigation work: nothing in them may blur, filter or contain, whatever the selector. */
const NEW_FILES = ['v2/nav.css', 'v2/navedit.css', 'v2/surfaces.css'] as const;

interface Rule {
  file: string;
  selector: string;
  body: string;
  media: string;
}
interface Decl extends Rule {
  prop: string;
  value: string;
}
interface Keyframes {
  file: string;
  name: string;
  body: string;
}

const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

function parse(file: string): { rules: Rule[]; keyframes: Keyframes[] } {
  const css = strip(readFileSync(join(SRC, file), 'utf8'));
  const rules: Rule[] = [];
  const keyframes: Keyframes[] = [];
  const walk = (text: string, media: string) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf('{', i);
      if (open < 0) break;
      let depth = 1;
      let j = open + 1;
      while (j < text.length && depth > 0) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
        j++;
      }
      const prelude = text.slice(i, open).trim();
      const body = text.slice(open + 1, j - 1);
      if (/^@keyframes/.test(prelude)) keyframes.push({ file, name: prelude.replace(/^@keyframes\s+/, ''), body });
      else if (/^@media/.test(prelude)) walk(body, prelude.replace(/^@media\s*/, '').replace(/\s+/g, ' '));
      else if (/^@(container|supports|layer)/.test(prelude)) walk(body, media);
      else if (prelude && !prelude.startsWith('@')) rules.push({ file, selector: prelude.replace(/\s+/g, ' '), body, media });
      i = j;
    }
  };
  walk(css, '');
  return { rules, keyframes };
}

const splitTop = (text: string, sep: string): string[] => {
  const out: string[] = [];
  let depth = 0;
  let cur = '';
  for (const ch of text) {
    if (ch === '(' || ch === '[') depth++;
    if (ch === ')' || ch === ']') depth--;
    if (ch === sep && depth === 0) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
};

const declsOf = (r: Rule): Decl[] =>
  splitTop(r.body, ';')
    .map((d) => {
      const k = d.indexOf(':');
      return k > 0 ? { ...r, prop: d.slice(0, k).trim(), value: d.slice(k + 1).trim() } : null;
    })
    .filter((d): d is Decl => d !== null);

const parsed = FILES.map((f) => ({ file: f, ...parse(f) }));
const rules = parsed.flatMap((p) => p.rules);
const keyframes = parsed.flatMap((p) => p.keyframes);
const all = rules.flatMap(declsOf);

/** A selector is the navigation's when any of its parts names a rail, nav, editor, or Quick Panel body/footer class. */
const SCOPE = /\.(rail|nav-[a-z0-9-]+|ne-[a-z0-9-]+|qp-foot|qp-body)(?![a-z0-9_])/;
const inScope = (selector: string) => splitTop(selector, ',').some((p) => SCOPE.test(p));
/** Everything in the navigation's own stylesheets, plus the navigation's selectors wherever else they live (the rail's rules in styles.css and shell.css). */
const scoped = all.filter((d) => (NEW_FILES as readonly string[]).includes(d.file) || inScope(d.selector));

const ALLOWED_TRANSITION = new Set(['opacity', 'transform', 'background-color', 'color', 'border-color']);
const FORBIDDEN_MOTION = /\b(left|right|top|bottom|width|height|margin(-[a-z]+)?|padding(-[a-z]+)?|inset|all)\b/;
const show = (d: Decl) => `${d.file}: ${d.selector} { ${d.prop}: ${d.value} }`;

describe('navigation CSS: the files are all there and are read', () => {
  it('finds the rail rules in every place the rail is styled', () => {
    expect(parsed.map((p) => p.rules.length > 0 || p.file === 'v2/navedit.css' || p.file === 'v2/surfaces.css')).toEqual(parsed.map(() => true));
    expect(scoped.some((d) => d.file === 'v2/nav.css' && /\.rail-scroll/.test(d.selector))).toBe(true);
    expect(scoped.some((d) => d.file === 'styles.css' && d.selector === '.rail')).toBe(true);
    expect(scoped.some((d) => d.file === 'v2/shell.css' && /\.rail-gap/.test(d.selector))).toBe(true);
  });
});

describe('navigation CSS: motion', () => {
  const transitions = scoped.filter((d) => d.prop === 'transition' || d.prop === 'transition-property');

  it('only opacity, transform, background-color, color and border-color ever transition', () => {
    expect(transitions.length).toBeGreaterThan(0);
    for (const d of transitions) {
      const props = d.prop === 'transition-property' ? splitTop(d.value, ',') : splitTop(d.value, ',').map((e) => e.split(/\s+/)[0]!);
      for (const p of props) expect(ALLOWED_TRANSITION.has(p) || p === 'none', show(d)).toBe(true);
    }
  });

  it('nothing that moves layout is in a transition or a @keyframes (left, top, width, height, margin...)', () => {
    for (const d of transitions) expect(FORBIDDEN_MOTION.test(d.value.replace(/\b\d*\.?\d+m?s\b/g, '')), show(d)).toBe(false);
    for (const k of keyframes) {
      const props = [...k.body.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]!);
      for (const p of props) expect(FORBIDDEN_MOTION.test(p), `${k.file}: @keyframes ${k.name}: ${p}`).toBe(false);
    }
  });

  it('every animation on a navigation selector has a matching `none` at effects=minimal', () => {
    const animated = scoped.filter((d) => (d.prop === 'animation' || d.prop === 'animation-name') && d.value !== 'none');
    const minimalNone = new Set(
      all
        .filter((d) => d.prop === 'animation' && d.value === 'none' && d.selector.includes("[data-effects='minimal']"))
        .flatMap((d) => splitTop(d.selector, ',').map((p) => p.replace(/\s+/g, ' '))),
    );
    for (const d of animated) {
      for (const part of splitTop(d.selector, ',').filter((p) => SCOPE.test(p))) expect(minimalNone.has(`[data-effects='minimal'] ${part}`), show(d)).toBe(true);
    }
  });

  it('the rail adds no @keyframes of its own (it reuses pop and fade)', () => {
    expect(keyframes.filter((k) => k.file === 'v2/nav.css')).toEqual([]);
  });
});

describe('navigation CSS: Pi budget (no filter, no new blur, no new paint containment)', () => {
  it('the new stylesheets have no filter, backdrop-filter or contain at all', () => {
    const bad = all.filter((d) => (NEW_FILES as readonly string[]).includes(d.file) && /^(-webkit-)?(backdrop-)?filter$|^contain(-[a-z-]+)?$|^content-visibility$/.test(d.prop));
    expect(bad.map(show)).toEqual([]);
  });

  it('no filter on any navigation selector, in any file', () => {
    expect(scoped.filter((d) => /^(-webkit-)?filter$/.test(d.prop)).map(show)).toEqual([]);
  });

  it('the rail keeps the one backdrop-filter and the one paint containment it always had, and nothing adds another', () => {
    const blur = scoped.filter((d) => /backdrop-filter/.test(d.prop));
    expect(blur.map((d) => `${d.file}: ${d.selector} = ${d.value}`)).toEqual(['styles.css: .rail = var(--card-filter)']);
    const contain = scoped.filter((d) => d.prop === 'contain');
    expect(contain.map((d) => `${d.file}: ${d.value}`)).toEqual(['styles.css: paint']);
    expect(contain[0]!.selector).toContain("[data-effects='full'][data-surface='glass'] .rail");
  });

  it('the new rules do not redeclare the rail\'s fill, blur or containment (only the border moves to the other edge on the right)', () => {
    const redeclared = scoped.filter((d) => d.file === 'v2/nav.css' && /^\.rail($|\[)/.test(d.selector) && /^(background(-color)?|backdrop-filter|contain|border|border-right|border-left)$/.test(d.prop));
    expect(redeclared.map((d) => `${d.selector} { ${d.prop} }`).sort()).toEqual([".rail[data-nav-pos='right'] { border-left }", ".rail[data-nav-pos='right'] { border-right }"]);
  });
});

describe('navigation CSS: colour and borders', () => {
  it('no raw colours: only theme tokens (hex, rgb(a)/hsl(a) with numbers, white and black are all out)', () => {
    const bad = scoped.filter((d) => d.prop !== 'content' && (/#[0-9a-fA-F]{3,8}\b/.test(d.value) || /\b(rgba?|hsla?)\(\s*\d/.test(d.value) || /\b(white|black)\b/i.test(d.value)));
    expect(bad.map(show)).toEqual([]);
  });

  it('no white-alpha: tints use rgba(var(--ink-rgb), a) so they work on the light palettes', () => {
    expect(scoped.filter((d) => /rgba\(\s*255\s*,\s*255\s*,\s*255/.test(d.value)).map(show)).toEqual([]);
  });

  it('every border width goes through --bw (none and 0 aside)', () => {
    const borders = scoped.filter((d) => /^border(-(top|right|bottom|left))?(-width)?$/.test(d.prop));
    expect(borders.length).toBeGreaterThan(0);
    for (const d of borders) expect(/^(none|0|0px|inherit|unset|initial)$/.test(d.value) || d.value.includes('var(--bw)'), show(d)).toBe(true);
  });

  it('every custom property read on a navigation selector is declared somewhere (or set by the theme engine)', () => {
    const declared = new Set<string>([...PALETTE_CSS_VARS, ...APPEARANCE_CSS_VARS, '--pct', '--col-min']);
    const sheets = [join(SRC, 'styles.css'), join(SRC, 'appearance.css'), join(SRC, 'backdrop.css'), ...readdirSync(join(SRC, 'v2')).filter((f) => f.endsWith('.css')).map((f) => join(SRC, 'v2', f))];
    for (const f of sheets) for (const m of strip(readFileSync(f, 'utf8')).matchAll(/(--[a-z0-9-]+)\s*:/g)) declared.add(m[1]!);
    const used = scoped.flatMap((d) => [...d.value.matchAll(/var\(\s*(--[a-z0-9-]+)/g)].map((m) => ({ d, name: m[1]! })));
    expect(used.length).toBeGreaterThan(0);
    expect(used.filter((u) => !declared.has(u.name)).map((u) => `${u.name} in ${show(u.d)}`)).toEqual([]);
  });
});

describe('navigation CSS: touch targets', () => {
  const interactive = (selector: string) =>
    splitTop(selector, ',').some((p) => {
      if (!SCOPE.test(p)) return false;
      const last = p.split(/\s*[>+~]\s*|\s+/).pop() ?? '';
      return /^button\b|^a\b|\[role=|(-btn|-row|-tile|-cell|-chip|-item|-pick|-opt|-option)(?![a-z0-9-])/.test(last);
    });

  it('an interactive control that sets a minimum height sets at least 44px', () => {
    const mins = scoped.filter((d) => d.prop === 'min-height' && interactive(d.selector) && /^\d+(\.\d+)?px$/.test(d.value));
    expect(mins.length).toBeGreaterThan(0);
    for (const d of mins) expect(parseFloat(d.value), show(d)).toBeGreaterThanOrEqual(44);
  });

  it('a rail button is never smaller than 44px, whatever size is chosen', () => {
    const rule = scoped.find((d) => d.file === 'v2/nav.css' && d.selector === '.rail button' && d.prop === 'min-height');
    expect(rule?.value).toBe('44px');
  });
});

describe('navigation CSS: the rail layout (spec section 3)', () => {
  const nav = scoped.filter((d) => d.file === 'v2/nav.css');
  const get = (selector: string, prop: string, media = '') => nav.find((d) => d.selector === selector && d.prop === prop && d.media === media)?.value;

  it('the scrolling head scrolls vertically only, quietly, and hands a finger to the page at its ends', () => {
    expect(get('.rail-scroll', 'overflow-y')).toBe('auto');
    expect(get('.rail-scroll', 'overflow-x')).toBe('hidden');
    expect(get('.rail-scroll', 'min-height')).toBe('0');
    expect(get('.rail-scroll', 'scrollbar-width')).toBe('none');
    expect(get('.rail-scroll', 'overscroll-behavior')).toBe('contain');
    expect(get('.rail-scroll', 'touch-action')).toBe('pan-y');
  });

  it('the fade is a mask (no blur) driven by data-fade-top and data-fade-bottom', () => {
    for (const sel of ["[data-fade-top='true']", "[data-fade-bottom='true']"]) expect(nav.some((d) => d.selector.includes(sel) && d.prop === 'mask-image'), sel).toBe(true);
  });

  it('both parts are in the touch-action pan-y list, and the horizontal list does not have them', () => {
    const panY = all.find((d) => d.file === 'styles.css' && d.prop === 'touch-action' && d.value === 'pan-y' && d.selector.includes('.sheet-body'));
    expect(panY?.selector).toContain('.rail-scroll');
    expect(panY?.selector).toContain('.rail-foot');
    const panX = all.find((d) => d.file === 'styles.css' && d.prop === 'touch-action' && d.value === 'pan-x' && d.selector.includes('.tabs'));
    expect(panX?.selector).not.toMatch(/\.rail/);
  });

  it('the divider is a fixed 8px; the padding is on the two parts (not on .rail, where a scroller would clip the active bar)', () => {
    expect(all.find((d) => d.file === 'v2/shell.css' && d.selector === '.rail-gap' && d.prop === 'height')?.value).toBe('8px');
    expect(all.some((d) => d.selector === '.rail' && /^padding/.test(d.prop))).toBe(false);
    expect(get('.rail-scroll, .rail-foot', 'padding-left')).toBe('var(--nav-pad-x)');
    expect(get('.rail-scroll', 'padding-top')).toBe('var(--nav-pad-y)');
    expect(get('.rail-foot', 'padding-bottom')).toBe('var(--nav-pad-y)');
  });

  it('sizes follow the spec table (default tier / the ≤520px tier): width, smallest button, icon, label font, padding and gaps', () => {
    const tier = '(max-height: 520px)';
    const num = (selector: string, prop: string, media: string) => parseFloat(get(selector, prop, media) ?? 'NaN');
    const table = {
      compact: { rail: [64, 60], nb: [48, 48], icon: [22, 20], font: [10, 10] },
      regular: { rail: [80, 68], nb: [52, 52], icon: [26, 22], font: [11, 10] },
      large: { rail: [96, 84], nb: [64, 56], icon: [30, 26], font: [12, 11] },
    } as const;
    for (const [size, t] of Object.entries(table)) {
      const sel = `:root [data-nav-size='${size}']`;
      expect([num(sel, '--rail', ''), num(sel, '--rail', tier)], `${size} rail`).toEqual([...t.rail]);
      expect([num(sel, '--nb', ''), num(sel, '--nb', tier)], `${size} nb`).toEqual([...t.nb]);
      expect([num(sel, '--nav-icon', ''), num(sel, '--nav-icon', tier)], `${size} icon`).toEqual([...t.icon]);
      expect([num(sel, '--nav-font', ''), num(sel, '--nav-font', tier)], `${size} font`).toEqual([...t.font]);
    }
    // padding and gaps: 10,7 / 6 / 5 at the default tier, 6,6 / 3 / 3 at the tight one, for every size
    expect(['--nav-pad-y', '--nav-pad-x', '--nav-gap', '--nav-igap'].map((p) => num(':root', p, ''))).toEqual([10, 7, 6, 5]);
    expect(['--nav-pad-y', '--nav-pad-x', '--nav-gap', '--nav-igap'].map((p) => num(':root [data-nav-size]', p, tier))).toEqual([6, 6, 3, 3]);
  });

  it('every button is at least 44px wide in every size on every screen (rail - two paddings - the 1px border)', () => {
    const tier = '(max-height: 520px)';
    const num = (selector: string, prop: string, media: string) => parseFloat(get(selector, prop, media) ?? 'NaN');
    for (const size of ['compact', 'regular', 'large']) {
      const sel = `:root [data-nav-size='${size}']`;
      const wide = num(sel, '--rail', '') - 2 * num(':root', '--nav-pad-x', '') - 1;
      const tight = num(sel, '--rail', tier) - 2 * num(':root [data-nav-size]', '--nav-pad-x', tier) - 1;
      expect(wide, `${size} default tier`).toBeGreaterThanOrEqual(44);
      expect(tight, `${size} ≤520px tier`).toBeGreaterThanOrEqual(44);
    }
  });

  it('sizes beat the shell\'s own `.app { --rail }` (more specific), so the attribute always decides', () => {
    for (const size of ['compact', 'regular', 'large']) expect(`:root [data-nav-size='${size}']`).toMatch(/^:root \[/);
    expect(all.filter((d) => d.prop === '--rail' && d.selector === '.app').length).toBeGreaterThan(0); // the old defaults are still there to be beaten
  });

  it('the label modes are opacity and layout-box variables, never width or height', () => {
    expect(get("[data-nav-labels='active']", '--nav-label-idle')).toBe('0');
    expect(get("[data-nav-labels='never']", '--nav-label-box')).toBe('none');
    expect(get(".rail button:not([data-active='true']) > span", 'opacity')).toBe('var(--nav-label-idle)');
    expect(get('.rail button > span', 'display')).toBe('var(--nav-label-box)');
    // inactive icons are --text (not --dim) once the label is not there to explain them
    expect(get("[data-nav-labels='active']", '--nav-idle')).toBe('var(--text)');
    expect(get("[data-nav-labels='never']", '--nav-idle')).toBe('var(--text)');
    expect(get(':root', '--nav-idle')).toBe('var(--dim)');
    // the label is an ellipsised span
    expect([get('.rail button > span', 'overflow'), get('.rail button > span', 'text-overflow'), get('.rail button > span', 'white-space'), get('.rail button > span', 'max-width')]).toEqual(['hidden', 'ellipsis', 'nowrap', '100%']);
  });

  it('on the right: the border and the active bar mirror, and .main rises above the rail so sheets paint over it', () => {
    expect(get(".rail[data-nav-pos='right']", 'border-left')).toBe('var(--bw) solid var(--card-border)');
    expect(get(".rail[data-nav-pos='right'] button[data-active='true']::before", 'right')).toBe('calc(-1 * var(--nav-pad-x))');
    expect(get(".app[data-nav-pos='right'] > .main", 'z-index')).toBe('2');
    expect(get(".app[data-nav-pos='left']", '--nav-l')).toBe('var(--rail)');
    expect(get(".app[data-nav-pos='right']", '--nav-r')).toBe('var(--rail)');
    expect([get(':root', '--nav-l'), get(':root', '--nav-r')]).toEqual(['0px', '0px']);
  });

  it('what sits beside the rail keeps off it on either side', () => {
    expect(get('.app .qp-backdrop', 'inset')).toBe('var(--top) var(--nav-r) 0 var(--nav-l)');
    expect(get('.app .alarm', 'left')).toBe('calc(var(--nav-l) + (100% - var(--nav-l) - var(--nav-r)) / 2)');
  });

  it('a held press fades the button with opacity alone', () => {
    const rule = nav.filter((d) => d.selector.includes("[data-pressing='true']"));
    expect(rule.map((d) => d.prop).sort()).toEqual(['opacity', 'transition']);
  });
});

describe('source: icons are named imports, never the whole library', () => {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  };
  walk(SRC);
  const lib = 'lucide' + '-react';
  const bad = [
    new RegExp(String.raw`import\s*\{[^}]*\bicons\b[^}]*\}\s*from\s*['"]${lib}['"]`),
    new RegExp(String.raw`import\s*\*\s*as\s+\w+\s+from\s*['"]${lib}`),
    new RegExp(String.raw`${lib}/dynamic`),
    new RegExp(String.raw`from\s*['"]${lib}/dist`),
  ];

  it('no `import { icons }`, no `* as ... from` the library, no dynamic icon import, anywhere in src', () => {
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((f) => !f.endsWith('nav.policy.test.ts') && bad.some((re) => re.test(readFileSync(f, 'utf8'))));
    expect(offenders.map((f) => relative(SRC, f))).toEqual([]);
  });
});
