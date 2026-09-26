#!/usr/bin/env bash
# Compiles tools/unity/Editor/PtahMarkers.cs against small stand-ins for the
# Unity API (UnityStubs.cs) with mono's C# compiler, then runs the real
# ConvertSelected() on a level exported by Ptah. Needs mono-mcs + mono-runtime.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
out="$here/../.out/unity"
mkdir -p "$out"
node --import "$here/../register-three.mjs" "$here/make-level.mjs" "$out/level.usda"
mcs -langversion:latest -nowarn:0618 -out:"$out/harness.exe" "$here/UnityStubs.cs" "$here/../../tools/unity/Editor/PtahMarkers.cs" "$here/Harness.cs"
mono "$out/harness.exe" "$out/level.usda"
