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
