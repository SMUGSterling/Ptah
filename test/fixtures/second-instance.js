// Launched by test/smoke.js as a second copy of the app on the smoke test's
// profile. The real main.js must see the first copy's lock and quit (exit 0)
// without opening a window; if it opens one instead, smoke.js times out.
const { app } = require('electron');
app.setPath('userData', process.argv[process.argv.length - 1]);
require('../../main.js');
