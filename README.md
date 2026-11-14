# ESP Spice

An ESP32 + Spice circuit sim toolkit built with [esp32sim] and [ngspice].

[esp32sim]: https://mikroverk.github.io/esp32sim/
[ngspice]: https://ngspice.sourceforge.io/

## Development

Run `nix develop` to get a shell with the tools that this repo needs. Add new
tools to `flake.nix`.

## Circuit simulation

[`circuit/`](circuit) changes a Wokwi `diagram.json` into an ngspice netlist
and steps it in time. [docs/circuit-format.md](docs/circuit-format.md) is the
spec for the diagram, the APIs and the trace format.

Set up with Nix (`nix develop` gives Node, ngspice and `NGSPICE_LIBRARY`):

```sh
nix develop
npm install
npm test
```

Or without Nix, install the library first:
`sudo apt install libngspice0`, or `brew install libngspice`.

If Node cannot find the library, set `NGSPICE_LIBRARY` to its path.

## ESP32 bridge

[`bridge/`](bridge) runs ESP32 firmware in esp32sim, in lockstep with the
circuit. [bridge/README.md](bridge/README.md) tells how to set it up and run
it.

## Web demo

`web/` is a static page that runs a demo in the browser. A demo is a folder
with a `diagram.json`, and a `firmware.bin` if it has an ESP32.

- ngspice runs a transient analysis in a worker, through the
  [eecircuit-engine] WebAssembly build, at wall-clock speed.
  `circuit/` makes the netlist, and `web/transient.js` steps it in time.
- The ESP32 runs in a second worker: `web/esp32` builds `bridge/` to
  WebAssembly. The circuit follows the ESP32's time, and the ESP32 reads
  pin voltages that are up to 50 ms old.
- `render/` draws the parts with [wokwi-elements].

Turn the pot or push the button, and the circuit changes over time, so
capacitors charge and PWM waves feed rectifiers. PWM above about 4 kHz,
or on many pins, can run slower than real time.

```sh
tools/build-web.sh    # the ESP32 module and the ROM, into web/dist
python3 -m http.server 8790
# Open http://127.0.0.1:8790/web/?demo=examples/esp32-s3-button-led
```

Without `?demo`, the page opens `examples/esp32-s3-button-led`. Demos
without firmware do not need `tools/build-web.sh`. The page loads ngspice
and wokwi-elements from a CDN, so it needs a network connection.

`.github/workflows/pages.yml` publishes the demo to GitHub Pages on each
push to `main`, when Pages is set to deploy from GitHub Actions.

[eecircuit-engine]: https://github.com/eelab-dev/EEcircuit-engine
[wokwi-elements]: https://github.com/wokwi/wokwi-elements

## License

esp-spice is under the MIT License, in [LICENSE](LICENSE).
Third-party parts keep their own licenses, in
[THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

esp-spice is unofficial. It is not affiliated with Espressif Systems or
Wokwi.
