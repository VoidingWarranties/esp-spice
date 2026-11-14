#!/bin/sh
# Downloads the ESP32 mask ROM ELF that the bridge boots from
# (espressif/esp-rom-elfs, Apache-2.0), and checks its SHA-256.
#   tools/fetch-esp32-rom.sh [DIR]   (default: roms)
# Then set ESP32SIM_ROM_DIR to DIR.
set -e
DIR=${1:-roms}
RELEASE=20260528
TARBALL_SHA=caa463d3cbef2430a5a35847c1d9f2f152403b17a802050927ff60c8da54fe46
ROM=esp32_rev300_rom.elf
ROM_SHA=920b70635440517866aab2230964a570d2cf2b676658d93c52fbac108c1cca31
URL=https://github.com/espressif/esp-rom-elfs/releases/download/$RELEASE/esp-rom-elfs-$RELEASE.tar.gz

mkdir -p "$DIR"
if echo "$ROM_SHA  $DIR/$ROM" | sha256sum -c --status 2>/dev/null; then
  echo "$DIR/$ROM is already there"
  exit 0
fi
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 5 "$URL" -o "$tmp/roms.tar.gz"
echo "$TARBALL_SHA  $tmp/roms.tar.gz" | sha256sum -c --status
tar -xzf "$tmp/roms.tar.gz" -C "$tmp" "$ROM"
echo "$ROM_SHA  $tmp/$ROM" | sha256sum -c --status
mv "$tmp/$ROM" "$DIR/$ROM"
echo "$DIR/$ROM"
