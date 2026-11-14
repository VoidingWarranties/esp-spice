# Examples

Each folder has a `diagram.json`. A folder with a `firmware.bin` also runs
an ESP32. The tests check these circuits against hand calculations:
[circuit/test/examples.test.js](../circuit/test/examples.test.js) for the
circuits, and [bridge/tests/examples.rs](../bridge/tests/examples.rs) for
the firmware.

| Example                                    | Parts                                   | Expected result                                                      |
| ------------------------------------------ | --------------------------------------- | -------------------------------------------------------------------- |
| [voltage-divider](voltage-divider)         | resistors                               | 5 V × 4.7k / 14.7k = 1.599 V                                         |
| [rc-charge](rc-charge)                     | slide switch, resistor, capacitor       | τ = 10k × 10 µF = 0.1 s: 2.09 V one τ after the switch closes        |
| [led-colors](led-colors)                   | LEDs, resistors                         | 1k from 5 V: red 3.2 mA, yellow 3.1 mA, green and blue 2.1 mA        |
| [transistor-switch](transistor-switch)     | pushbutton, 2N2222, LED                 | Saturated: Vce < 0.2 V and Ic = 13.5 mA                              |
| [rgb-mixer](rgb-mixer)                     | pots, RGB LED                           | Each pot sets one color                                              |
| [esp32-gpio](esp32-gpio)                   | ESP32, slide switch, pushbutton, LEDs   | The switch starts a 50 ms blink. The button lights the red LED.     |
| [esp32-pwm](esp32-pwm)                     | ESP32, RGB LED, buzzer, 2N2222          | The RGB LED fades. The buzzer plays 2 kHz while the button is down. |
| [esp32-rectifier](esp32-rectifier)         | ESP32 PWM, 1N4148, capacitor            | 2.72 V with 14 mV ripple from a 1 kHz, 3.3 V square wave             |
| [esp32-adc](esp32-adc)                     | ESP32 ADC, pot, LED bar graph           | Pot at 512 reads 1652 mV and lights 5 segments                       |

[esp32-rectifier](esp32-rectifier) uses the firmware of
[esp32-pwm](esp32-pwm): `firmware.bin` is a link to it.

Run a firmware example with `esp-spice-run`, as
[bridge/README.md](../bridge/README.md) tells. For example:

```sh
cargo run --release --manifest-path bridge/Cargo.toml -- \
    examples/esp32-adc/diagram.json examples/esp32-adc/firmware.bin \
    --seconds 1 --set 0.5:pot1.value=1023 --trace trace.json
```

Then draw the trace with [render/capture.js](../render/README.md).

## Firmware

Each `firmware.bin` is the merged flash image of the `firmware/` folder
next to it. It contains Arduino-ESP32 3.3.8 (LGPL-2.1) and ESP-IDF 5.5.4
(Apache-2.0). See
[THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md#esp32-firmware-image)
for the terms and the source. To build it again, with PlatformIO Core 6.1:

```sh
cd firmware
pio run
cp .pio/build/esp32dev/firmware.factory.bin ../firmware.bin
```
