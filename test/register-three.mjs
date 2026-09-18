// Lets app modules that `import ... from 'three'` run under Node for unit tests,
// by resolving the bare specifier to the vendored build the browser importmap uses.
//   node --import ./test/register-three.mjs test/usd.test.mjs
import { register } from 'node:module';
register('./three-loader-hook.mjs', import.meta.url);
