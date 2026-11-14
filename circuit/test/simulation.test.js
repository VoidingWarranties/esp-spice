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
 * @param {Array<{type: string, id: string, attrs?: Record<string, string>}>} parts
 * @param {string[][]} connections
 */
const diagram = (parts, connections) => ({version: 1, parts, connections});

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

/** @type {Simulation | undefined} */
let sim;
afterEach(() => sim?.close());

test('a button turns an LED on and off', () => {
  sim = new Simulation(example('led-button'));
  assert.deepEqual(sim.state('led1'), {value: false, brightness: 0});
  sim.advanceTo(0.05);
  sim.set('btn1.pressed', 1);
  sim.advanceTo(0.1);
  assert.deepEqual(sim.state('led1'), {value: true, brightness: 1});
  near(sim.voltage('led1:A'), 1.88, 0.05);
  sim.set('btn1.pressed', 0);
  sim.advanceTo(0.125);

  assert.deepEqual(sim.trace(), {
    version: 1,
    end: 0.125,
    parts: {
      btn1: [
        {t: 0, pressed: false},
        {t: 0.05, pressed: true},
        {t: 0.1, pressed: false},
      ],
      led1: [
        {t: 0, value: false, brightness: 0},
        {t: 0.06, value: true, brightness: 1},
        {t: 0.11, value: false, brightness: 0},
      ],
    },
  });
});

test('advanceTo lands exactly on the time', () => {
  sim = new Simulation(example('led-button'));
  for (const t of [1e-6, 3.7e-5, 0.0123456, 0.02]) {
    assert.equal(sim.advanceTo(t), t);
    assert.equal(sim.time, t);
  }
  assert.throws(() => sim?.advanceTo(0.01), /cannot go back in time/);
});

test('an RC circuit charges with time constant RC', () => {
  sim = new Simulation(
    diagram(
      [
        {type: 'wokwi-vcc', id: 'vcc', attrs: {voltage: '5'}},
        {type: 'wokwi-slide-switch', id: 'sw'},
        {type: 'wokwi-resistor', id: 'r', attrs: {value: '1k'}},
        {type: 'spice-capacitor', id: 'c', attrs: {value: '1u'}},
        {type: 'wokwi-gnd', id: 'gnd'},
      ],
      [
        ['vcc:VCC', 'sw:3'],
        ['sw:2', 'r:1'],
        ['r:2', 'c:1'],
        ['c:2', 'gnd:GND'],
        ['sw:1', 'gnd:GND'],
      ],
    ),
  );
  sim.advanceTo(1e-3);
  assert.ok(Math.abs(sim.voltage('c:1')) < 1e-3);
  sim.set('sw.value', 1);
  sim.advanceTo(2e-3);
  near(sim.voltage('c:1'), 5 * (1 - Math.exp(-1)));
  sim.advanceTo(4e-3);
  near(sim.voltage('c:1'), 5 * (1 - Math.exp(-3)));
});

test('a potentiometer divides the supply voltage', () => {
  sim = new Simulation(example('esp32-led'));
  near(sim.voltage('esp:34'), (3.3 * 512) / 1023);
  sim.set('pot1.value', 1023);
  sim.advanceTo(1e-3);
  near(sim.voltage('esp:34'), 3.3);
  assert.deepEqual(sim.state('pot1'), {value: 1023});
});

test('board pins drive outputs and read inputs', () => {
  sim = new Simulation(example('esp32-led'));
  sim.setPin('esp:4', {volts: 3.3, ohms: 45000});
  sim.setPin('esp:2', {volts: 3.3, ohms: 40});
  sim.setPin('esp:13', {volts: 3.3, ohms: 40});
  sim.advanceTo(1e-3);
  near(sim.voltage('esp:4'), 3.3);
  assert.equal(sim.state('led1').value, true);

  sim.set('btn1.pressed', 1);
  sim.setPin('esp:2', {volts: 0});
  sim.advanceTo(2e-3);
  assert.ok(sim.voltage('esp:4') < 0.01);
  assert.ok(sim.voltage('esp:2') < 0.01);
});

test('PWM sets the mean LED brightness', () => {
  sim = new Simulation(example('esp32-led'));
  sim.setPin('esp:2', {volts: 3.3, ohms: 40, freqHz: 1000, duty: 0.25});
  sim.advanceTo(0.02);
  const full = (3.3 - 1.9) / 260 / 5e-3;
  near(/** @type {number} */ (sim.state('led1').brightness), 0.25 * full, 0.1);
});

test('PWM LED brightness does not depend on when it is read', () => {
  sim = new Simulation(example('esp32-led'));
  sim.setPin('esp:2', {volts: 3.3, ohms: 40, freqHz: 1000, duty: 0.25});
  sim.advanceTo(0.02);
  const steady = sim.state('led1').brightness;
  // Records between frames, at times that cut PWM periods in parts.
  for (const t of [0.0213, 0.0251, 0.0318, 0.0407]) {
    sim.advanceTo(t);
    sim.set('btn1.pressed', t > 0.03 ? 1 : 0);
    assert.equal(sim.state('led1').brightness, steady, `at ${t} s`);
  }
});

test('a buzzer sounds on a changing current, not on DC', () => {
  sim = new Simulation(example('esp32-pwm'));
  sim.setPin('esp:D23', {volts: 3.3, ohms: 40});
  sim.advanceTo(0.02);
  assert.deepEqual(sim.state('bz1'), {hasSignal: false});
  sim.setPin('esp:D23', {freqHz: 2000, duty: 0.5});
  sim.advanceTo(0.04);
  assert.deepEqual(sim.state('bz1'), {hasSignal: true});
  sim.setPin('esp:D23', {freqHz: 0});
  sim.advanceTo(0.06);
  assert.deepEqual(sim.state('bz1'), {hasSignal: false});
});

test('an NPN transistor switches an RGB LED', () => {
  sim = new Simulation(
    diagram(
      [
        {type: 'wokwi-vcc', id: 'vcc', attrs: {voltage: '5'}},
        {type: 'wokwi-rgb-led', id: 'rgb'},
        {type: 'wokwi-resistor', id: 'rc', attrs: {value: '330'}},
        {type: 'wokwi-resistor', id: 'rb', attrs: {value: '10k'}},
        {type: 'wokwi-pushbutton', id: 'btn'},
        {type: 'spice-npn', id: 'q'},
        {type: 'wokwi-gnd', id: 'gnd'},
      ],
      [
        ['vcc:VCC', 'rgb:COM'],
        ['rgb:R', 'rc:1'],
        ['rc:2', 'q:C'],
        ['q:E', 'gnd:GND'],
        ['vcc:VCC', 'btn:1.l'],
        ['btn:2.l', 'rb:1'],
        ['rb:2', 'q:B'],
      ],
    ),
  );
  sim.advanceTo(0.01);
  assert.deepEqual(sim.state('rgb'), {ledRed: 0, ledGreen: 0, ledBlue: 0});
  sim.set('btn.pressed', 1);
  sim.advanceTo(0.02);
  assert.deepEqual(sim.state('rgb'), {ledRed: 1, ledGreen: 0, ledBlue: 0});
});

test('probes record net voltages when they change', () => {
  sim = new Simulation(example('led-button'), {
    probes: ['led1:A'],
    frameInterval: 0.005,
  });
  sim.set('btn1.pressed', 1);
  sim.advanceTo(0.01);
  const probe = sim.trace().probes?.['led1:A'] ?? [];
  assert.equal(probe.length, 2);
  assert.equal(probe[1].t, 0.005);
  near(/** @type {number} */ (probe[1].v), 1.88, 0.05);
});

test('only one simulation is open at a time', () => {
  sim = new Simulation(example('led-button'));
  assert.throws(() => new Simulation(example('led-button')), /only one/);
  sim.close();
  assert.throws(() => sim?.advanceTo(1), /closed/);
  const old = sim;
  sim = new Simulation(example('led-button'));
  old.close();
  assert.equal(sim.advanceTo(0.001), 0.001);
});

test('a failed start frees ngspice', () => {
  assert.throws(() => new Simulation(example('led-button'), {maxStep: -1}));
  sim = new Simulation(example('led-button'));
});

test('pins that are not wired read their own drive', () => {
  sim = new Simulation(example('esp32-led'), {probes: ['esp:5']});
  assert.equal(sim.voltage('esp:5'), 0);
  sim.setPin('esp:5', {volts: 3.3, ohms: 45000});
  assert.equal(sim.voltage('esp:5'), 3.3);
});

test('setPin with a bad key changes nothing', () => {
  sim = new Simulation(example('esp32-led'));
  // A typo of freqHz.
  const drive = /** @type {any} */ ({volts: 3.3, ohms: 40, freqhz: 5000});
  assert.throws(
    () => sim?.setPin('esp:2', drive),
    /unknown control: "esp:2.freqhz"/,
  );
  assert.equal(sim.controls['esp:2.volts'], 0);
});
