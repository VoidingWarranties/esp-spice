#!/usr/bin/env bash
# Draws each example circuit, in light and dark mode, as PNG files.
# Usage: tools/capture-examples.sh [out_dir]   (default: captures)
# Paths are from the repo root. Examples with no trace.json show t = 0.
set -euo pipefail

cd "$(dirname "$0")/.."
out="${1:-captures}"
mkdir -p "$out"
for diagram in examples/*/diagram.json render/examples/*/diagram.json; do
  dir="$(dirname "$diagram")"
  name="$(basename "$dir")"
  trace=()
  if [[ -f "$dir/trace.json" ]]; then
    trace=(--trace "$dir/trace.json")
  fi
  node render/capture.js "$diagram" ${trace[@]+"${trace[@]}"} --png "$out/$name.png"
  node render/capture.js "$diagram" ${trace[@]+"${trace[@]}"} --dark \
    --png "$out/$name-dark.png"
done
