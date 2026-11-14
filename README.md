# ESP Spice

An ESP32 + Spice circuit sim toolkit built with [esp32sim] and [ngspice].

[esp32sim]: https://mikroverk.github.io/esp32sim/
[ngspice]: https://ngspice.sourceforge.io/

## Circuit simulation

[`circuit/`](circuit) changes a Wokwi `diagram.json` into an ngspice netlist
and steps it in time. [docs/circuit-format.md](docs/circuit-format.md) is the
spec for the diagram, the APIs and the trace format.

Set up:

```sh
sudo apt install libngspice0   # or: brew install libngspice
npm install
npm test
```

If Node cannot find the library, set `NGSPICE_LIBRARY` to its path.

## ESP32 bridge

[`bridge/`](bridge) runs ESP32 firmware in esp32sim, in lockstep with the
circuit. [bridge/README.md](bridge/README.md) tells how to set it up and run
it.

## Web demo

`web/` is a static page that runs ngspice in the browser, through the
[eecircuit-engine] WebAssembly build. It makes the netlist with `circuit/` and draws `web/diagram.json` with
`render/` and [wokwi-elements]. Turn the pot or push the button, and the
page solves the circuit again and sets the LED brightness from the current.

```sh
python3 -m http.server 8790
# Open http://127.0.0.1:8790/web/
```

The page loads its libraries from a CDN, so it needs a network connection.

[eecircuit-engine]: https://github.com/eelab-dev/EEcircuit-engine
[wokwi-elements]: https://github.com/wokwi/wokwi-elements
