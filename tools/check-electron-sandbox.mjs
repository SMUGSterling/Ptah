// check-electron-sandbox.mjs — Linux pre-flight for `npm start` and `npm run test:smoke`.
//
// Ubuntu 24.04+ (and other distros with AppArmor's unprivileged user-namespace
// restriction) stop Electron from building its namespace sandbox, so it falls
// back to the SUID helper `chrome-sandbox`. npm cannot install that helper as
// root:4755, and Electron aborts with a SIGTRAP and a long FATAL line. This
// script catches that case first and prints the two-line fix instead.
//
// It only acts on Linux, only when the kernel/AppArmor restriction is on, and
// only when the helper's ownership or mode is wrong. Everywhere else it exits 0
// silently. Set PTAH_SKIP_SANDBOX_CHECK=1 to bypass it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (process.platform !== 'linux' || process.env.PTAH_SKIP_SANDBOX_CHECK === '1') {
  process.exit(0);
}

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helper = path.join(repo, 'node_modules', 'electron', 'dist', 'chrome-sandbox');

function restrictionOn() {
  try {
    const v = fs.readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim();
    return v === '1';
  } catch {
    return false; // knob absent: namespace sandbox works, SUID helper is not consulted
  }
}

let st;
try {
  st = fs.statSync(helper);
} catch {
  process.exit(0); // Electron binary not downloaded yet; nothing to check
}

const ownedByRoot = st.uid === 0;
const modeOk = (st.mode & 0o7777) === 0o4755;

if (!restrictionOn() || (ownedByRoot && modeOk)) {
  process.exit(0);
}

const rel = path.relative(process.cwd(), helper) || helper;
console.error(`
Ptah: Electron's SUID sandbox helper is not set up for this machine.

  This distro restricts unprivileged user namespaces (Ubuntu 24.04 and later do),
  so Electron needs ${rel}
  to be owned by root with mode 4755. Right now it is uid ${st.uid}, mode ${(st.mode & 0o7777).toString(8)}.

  Fix (one-off per install of node_modules; repeat after npm ci or an Electron bump):

    sudo chown root:root ${rel}
    sudo chmod 4755 ${rel}

  Then run this command again. Set PTAH_SKIP_SANDBOX_CHECK=1 to skip this check.
`);
process.exit(1);
