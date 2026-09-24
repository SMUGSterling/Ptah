#!/bin/bash
# macOS launcher: double-click to run the Ptah web build in your default browser.
# Needs Node.js 22 or newer (https://nodejs.org). Leave the Terminal window open while you work.
cd "$(dirname "$0")" || exit 1
if ! command -v node >/dev/null 2>&1; then
  echo "Ptah needs Node.js 22 or newer. Install it from https://nodejs.org and double-click this file again."
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
node_major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null)"
if ! [ "$node_major" -ge 22 ] 2>/dev/null; then
  node_version="$(node -p "process.versions.node" 2>/dev/null)"
  echo "Ptah needs Node.js 22 or newer. You have Node.js ${node_version:-an unsupported version}. Install a newer Node.js from https://nodejs.org and double-click this file again."
  read -n 1 -s -r -p "Press any key to close."
  exit 1
fi
exec node test/serve.mjs --open
