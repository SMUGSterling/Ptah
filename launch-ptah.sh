#!/bin/bash
# Linux launcher: run the Ptah web build in your default browser.
# Double-click in your file manager (choose "Run in Terminal" if asked), or: ./launch-ptah.sh
# Needs Node.js 22 or newer (https://nodejs.org). Leave the terminal open while you work.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Ptah needs Node.js 22 or newer. Install it (https://nodejs.org or your package manager) and run this again."
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
node_major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null)"
if ! [ "$node_major" -ge 22 ] 2>/dev/null; then
  node_version="$(node -p "process.versions.node" 2>/dev/null)"
  echo "Ptah needs Node.js 22 or newer. You have Node.js ${node_version:-an unsupported version}. Install a newer Node.js and run this again."
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
exec node test/serve.mjs --open
