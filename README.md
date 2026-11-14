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
