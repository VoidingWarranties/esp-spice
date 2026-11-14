// Checks the analog part models against hand calculations from the model
// values in circuit/parts.js.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {afterEach, test} from 'node:test';
import {toNetlist} from '../netlist.js';
import {Simulation} from '../simulation.js';

/** kT/q at 27 C. */
const VT = 0.025865;

/** @param {string} name */
const example = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../examples/${name}/diagram.json`, import.meta.url),
      'utf8',
    ),
  );

/**
 * @param {Array<{type: string, id: string, attrs?: Record<string, string>}>} parts
 * @param {string[][]} connections
 */
const diagram = (parts, connections) => ({version: 1, parts, connections});

/**
 * @param {string} id
 * @param {string} volts
 */
const vcc = (id, volts) => ({type: 'wokwi-vcc', id, attrs: {voltage: volts}});

/**
 * @param {string} id
 * @param {string} ohms
 */
const res = (id, ohms) => ({type: 'wokwi-resistor', id, attrs: {value: ohms}});

const gnd = {type: 'wokwi-gnd', id: 'gnd'};

/**
 * @param {number} actual
 * @param {number} expected
 * @param {number} tolerance Relative.
 */
function near(actual, expected, tolerance = 0.01) {
  assert.ok(
    Math.abs(actual - expected) <= Math.abs(expected) * tolerance,
    `${actual} is not within ${tolerance * 100}% of ${expected}`,
  );
}

/**
 * Finds x = f(x) by repeated substitution.
 * @param {(x: number) => number} f
 * @param {number} x Start value.
 * @return {number}
 */
function fixedPoint(f, x) {
  for (let i = 0; i < 100; i++) x = f(x);
  return x;
}

/**
 * @param {Simulation} s
 * @param {string} pin
 * @param {number} period Seconds to sample.
 * @return {number} Largest voltage at the pin.
 */
function peak(s, pin, period) {
  const end = s.time + period;
  let max = -Infinity;
  for (let t = s.time; t <= end; t += period / 200) {
    s.advanceTo(t);
    max = Math.max(max, s.voltage(pin));
  }
  return max;
}

/** @type {Simulation | undefined} */
let sim;
afterEach(() => sim?.close());

test('unknown models list the known ones', () => {
  for (const [type, models] of [
    ['spice-pnp', '2N3906, 2N2907'],
    ['spice-nmos', '2N7000, IRLZ44N'],
    ['spice-pmos', 'BS250, IRF9540'],
    ['spice-zener', '1N4728A, 1N4733A, 1N4742A'],
    ['spice-opamp', 'LM358, MCP6002'],
  ]) {
    assert.throws(
      () => toNetlist(diagram([{type, id: 'x', attrs: {model: 'X1'}}], [])),
      new RegExp(`x: unknown model "X1", use one of: ${models}$`),
    );
  }
});

test('PNP emitter follower: Ve = Vb + Vt ln(Ic / Is)', () => {
  sim = new Simulation(
    diagram(
      [
        vcc('vcc', '5'),
        vcc('vb', '2'),
        res('re', '2.2k'),
        gnd,
        {type: 'spice-pnp', id: 'q', attrs: {model: '2N3906'}},
      ],
      [
        ['vcc:VCC', 're:1'],
        ['re:2', 'q:E'],
        ['vb:VCC', 'q:B'],
        ['q:C', 'gnd:GND'],
      ],
    ),
  );
  // Is = 1.41f. Ic is about Ie, since bf = 180.
  const ve = fixedPoint(
    (v) => 2 + VT * Math.log((5 - v) / 2200 / 1.41e-15),
    2.7,
  );
  near(sim.voltage('q:E'), ve, 0.005);
});

test('PNP switch saturates with base current', () => {
  sim = new Simulation(
    diagram(
      [
        vcc('vcc', '5'),
        res('rb', '10k'),
        res('rc', '1k'),
        res('rp', '100k'),
        gnd,
        {type: 'wokwi-pushbutton', id: 'btn'},
        {type: 'spice-pnp', id: 'q', attrs: {model: '2N2907'}},
      ],
      [
        ['vcc:VCC', 'q:E'],
        ['vcc:VCC', 'rp:1'],
        ['rp:2', 'q:B'],
        ['q:B', 'rb:1'],
        ['rb:2', 'btn:1.l'],
        ['btn:2.l', 'gnd:GND'],
        ['q:C', 'rc:1'],
        ['rc:2', 'gnd:GND'],
      ],
    ),
  );
  assert.ok(sim.voltage('q:C') < 1e-3);
  sim.set('btn.pressed', 1);
  sim.advanceTo(1e-3);
  // Ib is about 0.42 mA and Ic is 5 mA, far less than bf * Ib.
  assert.ok(sim.voltage('q:C') > 4.8);
});

test('N MOSFET: Id = kp / 2 (Vgs - Id Rs - Vto)^2 in saturation', () => {
  sim = new Simulation(
    diagram(
      [
        vcc('vcc', '5'),
        vcc('vg', '2'),
        res('rd', '100'),
        gnd,
        {type: 'spice-nmos', id: 'm', attrs: {model: '2N7000'}},
      ],
      [
        ['vcc:VCC', 'rd:1'],
        ['rd:2', 'm:D'],
        ['vg:VCC', 'm:G'],
        ['m:S', 'gnd:GND'],
      ],
    ),
  );
  // vto = 1.6, kp = 0.17, rs = 0.75.
  const id = fixedPoint((i) => (0.17 / 2) * (2 - 0.75 * i - 1.6) ** 2, 0);
  near((5 - sim.voltage('m:D')) / 100, id, 0.02);
});

test('N MOSFET switch: Ron = rs + rd + 1 / (kp (Vgs - Vto))', () => {
  for (const [model, ron] of [
    ['2N7000', 0.75 + 1 / (0.17 * (5 - 1.6))],
    ['IRLZ44N', 6e-3 + 1 / (12 * (5 - 1.5))],
  ]) {
    sim = new Simulation(
      diagram(
        [
          vcc('vcc', '5'),
          res('rd', '1k'),
          gnd,
          {type: 'spice-nmos', id: 'm', attrs: {model}},
          {type: 'wokwi-slide-switch', id: 'sw'},
        ],
        [
          ['vcc:VCC', 'rd:1'],
          ['rd:2', 'm:D'],
          ['m:S', 'gnd:GND'],
          ['m:G', 'sw:2'],
          ['sw:1', 'gnd:GND'],
          ['sw:3', 'vcc:VCC'],
        ],
      ),
    );
    near(sim.voltage('m:D'), 5, 0.001);
    sim.set('sw.value', 1);
    sim.advanceTo(1e-3);
    near(sim.voltage('m:D'), (5 * ron) / (1000 + ron), 0.05);
    sim.close();
  }
});

test('P MOSFET high-side switch', () => {
  for (const [model, ron] of [
    ['BS250', 2 + 1 / (0.056 * (5 - 2.2))],
    ['IRF9540', 20e-3 + 1 / (1.3 * (5 - 3))],
  ]) {
    sim = new Simulation(
      diagram(
        [
          vcc('vcc', '5'),
          res('rd', '1k'),
          gnd,
          {type: 'spice-pmos', id: 'm', attrs: {model}},
          {type: 'wokwi-slide-switch', id: 'sw'},
        ],
        [
          ['vcc:VCC', 'm:S'],
          ['m:D', 'rd:1'],
          ['rd:2', 'gnd:GND'],
          ['m:G', 'sw:2'],
          ['sw:1', 'gnd:GND'],
          ['sw:3', 'vcc:VCC'],
        ],
      ),
    );
    // Vgs = -5 V: on.
    near(sim.voltage('m:D'), (5 * 1000) / (1000 + ron), 0.002);
    sim.set('sw.value', 1);
    sim.advanceTo(1e-3);
    assert.ok(sim.voltage('m:D') < 1e-3);
    sim.close();
  }
});

/**
 * @param {number} vz
 * @param {number} izt
 * @param {number} zzt
 * @param {number} i Reverse current.
 * @return {number} Zener voltage at `i`.
 */
function zenerVolts(vz, izt, zzt, i) {
  const rs = zzt - VT / izt;
  return vz - izt * rs + VT * Math.log(i / izt) + i * rs;
}

test('zener: Vz at the test current, and Zzt near it', () => {
  for (const [model, vz, izt, zzt] of [
    ['1N4728A', 3.3, 76e-3, 10],
    ['1N4733A', 5.1, 49e-3, 7],
    ['1N4742A', 12, 21e-3, 9],
  ]) {
    // A supply and 100 ohms that put izt through the zener.
    const supply = vz + izt * 100;
    sim = new Simulation(
      diagram(
        [
          vcc('vcc', String(supply)),
          res('r', '100'),
          gnd,
          {type: 'spice-zener', id: 'z', attrs: {model}},
        ],
        [
          ['vcc:VCC', 'r:1'],
          ['r:2', 'z:C'],
          ['z:A', 'gnd:GND'],
        ],
      ),
    );
    // The supply has 0.01 ohm in series.
    near(sim.voltage('z:C'), vz, 0.002);
    sim.close();
    assert.ok(Math.abs(zenerVolts(vz, izt, zzt, izt) - vz) < 1e-12);
  }
});

test('zener-regulator: 5.1 V zener holds the load near 4.8 V', () => {
  const d = example('zener-regulator');
  for (const supply of [9, 12]) {
    d.parts.find((p) => p.id === 'vcc').attrs.voltage = String(supply);
    sim = new Simulation(d);
    // Iz = (supply - V) / 470 - V / 1k.
    const v = fixedPoint(
      (x) => zenerVolts(5.1, 49e-3, 7, (supply - x) / 470 - x / 1000),
      4.8,
    );
    near(sim.voltage('rl:1'), v, 0.002);
    sim.close();
  }
});

test('RL: current rises with time constant L / R', () => {
  sim = new Simulation(
    diagram(
      [
        vcc('vcc', '5'),
        res('r', '100'),
        gnd,
        {type: 'wokwi-slide-switch', id: 'sw'},
        {type: 'spice-inductor', id: 'l', attrs: {value: '10m'}},
      ],
      [
        ['vcc:VCC', 'sw:3'],
        ['sw:1', 'gnd:GND'],
        ['sw:2', 'r:1'],
        ['r:2', 'l:1'],
        ['l:2', 'gnd:GND'],
      ],
    ),
    {maxStep: 1e-6},
  );
  sim.advanceTo(1e-3);
  sim.set('sw.value', 1);
  // tau = 10 mH / 100 ohm = 100 us. The inductor voltage falls as
  // 5 e^(-t / tau).
  sim.advanceTo(1.1e-3);
  near(sim.voltage('l:1'), 5 * Math.exp(-1), 0.01);
  sim.advanceTo(1.2e-3);
  near(sim.voltage('l:1'), 5 * Math.exp(-2), 0.01);
});

test('sine source: offset + amplitude sin(2 pi f t)', () => {
  sim = new Simulation(
    diagram(
      [
        gnd,
        {
          type: 'spice-sine-source',
          id: 's',
          attrs: {amplitude: '2', frequency: '50', offset: '1'},
        },
      ],
      [['s:-', 'gnd:GND']],
    ),
    {probes: ['s:+']},
  );
  for (const t of [0, 0.0025, 0.005, 0.0075, 0.01, 0.015]) {
    sim.advanceTo(t);
    const v = 1 + 2 * Math.sin(2 * Math.PI * 50 * t);
    assert.ok(Math.abs(sim.voltage('s:+') - v) < 1e-3, `${t} s`);
  }
});

test('rlc-resonance: the capacitor swings Q times the input at f0', () => {
  sim = new Simulation(example('rlc-resonance'), {maxStep: 2e-6});
  // f0 = 1 / (2 pi sqrt(10 mH * 1 uF)) = 1592 Hz, and
  // Q = sqrt(L / C) / R = 100 / 20 = 5. It settles in about 2L / R = 1 ms.
  sim.advanceTo(0.02);
  near(peak(sim, 'c1:1', 1 / 1592), 5 * 0.5, 0.02);
});

test('opamp-amplifier: gain 1 + 22k / 10k', () => {
  sim = new Simulation(example('opamp-amplifier'));
  sim.advanceTo(0.01);
  // Input 0.75 V + 0.25 V sin(2 pi 1k t).
  near(peak(sim, 'u1:OUT', 1e-3), 3.2 * 1.0, 0.005);
});

test('op-amp output stops short of the rails', () => {
  for (const [model, high, low] of [
    ['LM358', 1.5, 0.02],
    ['MCP6002', 0.025, 0.025],
  ]) {
    sim = new Simulation(
      diagram(
        [
          vcc('vcc', '5'),
          vcc('mid', '2.5'),
          gnd,
          res('rl', '10k'),
          {type: 'spice-opamp', id: 'u', attrs: {model}},
          {type: 'wokwi-slide-switch', id: 'sw'},
        ],
        [
          ['vcc:VCC', 'u:V+'],
          ['u:V-', 'gnd:GND'],
          ['u:IN-', 'mid:VCC'],
          ['u:IN+', 'sw:2'],
          ['sw:1', 'vcc:VCC'],
          ['sw:3', 'gnd:GND'],
          ['u:OUT', 'rl:1'],
          ['rl:2', 'gnd:GND'],
        ],
      ),
    );
    // The output has 10 ohms in series, so the 10k load drops 0.1%.
    near(sim.voltage('u:OUT'), 5 - high, 0.002);
    sim.set('sw.value', 1);
    sim.advanceTo(1e-3);
    assert.ok(Math.abs(sim.voltage('u:OUT') - low) < 1e-3);
    sim.close();
  }
});

test('op-amp slew rate limits a step', () => {
  sim = new Simulation(
    diagram(
      [
        vcc('vcc', '5'),
        gnd,
        {type: 'spice-opamp', id: 'u', attrs: {model: 'LM358'}},
        {type: 'wokwi-slide-switch', id: 'sw'},
      ],
      [
        ['vcc:VCC', 'u:V+'],
        ['u:V-', 'gnd:GND'],
        ['u:IN-', 'u:OUT'],
        ['u:IN+', 'sw:2'],
        ['sw:1', 'gnd:GND'],
        ['sw:3', 'vcc:VCC'],
      ],
    ),
    {maxStep: 0.1e-6},
  );
  sim.advanceTo(1e-6);
  sim.set('sw.value', 1);
  // 0.3 V/us, from the low rail at 0.02 V.
  sim.advanceTo(3e-6);
  near(sim.voltage('u:OUT'), 0.02 + 0.6, 0.02);
});
