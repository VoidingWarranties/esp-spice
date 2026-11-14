# Third-party notices

esp-spice is under the Apache License 2.0, in [LICENSE](LICENSE). This file
lists the third-party code and data that the repository or the web demo
distributes. Each keeps its own license.

## ESP32 firmware image

`examples/esp32-button-led/firmware.bin` is a build of
[`examples/esp32-button-led/firmware`](examples/esp32-button-led/firmware)
with the pioarduino platform-espressif32 55.03.38-1.
`examples/esp32-pot-button-leds/firmware.bin` is a link to it. The image
contains:

- [Arduino-ESP32 3.3.8](https://github.com/espressif/arduino-esp32/tree/3.3.8),
  Copyright Espressif Systems and others. Parts are under the GNU Lesser
  General Public License 2.1 or later, in
  [LICENSE.LGPL-2.1](examples/esp32-button-led/LICENSE.LGPL-2.1). Other
  parts are under Apache-2.0. The source is at the 3.3.8 tag and in
  `esp32-core-3.3.8.tar.xz` on the
  [3.3.8 release](https://github.com/espressif/arduino-esp32/releases/tag/3.3.8).
- ESP-IDF 5.5.4, as the precompiled libraries in
  `esp32-core-3.3.8-libs.tar.xz` on the same release. Copyright Espressif
  Systems, Apache-2.0. These include Espressif binary libraries (Apache-2.0)
  and the third-party parts that the
  [ESP-IDF copyright list](https://github.com/espressif/esp-idf/blob/v5.5.4/docs/en/COPYRIGHT.rst#firmware-components)
  names, for example FreeRTOS (MIT), the Xtensa HAL (MIT) and newlib
  ([BSD-style licenses](https://github.com/espressif/esp-idf/blob/v5.5.4/components/newlib/COPYING.NEWLIB)).
- The GCC runtime libraries, under GPL-3.0 with the GCC Runtime Library
  Exception 3.1.

To use a changed Arduino-ESP32 core, build `examples/esp32-button-led/firmware`
with it, as its [README](examples/esp32-button-led/README.md) tells.

## ESP32 mask ROM

The web demo has `web/dist/esp32_rev300_rom.elf`. `tools/fetch-esp32-rom.sh`
downloads it from the
[espressif/esp-rom-elfs](https://github.com/espressif/esp-rom-elfs) release
20260528. Copyright 2015-2022 Espressif Systems (Shanghai) Co. Ltd., under
Apache-2.0, in [LICENSE](LICENSE).

The ROM contains code from these parts, as the
[ESP-IDF copyright list](https://github.com/espressif/esp-idf/blob/v5.5.4/docs/en/COPYRIGHT.rst#rom-source-code-copyrights)
tells:

- newlib, under
  [BSD-style licenses](https://github.com/espressif/esp-idf/blob/v5.5.4/components/newlib/COPYING.NEWLIB).
- Xtensa libhal, Copyright (C) 2003, 2006, 2010 Tensilica Inc., MIT.
- TinyBasic Plus, Copyright (C) 2012-2013 Mike Field & Scott Lawrence, MIT.
- miniz, by Rich Geldreich, in the public domain.
- TJpgDec, Copyright (C) 2011 ChaN, under the TJpgDec license below.

## ESP32 WebAssembly module

The web demo has `web/dist/esp_spice_web.wasm`. It contains:

- [esp32sim](https://github.com/mikroverk/esp32sim) at 3bdb958, Copyright
  (c) 2026 Joakim Eriksson, Alice and Mattia Fiumara, MIT.
- ESP-IDF ADC calibration coefficients in esp32sim's `esp-periph`, Copyright
  2019-2024 Espressif Systems (Shanghai) CO LTD, Apache-2.0.
- serde, serde_core and serde_json, Copyright Erick Tryzelaar and David
  Tolnay, and itoa, Copyright David Tolnay. Each is MIT or Apache-2.0, used
  here under Apache-2.0.
- zmij, Copyright David Tolnay, MIT.
- memchr, Copyright Andrew Gallant and bluss, Unlicense or MIT, used here
  under the Unlicense.

## wokwi-elements

The pictures in `render/examples` and `web/screenshot.png` show drawings from
[wokwi-elements](https://github.com/wokwi/wokwi-elements), Copyright (c) 2020
Uri Shaked, MIT.

The web demo loads wokwi-elements and
[eecircuit-engine](https://github.com/eelab-dev/EEcircuit-engine) (MIT, with
[ngspice](https://ngspice.sourceforge.io/) inside) from jsDelivr. This
repository and the web demo do not distribute them.

## License texts

### MIT License

The copyright lines above apply.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

### TJpgDec license

TJpgDec - Tiny JPEG Decompressor R0.01 (C) 2011 ChaN, is a generic JPEG
decompressor module for tiny embedded systems. This is a free software that
opened for education, research and commercial developments under license
policy of following terms:

Copyright (C) 2011 ChaN, all right reserved.

- The TJpgDec module is a free software and there is NO WARRANTY.
- No restriction on use. You can use, modify and redistribute it for
  personal, non-profit or commercial products UNDER YOUR RESPONSIBILITY.
- Redistributions of source code must retain the above copyright notice.
