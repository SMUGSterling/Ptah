// themes.js — the interface themes (top bar Theme picker).
//
// A theme recolours the chrome around the viewport: the top bar, tool rail,
// sidebar, status bar and dialogs. It never changes the viewport, what is drawn
// over it, or anything saved or exported (intent and marker colours are data).
// The colours live in style.css, one block per key; theme-boot.js applies the
// saved key before first paint. Every palette is MIT-licensed and checked for
// WCAG 2.2 contrast by test/themes.test.mjs.

export const THEME_KEY = 'ptah.theme';

// label: what the 104 px picker shows; name: the full name, in the option's tooltip
export const THEMES = Object.freeze([
  { key: 'ptah',             label: 'Ptah',              scheme: 'dark',  bar: '#14161b', credit: null },
  { key: 'catppuccin-mocha', label: 'Catppuccin',        scheme: 'dark',  bar: '#1e1e2e', credit: 'Catppuccin (MIT)', name: 'Catppuccin Mocha' },
  { key: 'rose-pine',        label: 'Rosé Pine',         scheme: 'dark',  bar: '#1f1d2e', credit: 'Rosé Pine (MIT)' },
  { key: 'primer-light',     label: 'Light',             scheme: 'light', bar: '#ffffff', credit: 'GitHub Primer (MIT)', name: 'Primer Light' },
  { key: 'primer-light-hc',  label: 'Light HC',          scheme: 'light', bar: '#ffffff', credit: 'GitHub Primer (MIT)', name: 'Primer Light High Contrast' },
  { key: 'primer-dark-hc',   label: 'Dark HC',           scheme: 'dark',  bar: '#010409', credit: 'GitHub Primer (MIT)', name: 'Primer Dark High Contrast' }
]);

const byKey = (key) => THEMES.find(t => t.key === key) || THEMES[0];

/** The saved theme, or Ptah's own when none is saved (or storage is unavailable). */
export function savedTheme() {
  try { return byKey(localStorage.getItem(THEME_KEY)).key; } catch { return THEMES[0].key; }
}

/** Apply a theme to the page; `remember` saves it for the next launch. Returns the key applied. */
export function applyTheme(key, { remember = true } = {}) {
  const t = byKey(key);
  const root = document.documentElement;
  if (t.key === 'ptah') delete root.dataset.theme; else root.dataset.theme = t.key;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t.bar);
  if (remember) { try { localStorage.setItem(THEME_KEY, t.key); } catch { /* storage unavailable: this session only */ } }
  return t.key;
}
