#!/bin/sh
# Builds the ESP32 WebAssembly module and gets the ESP32 mask ROM, for the
# web demo. Both go to web/dist.
#   tools/build-web.sh
set -e
cd "$(dirname "$0")/.."
# With rustup, add the target. The nix shell's toolchain already has it.
if command -v rustup >/dev/null; then
  rustup target list --installed | grep -q wasm32-unknown-unknown ||
    rustup target add wasm32-unknown-unknown
fi
cargo build --release --target wasm32-unknown-unknown \
  --manifest-path web/esp32/Cargo.toml
mkdir -p web/dist
TARGET_DIR=${CARGO_TARGET_DIR:-web/esp32/target}
cp "$TARGET_DIR/wasm32-unknown-unknown/release/esp_spice_web.wasm" web/dist/
tools/fetch-esp32-rom.sh web/dist
