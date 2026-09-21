#!/bin/bash
# Linux launcher: run the Ptah web build in your default browser.
# Double-click in your file manager (choose "Run in Terminal" if asked), or: ./launch-ptah.sh
# Needs Node.js 20 or newer (https://nodejs.org). Leave the terminal open while you work.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Ptah needs Node.js 20 or newer. Install it (https://nodejs.org or your package manager) and run this again."
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
exec node test/serve.mjs --open
