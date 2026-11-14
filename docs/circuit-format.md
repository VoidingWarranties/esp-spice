# Circuit format

This document is the contract between the parts of ESP Spice:

- `diagram.json`: the circuit. All tools read it.
- The netlist API: changes a diagram into an ngspice netlist. It runs in
  Node and in the browser.
- The simulation API: steps the circuit in time, in lockstep with an ESP32.
- The process protocol: the same stepping API as JSON lines, for programs
  that are not JavaScript.
- The trace: a time series that a renderer plays back.

The code is in [`circuit/`](../circuit). The JSON Schema for `diagram.json`
is [`schema/diagram.schema.json`](../schema/diagram.schema.json).

## diagram.json

The file uses the [Wokwi diagram format][wokwi-format], so a diagram from
Wokwi works without changes. Example:

```json
{
  "version": 1,
  "author": "Jordan",
  "editor": "esp-spice",
  "parts": [
    { "type": "wokwi-vcc", "id": "vcc", "top": 0, "left": 0, "attrs": { "voltage": "3.3" } },
    { "type": "wokwi-pushbutton", "id": "btn1", "top": 0, "left": 60, "attrs": { "color": "green" } },
    { "type": "wokwi-resistor", "id": "r1", "top": 80, "left": 60, "rotate": 90, "attrs": { "value": "220" } },
    { "type": "wokwi-led", "id": "led1", "top": 80, "left": 140, "attrs": { "color": "red" } },
    { "type": "wokwi-gnd", "id": "gnd", "top": 160, "left": 140, "attrs": {} }
  ],
  "connections": [
    ["vcc:VCC", "btn1:1.l", "red", []],
    ["btn1:2.r", "r1:1", "green", []],
    ["r1:2", "led1:A", "green", []],
    ["led1:C", "gnd:GND", "black", []]
  ]
}
```

Top-level fields:

| Field         | Type   | Notes                                                    |
| ------------- | ------ | -------------------------------------------------------- |
| `version`     | `1`    | Required.                                                |
| `author`      | string | Optional.                                                |
| `editor`      | string | Optional. Wokwi writes `"wokwi"`.                        |
| `parts`       | array  | Required. See below.                                     |
| `connections` | array  | Required. See below.                                     |
| other         | any    | Kept and ignored, for example `dependencies`.            |

Part fields:

| Field    | Type   | Notes                                                       |
| -------- | ------ | ----------------------------------------------------------- |
| `type`   | string | Wokwi part type, for example `wokwi-led`.                   |
| `id`     | string | Unique in the diagram.                                      |
| `top`    | number | Layout only, in pixels.                                     |
| `left`   | number | Layout only, in pixels.                                     |
| `rotate` | number | Layout only, in degrees.                                    |
| `hide`   | bool   | Layout only.                                                |
| `attrs`  | object | String values, as in Wokwi. The simulator also accepts numbers. |

A connection is `[from, to, color, route]`. `from` and `to` are pin
references: `"<part id>:<pin name>"`, for example `"btn1:1.l"`. `color` and
`route` are layout only. A part id that starts with `$` (for example
`$serialMonitor`) is not a circuit part, and the simulator ignores it.

Numbers in `attrs` can use SI prefixes: `p n u µ m k M G`, and an optional
unit that the simulator ignores. For example `"4.7k"`, `"100nF"`, `"10M"`.

### Supported parts

The simulator ignores part types that are not in this table and adds a
warning. Their pins are not connected to anything in the circuit.

"Controls" are inputs that you can change while the simulation runs.
"Trace props" are the [wokwi-elements] properties that the trace sets.

| Type                                         | Pins                                  | Attrs (default)                                   | Controls                       | Trace props                         |
| -------------------------------------------- | ------------------------------------- | ------------------------------------------------- | ------------------------------ | ----------------------------------- |
| `wokwi-resistor`                             | `1` `2`                               | `value` ohms (`1000`)                             |                                |                                     |
| `wokwi-led`                                  | `A` `C`                               | `color` (`red`)                                   |                                | `value` `brightness`                |
| `wokwi-rgb-led`                              | `R` `G` `B` `COM`                     | `common` `anode` or `cathode` (`anode`)           |                                | `ledRed` `ledGreen` `ledBlue`       |
| `wokwi-led-bar-graph`                        | `A1`..`A10` `C1`..`C10`               | `color` (`red`)                                   |                                | `values`                            |
| `wokwi-pushbutton`, `wokwi-pushbutton-6mm`   | `1.l` `1.r` `2.l` `2.r`               |                                                   | `pressed` 0 or 1               | `pressed`                           |
| `wokwi-slide-switch`                         | `1` `2` `3`                           | `value` `""` or `"1"` (`""`)                      | `value` 0 or 1                 | `value`                             |
| `wokwi-potentiometer`                        | `GND` `SIG` `VCC`                     | `value` 0..1023 (`0`), `resistance` (`10k`)       | `value` 0..1023                | `value`                             |
| `wokwi-slide-potentiometer`                  | `GND` `SIG` `VCC`                     | `value` 0..1023 (`0`), `resistance` (`10k`)       | `value` 0..1023                | `value`                             |
| `wokwi-buzzer`                               | `1` `2`                               | `resistance` (`42`)                               |                                | `hasSignal`                         |
| `wokwi-vcc`                                  | `VCC`                                 | `voltage` (`3.3`)                                 |                                |                                     |
| `wokwi-gnd`                                  | `GND`                                 |                                                   |                                |                                     |
| `spice-capacitor`                            | `1` `2`                               | `value` farads (`1u`)                             |                                |                                     |
| `spice-diode`                                | `A` `C`                               | `model` `1N4148` or `1N4007` (`1N4148`)           |                                |                                     |
| `spice-npn`                                  | `C` `B` `E`                           | `model` `2N2222` or `2N3904` (`2N2222`)           |                                |                                     |
| `board-esp32-devkit-c-v4`                    | see [Boards](#boards)                 |                                                   | pin drive, see [Boards](#boards) |                                   |
| `wokwi-esp32-devkit-v1`                      | see [Boards](#boards)                 |                                                   | pin drive, see [Boards](#boards) |                                   |

The `spice-*` types are not Wokwi parts. Wokwi does not simulate analog
circuits, so it has no capacitor, diode or transistor. A renderer must draw
them itself.

Notes on the models:

- In a pushbutton, `1.l` and `1.r` are always connected, and `2.l` and `2.r`
  are always connected. `pressed` connects side 1 to side 2.
- In a slide switch, pin `2` is the common pin. Value 0 (handle left)
  connects `2` to `1`. Value 1 (handle right) connects `2` to `3`.
- In a potentiometer, value 1023 puts `SIG` at `VCC`, and value 0 puts
  `SIG` at `GND`.
- An LED is a diode with a forward voltage from its color: red, orange and
  yellow about 2.0 V, green, blue, white and purple about 3.0 V.
  `brightness` is the LED current divided by 5 mA, limited to 0..1.
  `value` is `brightness > 0`.
- A closed switch is 0.05 ohm. An open switch is 1 Gohm.
- `wokwi-vcc` is an ideal source with 0.01 ohm in series, so two sources on
  one net do not make an error.
- Each node has 1 Gohm to ground, so a node with no connection does not
  make an error.

### Boards

A board part puts its power pins into the circuit and makes each GPIO pin
that is wired to a part a pin driver. Pins that are not wired are not in the
circuit, and drive changes to them are ignored.

| Board                     | Ground                  | 3.3 V | 5 V   | GPIO pins                                                                                 |
| ------------------------- | ----------------------- | ----- | ----- | ----------------------------------------------------------------------------------------- |
| `board-esp32-devkit-c-v4` | `GND.1` `GND.2` `GND.3` | `3V3` | `5V`  | `0` `2` `4` `5` `12`..`19` `21`..`23` `25`..`27` `32`..`35` `TX` `RX` `VP` `VN`          |
| `wokwi-esp32-devkit-v1`   | `GND.1` `GND.2`         | `3V3` | `VIN` | `D2` `D4` `D5` `D12`..`D15` `D18` `D19` `D21`..`D23` `D25`..`D27` `D32`..`D35` `TX0` `RX0` `TX2` `RX2` `VP` `VN` |

A pin driver is a Thevenin source: a voltage source with a series resistor.
The ESP32 bridge sets it with a drive:

| Pin mode           | Drive                                       |
| ------------------ | ------------------------------------------- |
| Output high        | `{ "volts": 3.3, "ohms": 40 }`              |
| Output low         | `{ "volts": 0, "ohms": 40 }`                |
| Input, no pull     | `{ "volts": 0, "ohms": 1e9 }` (the default) |
| Input, pull-up     | `{ "volts": 3.3, "ohms": 45000 }`           |
| Input, pull-down   | `{ "volts": 0, "ohms": 45000 }`             |
| PWM output         | `{ "volts": 3.3, "ohms": 40, "freqHz": 5000, "duty": 0.25 }` |

With `freqHz` and `duty`, ngspice makes the PWM edges itself, from the
current time. Read an input or ADC pin as the voltage of its net.

## Netlist API

`circuit/netlist.js` has no Node imports, so a browser can import it.

```js
import { toNetlist } from './circuit/netlist.js';

const circuit = toNetlist(diagram, {
  analysis: '.op',                  // optional line to add at the end
  controls: { 'btn1.pressed': 1 },  // optional start values for controls
});
circuit.netlist;    // string: the ngspice deck, ends with ".end"
circuit.nodes;      // { "led1:A": "r1_2", "gnd:GND": "0", ... } pin to node
circuit.controls;   // { "btn1.pressed": 1, ... } every control and its value
circuit.warnings;   // [ "unsupported part type: wokwi-lcd1602 (lcd1)" ]
circuit.senses;     // [ "v_led1_i" ] 0 V sources that read part currents

// Trace props of a part, from a solved circuit.
circuit.state('led1', {
  v: (node) => volts,      // volts at a node
  i: (source) => amps,     // amps through a voltage source, such as "v_led1_i"
});

// Change a control. Returns ngspice commands ("alter ...") that change a
// running simulation. To solve .op again, call toNetlist() with new controls.
circuit.setControl('btn1.pressed', 1, timeInSeconds);
```

Node and element names are lower case, because ngspice changes all names
to lower case.

## Simulation API

`circuit/simulation.js` runs ngspice as a shared library (`libngspice.so`)
in Node. It is not for the browser. Only one simulation can be open in one
process at a time.

```js
import { Simulation } from './circuit/simulation.js';

const sim = new Simulation(diagram, { maxStep: 10e-6, probes: ['led1:A'] });
sim.advanceTo(0.5);                      // seconds, lands exactly on 0.5
sim.set('btn1.pressed', 1);              // change a control
sim.setPin('esp:2', { volts: 3.3, ohms: 40 });  // keys not given are kept
sim.advanceTo(1.0);
sim.time;                                // 1.0
sim.voltage('led1:A');                   // volts at the net of a pin
sim.state('led1');                       // { value: true, brightness: 0.62 }
sim.trace();                             // the trace so far, see below
sim.close();
```

Options:

- `maxStep`: the largest ngspice time step, in seconds. Default 10 us.
- `frameInterval`: the time between trace records, in seconds. Default
  10 ms. The simulation also records when a control or pin drive changes.
- `probes`: pins whose net voltage the trace records.

`state()` and the trace use the mean part current since the last record,
so an LED on a PWM pin has a steady brightness. Node voltages are the
value now.

Ngspice keeps every time point in memory, so memory grows with the
simulated time: about 50 MB for each simulated second with a 5 kHz PWM
pin.

## Process protocol

`node circuit/server.js diagram.json [--max-step 10e-6]` reads one JSON
command per line on stdin and writes one JSON reply per line on stdout.
A failed command replies `{ "error": "message" }`.

| Command                                                          | Reply                                        |
| ---------------------------------------------------------------- | -------------------------------------------- |
| `{ "cmd": "advance_to", "t": 0.001 }`                            | `{ "t": 0.001 }`                             |
| `{ "cmd": "advance_to", "t": 0.001, "pins": ["esp:2"] }`         | `{ "t": 0.001, "v": { "esp:2": 3.29 } }`     |
| `{ "cmd": "set", "name": "btn1.pressed", "value": 1 }`           | `{ "ok": true }`                             |
| `{ "cmd": "set_pin", "pin": "esp:2", "volts": 3.3, "ohms": 40 }` | `{ "ok": true }`                             |
| `{ "cmd": "voltage", "pin": "esp:2" }`                           | `{ "v": 3.29 }`                              |
| `{ "cmd": "state", "part": "led1" }`                             | `{ "value": true, ... }`                     |
| `{ "cmd": "trace" }`                                             | the trace                                    |

`set_pin` also takes `freq_hz` and `duty` for PWM. Each command gets exactly
one reply line.

## Trace

A trace is the circuit state over time, for a renderer to play back.

```json
{
  "version": 1,
  "end": 2.0,
  "parts": {
    "led1": [
      { "t": 0, "value": false, "brightness": 0 },
      { "t": 0.5, "value": true, "brightness": 0.62 }
    ],
    "btn1": [
      { "t": 0, "pressed": false },
      { "t": 0.5, "pressed": true }
    ]
  },
  "probes": {
    "led1:A": [{ "t": 0, "v": 0 }, { "t": 0.5, "v": 1.98 }]
  }
}
```

- `end` is the last simulated time, in seconds.
- `parts` has one list of keyframes for each part that has trace props.
  Keyframes are sorted by `t` (seconds). A keyframe sets wokwi-element
  properties, and they stay until the next keyframe. The first keyframe is
  at `t` 0 and sets all props. Later keyframes set only the props that
  changed.
- `probes` is optional. It has one list for each pin in the `probes`
  option, with the net voltage in volts, rounded to 1 mV, only when it
  changes.

[wokwi-format]: https://docs.wokwi.com/diagram-format
[wokwi-elements]: https://github.com/wokwi/wokwi-elements
