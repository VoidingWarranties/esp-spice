#!/bin/sh
# Downloads the mask ROM ELFs that the bridge boots from
# (espressif/esp-rom-elfs, Apache-2.0), and checks their SHA-256.
#   tools/fetch-esp32-rom.sh [DIR]   (default: roms)
# Then set ESP32SIM_ROM_DIR to DIR.
set -e
DIR=${1:-roms}
RELEASE=20260528
TARBALL_SHA=caa463d3cbef2430a5a35847c1d9f2f152403b17a802050927ff60c8da54fe46
URL=https://github.com/espressif/esp-rom-elfs/releases/download/$RELEASE/esp-rom-elfs-$RELEASE.tar.gz
# One "SHA-256  file" line for each ROM, in the format of sha256sum.
ROMS="920b70635440517866aab2230964a570d2cf2b676658d93c52fbac108c1cca31  esp32_rev300_rom.elf
c0ce0f338d1de1bdc6efbef1591779a2a42c1ab7d759d3c6ae8ae63a7dd34cfd  esp32s3_rev0_rom.elf"

mkdir -p "$DIR"
if (cd "$DIR" && echo "$ROMS" | sha256sum -c --status 2>/dev/null); then
  echo "The ROMs are already in $DIR"
  exit 0
fi
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
curl -fsSL --retry 5 "$URL" -o "$tmp/roms.tar.gz"
echo "$TARBALL_SHA  $tmp/roms.tar.gz" | sha256sum -c --status
files=$(echo "$ROMS" | awk '{print $2}')
# shellcheck disable=SC2086
tar -xzf "$tmp/roms.tar.gz" -C "$tmp" $files
(cd "$tmp" && echo "$ROMS" | sha256sum -c --status)
for file in $files; do
  mv "$tmp/$file" "$DIR/$file"
  echo "$DIR/$file"
done
