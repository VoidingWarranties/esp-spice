# Third-party notices

esp-spice is under the MIT License, in [LICENSE](LICENSE). This file
lists the third-party code and data that the repository or the web demo
distributes. Each keeps its own license. Parts marked Apache-2.0 are under
the Apache License 2.0, in [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt).

## ESP32 firmware image

`examples/esp32-button-led/firmware.bin` (ESP32),
`examples/esp32-s3-button-led/firmware.bin` (ESP32-S3),
`examples/esp32-c3-button-led/firmware.bin` (ESP32-C3) and
`examples/esp32-c6-button-led/firmware.bin` (ESP32-C6) are builds of
[`examples/esp32-button-led/firmware`](examples/esp32-button-led/firmware)
with the pioarduino platform-espressif32 55.03.38-1.
`examples/esp32-pot-button-leds/firmware.bin` is a link to the first.
`examples/esp32-heap-leak/firmware.bin` and its `firmware.elf` are a build
of [`examples/esp32-heap-leak/firmware`](examples/esp32-heap-leak/firmware)
for the ESP32, with the same platform. The repository and the web demo
distribute these images. Each contains:

- [Arduino-ESP32 3.3.8](https://github.com/espressif/arduino-esp32/tree/3.3.8),
  Copyright Espressif Systems and others. Parts are under the GNU Lesser
  General Public License 2.1 or later, in
  [LICENSES/LGPL-2.1.txt](LICENSES/LGPL-2.1.txt). Other parts are under
  Apache-2.0. Its source is `esp32-core-3.3.8.tar.xz`: the web demo serves
  it at `web/dist/esp32-core-3.3.8.tar.xz`, and the
  [3.3.8 release](https://github.com/espressif/arduino-esp32/releases/tag/3.3.8)
  has it too.
- ESP-IDF 5.5.4, as the precompiled libraries in
  `esp32-core-3.3.8-libs.tar.xz` on the same release. Copyright Espressif
  Systems, Apache-2.0. These include Espressif binary libraries (Apache-2.0)
  and the third-party parts in the
  [ESP-IDF copyright list](https://github.com/espressif/esp-idf/blob/v5.5.4/docs/en/COPYRIGHT.rst#firmware-components).
  Of those, the image has:
  - FreeRTOS Kernel V10.5.1, Copyright (C) 2021 Amazon.com, Inc. or its
    affiliates, MIT.
  - Xtensa header files and HAL, Copyright (C) 2003-2013 Tensilica Inc., MIT
    (ESP32 and ESP32-S3 images).
  - TLSF allocator, Copyright (C) 2006-2016 Matthew Conte, BSD-3-Clause.
  - newlib, under the licenses in [LICENSES/newlib.txt](LICENSES/newlib.txt).
- The GCC runtime libraries, under GPL-3.0 with the GCC Runtime Library
  Exception 3.1.

To use a changed Arduino-ESP32 core, build `examples/esp32-button-led/firmware`
with it, as its [README](examples/esp32-button-led/README.md) tells.

## ESP32 mask ROM

The web demo has `web/dist/esp32_rev300_rom.elf`,
`web/dist/esp32s3_rev0_rom.elf`, `web/dist/esp32c3_rev3_rom.elf` and
`web/dist/esp32c6_rev0_rom.elf`. `tools/fetch-esp32-rom.sh` downloads them
from the
[espressif/esp-rom-elfs](https://github.com/espressif/esp-rom-elfs) release
20260528. Copyright 2015-2022 Espressif Systems (Shanghai) Co. Ltd., under the
Apache License 2.0, in [LICENSES/Apache-2.0.txt](LICENSES/Apache-2.0.txt).

The ROMs contain code from these parts, as the
[ESP-IDF copyright list](https://github.com/espressif/esp-idf/blob/v5.5.4/docs/en/COPYRIGHT.rst#rom-source-code-copyrights)
tells:

- newlib, under the licenses in [LICENSES/newlib.txt](LICENSES/newlib.txt).
- Xtensa libhal, Copyright (C) 2003, 2006, 2010 Tensilica Inc., MIT (ESP32
  and ESP32-S3 ROMs).
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
  here under MIT.
- zmij, Copyright David Tolnay, a port of zmij, Copyright (c) 2025 Victor
  Zverovich. Both are MIT.
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

The MIT copyright lines above apply.

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

### BSD 3-Clause License

The BSD-3-Clause copyright line above applies.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.
3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.

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
