# ESP32 button and LEDs

An ESP32 with a button, a potentiometer and two LEDs. The red LED lights
while the button is pressed. The potentiometer sets the brightness of the
green LED with PWM. The firmware writes each change to the serial log.

`firmware.bin` is the merged flash image of `firmware/`. It contains
Arduino-ESP32 3.3.8 (LGPL-2.1) and ESP-IDF 5.5.4 (Apache-2.0). To build it
again, with PlatformIO Core 6.1:

```sh
cd firmware
pio run
cp .pio/build/esp32dev/firmware.factory.bin ../firmware.bin
```
