#!/bin/bash
# macOS launcher: double-click to run the Ptah web build in your default browser.
# Needs Node.js 20 or newer (https://nodejs.org). Leave the Terminal window open while you work.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Ptah needs Node.js 20 or newer. Install it from https://nodejs.org and double-click this file again."
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
exec node test/serve.mjs --open
