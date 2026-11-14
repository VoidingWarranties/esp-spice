// Checks the analog examples, and some single parts, against hand
// calculations from the part models in circuit/parts.js.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {afterEach, test} from 'node:test';
import {Simulation} from '../simulation.js';

/** @param {string} name */
const example = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../examples/${name}/diagram.json`, import.meta.url),
      'utf8',
    ),
  );

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
 * A source, a part between its pins `a` and `b`, and a resistor to ground.
 * @param {string} volts
 * @param {{type: string, attrs?: Record<string, string>}} part
 * @param {[string, string]} pins
 * @param {string} ohms
 */
function series(volts, part, [a, b], ohms) {
  return {
    version: 1,
    parts: [
      {type: 'wokwi-vcc', id: 'vcc', attrs: {voltage: volts}},
      {id: 'x', ...part},
      {type: 'wokwi-resistor', id: 'r', attrs: {value: ohms}},
      {type: 'wokwi-gnd', id: 'gnd'},
    ],
    connections: [
      ['vcc:VCC', `x:${a}`],
      [`x:${b}`, 'r:1'],
      ['r:2', 'gnd:GND'],
    ],
  };
}

/** @type {Simulation | undefined} */
let sim;
afterEach(() => sim?.close());

test('voltage-divider: 5 V * 4.7k / (10k + 4.7k)', () => {
  sim = new Simulation(example('voltage-divider'));
  near(sim.voltage('r1:2'), (5 * 4.7) / 14.7, 0.001);
});

test('rc-charge: charges and discharges with tau = 10k * 10 uF', () => {
  sim = new Simulation(example('rc-charge'));
  sim.advanceTo(0.1);
  assert.ok(Math.abs(sim.voltage('c1:1')) < 1e-3);
  sim.set('sw1.value', 1);
  sim.advanceTo(0.2);
  near(sim.voltage('c1:1'), 3.3 * (1 - Math.exp(-1)), 0.005);
  sim.advanceTo(0.6);
  const full = 3.3 * (1 - Math.exp(-5));
  near(sim.voltage('c1:1'), full, 0.005);
  sim.set('sw1.value', 0);
  sim.advanceTo(0.7);
  near(sim.voltage('c1:1'), full * Math.exp(-1), 0.005);
});

test('led-colors: current follows the forward voltage of each color', () => {
  sim = new Simulation(example('led-colors'));
  sim.advanceTo(0.01);
  // I = (5 V - Vd) / 1k, with Vd = Vf + 2 Vt ln(I / 10 mA) + I * 1 ohm.
  // Red: Vf 1.9 V, so I = 3.15 mA. Yellow: 2.0 V, 3.05 mA. Green and
  // blue: 3.0 V, 2.08 mA. Full brightness is 5 mA.
  const expected = {led1: 0.63, led2: 0.61, led3: 0.42, led4: 0.42};
  for (const [id, brightness] of Object.entries(expected)) {
    near(/** @type {number} */ (sim.state(id).brightness), brightness, 0.02);
  }
});

test('transistor-switch: the button saturates the NPN', () => {
  sim = new Simulation(example('transistor-switch'));
  sim.advanceTo(0.01);
  assert.equal(sim.state('led1').value, false);
  sim.set('btn1.pressed', 1);
  sim.advanceTo(0.02);
  // Ib = (3.3 V - 0.75 V) / 10k = 0.26 mA. Ic needs only about 14 mA, much
  // less than 200 * Ib, so Vce is at saturation.
  assert.ok(sim.voltage('q1:C') < 0.2);
  // Ic = (5 V - 1.93 V - 0.09 V) / 220 ohm = 13.5 mA.
  near((5 - sim.voltage('r2:1')) / 220, 13.5e-3, 0.02);
  assert.deepEqual(sim.state('led1'), {value: true, brightness: 1});
});

test('rgb-mixer: each pot sets one color', () => {
  sim = new Simulation(example('rgb-mixer'));
  sim.advanceTo(0.01);
  // Red: (5 V - 1.93 V) / 220 ohm = 14 mA. Blue: (5 V - 3.0 V) / 220 ohm
  // = 9 mA. Both are above 5 mA, so full brightness.
  assert.deepEqual(sim.state('rgb1'), {ledRed: 1, ledGreen: 0, ledBlue: 1});
  sim.set('pot1.value', 512);
  sim.advanceTo(0.02);
  // The wiper is 2.5 V behind 2.5k + 220 ohm, so I = (2.5 V - 1.72 V) /
  // 2.72k = 0.29 mA.
  near(/** @type {number} */ (sim.state('rgb1').ledRed), 0.06, 0.2);
});

test('esp32-rectifier: a diode and capacitor smooth a 1 kHz square wave', () => {
  sim = new Simulation(example('esp32-rectifier'));
  sim.setPin('esp:D18', {volts: 3.3, ohms: 40, freqHz: 1000, duty: 0.5});
  sim.advanceTo(0.1);
  let low = Infinity;
  let high = -Infinity;
  for (let t = 0.1; t < 0.102; t += 1e-5) {
    sim.advanceTo(t);
    low = Math.min(low, sim.voltage('c1:1'));
    high = Math.max(high, sim.voltage('c1:1'));
  }
  // The load takes about 0.27 mA, so the diode gives 0.54 mA while the pin
  // is high: Vout = 3.3 V - 40 ohm * 0.54 mA - Vd(0.54 mA) = 2.72 V.
  near((low + high) / 2, 2.72, 0.01);
  // Ripple = 0.27 mA * 0.5 ms / 10 uF = 13.6 mV.
  near(high - low, 13.6e-3, 0.1);
});

test('diodes drop the voltage of their model', () => {
  // Vd = n Vt ln(I / Is) + I Rs, at I = (3.3 V - Vd) / 1k = 2.7 mA.
  for (const [model, vd] of [
    ['1N4148', 0.63],
    ['1N4007', 0.602],
  ]) {
    sim = new Simulation(
      series('3.3', {type: 'spice-diode', attrs: {model}}, ['A', 'C'], '1k'),
    );
    near(3.3 - sim.voltage('r:1'), vd, 0.01);
    sim.close();
  }
  sim = new Simulation(series('3.3', {type: 'spice-diode'}, ['C', 'A'], '1k'));
  assert.ok(sim.voltage('r:1') < 1e-3);
});

test('an NPN in the active region has a current gain near bf', () => {
  sim = new Simulation({
    version: 1,
    parts: [
      {type: 'wokwi-vcc', id: 'v3'},
      {type: 'wokwi-vcc', id: 'v5', attrs: {voltage: '5'}},
      {type: 'wokwi-resistor', id: 'rb', attrs: {value: '100k'}},
      {type: 'wokwi-resistor', id: 'rc', attrs: {value: '220'}},
      {type: 'spice-npn', id: 'q1'},
      {type: 'wokwi-gnd', id: 'gnd'},
    ],
    connections: [
      ['v3:VCC', 'rb:1'],
      ['rb:2', 'q1:B'],
      ['v5:VCC', 'rc:1'],
      ['rc:2', 'q1:C'],
      ['q1:E', 'gnd:GND'],
    ],
  });
  const ib = (3.3 - sim.voltage('q1:B')) / 100e3;
  const vce = sim.voltage('q1:C');
  const ic = (5 - vce) / 220;
  // 2N2222: bf = 200 and vaf = 100 V, so Ic / Ib = 200 * (1 + Vce / 100 V).
  near(ic / ib, 200 * (1 + vce / 100), 0.05);
});
