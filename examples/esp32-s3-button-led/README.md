# ESP32-S3 button and LEDs

The circuit of [esp32-button-led](../esp32-button-led) on the
`board-esp32-s3-devkitc-1` board. The potentiometer is on GPIO 1, because
the S3 has no ADC on GPIO 34. The [C3](../esp32-c3-button-led) and
[C6](../esp32-c6-button-led) examples are the same circuit on those chips.

`firmware.bin` is the merged flash image of
[`../esp32-button-led/firmware`](../esp32-button-led/firmware), built for
the S3. It contains Arduino-ESP32 3.3.8 (LGPL-2.1) and ESP-IDF 5.5.4
(Apache-2.0). See
[THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md#esp32-firmware-image)
for the terms and the source. To build it again, with PlatformIO Core 6.1:

```sh
cd ../esp32-button-led/firmware
pio run -e esp32-s3-devkitc-1
cp .pio/build/esp32-s3-devkitc-1/firmware.factory.bin \
    ../../esp32-s3-button-led/firmware.bin
```

The web demo opens it by default: `web/`.
