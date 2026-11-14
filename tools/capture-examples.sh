#!/usr/bin/env bash
# Draws each example circuit, in light and dark mode, as PNG files.
# Usage: tools/capture-examples.sh [out_dir]   (default: captures)
set -euo pipefail

out="${1:-captures}"
mkdir -p "$out"
for diagram in examples/*/diagram.json render/examples/*/diagram.json; do
  dir="$(dirname "$diagram")"
  name="$(basename "$dir")"
  trace=()
  if [[ -f "$dir/trace.json" ]]; then
    trace=(--trace "$dir/trace.json")
  fi
  node render/capture.js "$diagram" "${trace[@]}" --png "$out/$name.png"
  node render/capture.js "$diagram" "${trace[@]}" --dark \
    --png "$out/$name-dark.png"
done
