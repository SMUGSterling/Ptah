// The mobile page (renderer/mobile/index.html) is generated from renderer/index.html
// by tools/build-mobile.mjs: the checked-in copy must be current, and mobile.css must
// take its colours from the theme tokens like style.css does. Run: node test/mobile.test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMobilePage, buildMobileManifest } from '../tools/build-mobile.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const renderer = path.join(here, '..', 'renderer');
let failures = 0;
const ok = (cond, msg) => { console.log((cond ? '  pass  ' : '  FAIL  ') + msg); if (!cond) failures++; };

console.log('\n[mobile page]');
const index = fs.readFileSync(path.join(renderer, 'index.html'), 'utf8');
const mobile = fs.readFileSync(path.join(renderer, 'mobile', 'index.html'), 'utf8').replace(/\r\n?/g, '\n');
ok(mobile === buildMobilePage(index), 'renderer/mobile/index.html is current (run npm run mobile after editing renderer/index.html)');
const manifest = fs.readFileSync(path.join(renderer, 'mobile', 'manifest.webmanifest'), 'utf8').replace(/\r\n?/g, '\n');   // a Windows checkout has CRLF
ok(manifest === buildMobileManifest(fs.readFileSync(path.join(renderer, 'manifest.webmanifest'), 'utf8')) && JSON.parse(manifest).start_url === './index.html'
  && /href="manifest\.webmanifest"/.test(mobile), 'the mobile page has its own manifest, so installing it opens the mobile page, not the desktop one');
const ids = (html) => new Set([...html.matchAll(/\sid="([^"]+)"/g)].map(m => m[1]));
const missing = [...ids(index)].filter(id => !ids(mobile).has(id));
ok(missing.length === 0 && ids(index).size > 100, `every element of the desktop page is on the mobile page (${ids(index).size} ids)${missing.length ? ': missing ' + missing.join(', ') : ''}`);
ok(/<html lang="en" class="mobile">/.test(mobile) && /viewport-fit=cover/.test(mobile) && !/user-scalable=no|maximum-scale/.test(mobile),
  'the mobile page is marked mobile, covers the safe areas, and still lets people zoom (WCAG 1.4.4)');

const css = fs.readFileSync(path.join(renderer, 'mobile.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const literal = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter(m => /#[0-9a-f]{3,8}\b|rgba?\(/i.test(m[2])).map(m => m[1].trim());
ok(literal.length === 0, 'mobile.css takes every colour from a theme token' + (literal.length ? ': literal colours in ' + literal.join(', ') : ''));
ok(/min-height:\s*44px/.test(css) && /font-size:\s*16px/.test(css) && /input\[type=range\]\s*\{\s*min-height:\s*44px/.test(css), 'touch targets (sliders included) are 44 px and inputs 16 px (no iOS zoom on focus)');

console.log(failures ? `\n${failures} FAILURES` : '\nALL MOBILE TESTS PASSED');
process.exit(failures ? 1 : 0);
