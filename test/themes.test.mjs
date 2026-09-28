// Interface themes: every theme in renderer/js/themes.js has its colours in
// style.css, meets WCAG 2.2 contrast for the pairs the chrome actually draws,
// and leaves the viewport alone. Run: node test/themes.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const css = fs.readFileSync(path.join(here, '..', 'renderer', 'style.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const { THEMES } = await import('../renderer/js/themes.js');

let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  pass  ' : '  FAIL  ') + msg); if (!cond) failures++; };

const tokens = (body) => Object.fromEntries([...body.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map(m => [m[1], m[2].trim()]));
const blocks = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ selector: m[1].trim(), body: m[2] }));
const base = blocks.find(b => b.selector === ':root, #viewport');
const themeBlocks = Object.fromEntries(blocks.map(b => [/^:root\[data-theme="([\w-]+)"\]$/.exec(b.selector)?.[1], b]).filter(([k]) => k));

// WCAG 2.2 relative luminance and contrast ratio
const lum = (hex) => {
  const v = hex.replace('#', '').match(/../g).map(h => parseInt(h, 16) / 255).map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
};
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// [foreground, backgrounds, minimum]: what the chrome draws on what
const TEXT_AAA = 7, TEXT_AA = 4.5, NON_TEXT = 3;
const PAIRS = [
  ['text',   ['bg', 'panel', 'panel-2', 'field'], TEXT_AAA],                // body text, inputs
  ['text',   ['hover', 'accent-bg', 'select-bg', 'drop-bg'], TEXT_AA],      // hovered buttons and rows, selected rows
  ['muted',  ['bg', 'panel', 'panel-2', 'field', 'hover'], TEXT_AA],        // labels, units, hints, placeholders
  ['gold',   ['panel', 'panel-2', 'hover', 'accent-bg', 'select-bg'], TEXT_AA], // wordmark, active tools and toggles, selected names
  ['lapis',  ['panel', 'panel-2', 'drop-bg'], TEXT_AA],                     // measurement readouts
  ['danger', ['panel', 'panel-2', 'hover'], TEXT_AA],                       // Delete, warnings
  ['gold',   ['panel', 'panel-2', 'field'], NON_TEXT],                      // the focus ring
  ['lapis',  ['panel', 'drop-bg'], NON_TEXT]                                // drop-target outlines and insert lines
];
// every colour Ptah declares; a theme must set each one itself, so none silently inherits Ptah's
const NON_COLOR = new Set(['radius']);
const COLOR_TOKENS = Object.keys(tokens(base.body)).filter(k => !NON_COLOR.has(k));
const HEX = (v) => /^#[0-9a-f]{6}$/i.test(v);

console.log('\n[themes]');
const PAIRED = [...new Set(PAIRS.flatMap(([f, bs]) => [f, ...bs]))];
ok(base && COLOR_TOKENS.length >= 20 && PAIRED.every(t => HEX(tokens(base.body)[t] || '')), `Ptah's own colours are declared on :root and #viewport together (${COLOR_TOKENS.length} tokens, ${PAIRED.length} of them contrast-checked)`);
ok(THEMES[0].key === 'ptah' && THEMES.length === 6, 'Ptah first, then five themes: ' + THEMES.map(t => t.label).join(', '));
ok(THEMES.slice(1).every(t => themeBlocks[t.key]) && Object.keys(themeBlocks).every(k => THEMES.some(t => t.key === k)),
  'every theme has a style.css block and every block a theme');
ok(THEMES.slice(1).every(t => /\(MIT\)$/.test(t.credit || '')), 'every palette is credited as MIT');

for (const t of THEMES) {
  const own = t.key === 'ptah' ? {} : tokens(themeBlocks[t.key]?.body || '');
  const missing = t.key === 'ptah' ? [] : COLOR_TOKENS.filter(k => !own[k]);
  ok(missing.length === 0, `${t.label}: defines all ${COLOR_TOKENS.length} colour tokens itself${missing.length ? ' (missing ' + missing.join(', ') + ')' : ''}`);
  const c = { ...tokens(base.body), ...own };
  const worst = [];
  for (const [fg, bgs, min] of PAIRS) for (const bg of bgs) {
    const r = ratio(c[fg], c[bg]);
    if (r < min) worst.push(`${fg} on ${bg} ${r.toFixed(2)} < ${min}`);
  }
  const textMin = Math.min(...['bg', 'panel', 'panel-2', 'field'].map(b => ratio(c.text, c[b])));
  ok(worst.length === 0, `${t.label}: WCAG 2.2 AAA body text (${textMin.toFixed(1)}:1 at worst), AA for every other text, 3:1 for focus and outlines${worst.length ? ': ' + worst.join('; ') : ''}`);
  ok(t.key === 'ptah' || (own['color-scheme'] || 'dark') === t.scheme || /color-scheme:\s*light/.test(themeBlocks[t.key].body) === (t.scheme === 'light'),
    `${t.label}: native controls follow its ${t.scheme} scheme`);
}

// The viewport never changes: no theme block reaches into it, and outside the token
// blocks only the viewport's own overlays and the axis marks name a colour directly.
ok(!Object.values(themeBlocks).some(b => /#viewport/.test(b.selector)), 'no theme block targets the viewport');
// A focus indicator must be drawn in a colour the contrast pairs check at 3:1 (the accent):
// with the mouse, a field's or picker's border colour is its only sign of focus.
const FOCUS_OK = new Set(PAIRS.filter(([, , min]) => min <= NON_TEXT).map(([f]) => f));
const focusRules = blocks.filter(b => /:focus/.test(b.selector) && /(border-color|outline)\s*:/.test(b.body));
const weakFocus = focusRules.filter(b => [...b.body.matchAll(/(?:border-color|outline)\s*:[^;]*var\(--([\w-]+)\)/g)].some(m => !FOCUS_OK.has(m[1]))).map(b => b.selector);
ok(focusRules.length >= 8 && weakFocus.length === 0, `every focus rule (${focusRules.length}) draws its indicator in a contrast-checked colour` + (weakFocus.length ? ': not ' + weakFocus.join(', ') : ''));
const FIXED = /^(\.viewport-chip|#marquee|#walk-hud|\.ax-[xyz])/;
const stray = blocks.filter(b => !/^:root/.test(b.selector) && /#[0-9a-f]{3,8}\b|rgba?\(/i.test(b.body) && !FIXED.test(b.selector)).map(b => b.selector);
ok(stray.length === 0, 'the chrome takes every colour from a token' + (stray.length ? ': literal colours in ' + stray.join(', ') : ''));

console.log(failures ? `\n${failures} FAILURES` : '\nALL THEME TESTS PASSED');
process.exit(failures ? 1 : 0);
