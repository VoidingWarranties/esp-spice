# ESP32 heap leak

An ESP32 with a button. Each press is a request that leaks 1000 bytes of
heap. The firmware writes the free heap after each request, so that the
bridge's heap samples can be checked against it. See
[bridge/README.md](../../bridge/README.md#free-heap).

`firmware.bin` is the merged flash image of `firmware/`, and
`firmware.elf` is its ELF without debug information. They contain
Arduino-ESP32 3.3.8 (LGPL-2.1) and ESP-IDF 5.5.4 (Apache-2.0). See
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md#esp32-firmware-image)
for the terms and the source. To build them again, with PlatformIO Core 6.1:

```sh
cd firmware
pio run -e esp32dev
cp .pio/build/esp32dev/firmware.factory.bin ../firmware.bin
xtensa-esp32-elf-strip --strip-debug -o ../firmware.elf \
    .pio/build/esp32dev/firmware.elf
```

`firmware/platformio.ini` also builds the sketch for the S3, C3 and C6.
