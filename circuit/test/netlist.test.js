import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {parseValue, toNetlist} from '../netlist.js';

/** @param {string} name */
const example = (name) =>
  JSON.parse(
    readFileSync(
      new URL(`../../examples/${name}/diagram.json`, import.meta.url),
      'utf8',
    ),
  );

/**
 * @param {Array<{type: string, id: string, attrs?: Record<string, string | number | boolean>}>} parts
 * @param {string[][]} connections
 */
const diagram = (parts, connections) => ({version: 1, parts, connections});

test('parseValue reads SI prefixes and ignores units', () => {
  assert.equal(parseValue('220'), 220);
  assert.equal(parseValue('4.7k'), 4700);
  assert.equal(parseValue('10M'), 10e6);
  assert.equal(parseValue('10meg'), 10e6);
  assert.equal(parseValue('100nF'), 100e-9);
  assert.equal(parseValue('1µF'), 1e-6);
  assert.equal(parseValue('2.2μF'), 2.2e-6);
  assert.equal(parseValue('3m'), 3e-3);
  assert.equal(parseValue('1e3'), 1000);
  assert.equal(parseValue(' 5 V '), 5);
  assert.equal(parseValue(12), 12);
  assert.throws(() => parseValue('abc'), /not a number/);
});

test('connections and part shorts make nets', () => {
  const circuit = toNetlist(example('led-button'));
  const {nodes} = circuit;
  assert.equal(nodes['btn1:1.l'], nodes['btn1:1.r']);
  assert.equal(nodes['btn1:1.l'], nodes['vcc:VCC']);
  assert.equal(nodes['btn1:2.r'], nodes['r1:1']);
  assert.notEqual(nodes['btn1:1.l'], nodes['btn1:2.l']);
  assert.equal(nodes['led1:C'], '0');
  assert.equal(nodes['gnd:GND'], '0');
  assert.deepEqual(circuit.controls, {'btn1.pressed': 0});
  assert.deepEqual(circuit.warnings, []);
  assert.match(circuit.netlist, /\.end\n$/);
});

test('options set the analysis and start values of controls', () => {
  const {netlist, controls} = toNetlist(example('led-button'), {
    analysis: '.op',
    controls: {'btn1.pressed': 1},
  });
  assert.match(netlist, /^r_btn1 \S+ \S+ 0\.05$/m);
  assert.match(netlist, /^\.op\n\.end\n$/m);
  assert.deepEqual(controls, {'btn1.pressed': 1});
  assert.throws(
    () => toNetlist(example('led-button'), {controls: {'btn1.x': 1}}),
    /unknown control/,
  );
});

test('unsupported parts give a warning, not an error', () => {
  const circuit = toNetlist(
    diagram(
      [
        {type: 'wokwi-lcd1602', id: 'lcd'},
        {type: 'wokwi-resistor', id: 'r1'},
      ],
      [['lcd:VSS', 'r1:1']],
    ),
  );
  assert.deepEqual(circuit.warnings, [
    'unsupported part type: wokwi-lcd1602 (lcd)',
  ]);
  assert.equal(circuit.nodes['lcd:VSS'], circuit.nodes['r1:1']);
});

test('bad diagrams give clear errors', () => {
  const r1 = {type: 'wokwi-resistor', id: 'r1'};
  assert.throws(
    () => toNetlist(diagram([r1], [['r1:3', 'r1:1']])),
    /unknown pin: "r1:3"/,
  );
  assert.throws(
    () => toNetlist(diagram([r1], [['r2:1', 'r1:1']])),
    /unknown part: "r2:1"/,
  );
  assert.throws(() => toNetlist(diagram([r1, r1], [])), /duplicate part id/);
  assert.throws(
    () => toNetlist(diagram([{...r1, attrs: {value: 'big'}}], [])),
    /r1: attr value: not a number/,
  );
});

test('ids that differ only in punctuation get unique names', () => {
  const {netlist} = toNetlist(
    diagram(
      [
        {type: 'wokwi-resistor', id: 'r-1'},
        {type: 'wokwi-resistor', id: 'r_1'},
      ],
      [],
    ),
  );
  assert.match(netlist, /^r_r_1 /m);
  assert.match(netlist, /^r_r_1_2 /m);
});

test('only wired board pins get a driver', () => {
  const circuit = toNetlist(example('esp32-led'));
  assert.equal(circuit.controls['esp:2.volts'], 0);
  assert.equal(circuit.controls['esp:2.ohms'], 1e9);
  assert.equal(circuit.controls['esp:13.volts'], 0);
  assert.deepEqual(circuit.setControl('esp:13.volts', 3.3, 0), []);
  assert.doesNotMatch(circuit.netlist, /^[^*].*esp_13/m);
  for (const name of [
    'esp:99.volts',
    'esp:2.volt',
    'esp:3V3.volts',
    'led1:A.volts',
    'btn1.constructor',
  ]) {
    assert.throws(() => circuit.setControl(name, 1, 0), /unknown control/);
  }
  assert.equal(circuit.nodes['esp:GND.1'], '0');
  assert.equal(circuit.nodes['$serialMonitor:RX'], undefined);
});

test('slide switch value attr reads "", "0" and "1"', () => {
  for (const [value, expected] of [
    ['', 0],
    ['0', 0],
    [0, 0],
    [false, 0],
    ['1', 1],
    [1, 1],
    [true, 1],
  ]) {
    const circuit = toNetlist(
      diagram([{type: 'wokwi-slide-switch', id: 'sw', attrs: {value}}], []),
    );
    assert.equal(circuit.controls['sw.value'], expected, `value ${value}`);
  }
});

test('PWM pulse width stays positive at tiny duty', () => {
  const circuit = toNetlist(example('esp32-led'), {
    controls: {
      'esp:2.volts': 3.3,
      'esp:2.freqHz': 5000,
      'esp:2.duty': 1 / 65536,
    },
  });
  const [, args] =
    /pulse\(([^)]*)\)/.exec(
      circuit
        .setControl('esp:2.duty', 1 / 65536, 0)[0]
        .replace(/\[ (.*) \]/, 'pulse($1)'),
    ) ?? [];
  const [, , , rise, fall, width, period] = args.split(' ').map(Number);
  assert.ok(width > 0);
  assert.ok(rise + width + fall <= period);
});

test('setControl returns alter commands for the new value', () => {
  const circuit = toNetlist(example('esp32-led'));
  assert.deepEqual(circuit.setControl('btn1.pressed', 1, 0), [
    'alter r_btn1 = 0.05',
  ]);
  const commands = circuit.setControl('esp:2.volts', 3.3, 0.5);
  assert.deepEqual(commands, [
    'alter @v_esp_2[pulse] = [ 3.3 3.3 0 1e-9 1e-9 1 2 ]',
    'alter r_esp_2 = 1000000000',
  ]);
  circuit.setControl('esp:2.freqHz', 1000, 0.5);
  assert.match(
    circuit.setControl('esp:2.duty', 0.25, 0.5)[0],
    /^alter @v_esp_2\[pulse\] = \[ 0 3\.3 0\.5 1e-8 1e-8 0\.00024\d* 0\.001 \]$/,
  );
});

test('state reads LED current through its sense source', () => {
  const circuit = toNetlist(example('led-button'));
  assert.deepEqual(circuit.senses, ['v_led1_i']);
  const state = circuit.state('led1', {v: () => 0, i: () => 2.5e-3});
  assert.deepEqual(state, {value: true, brightness: 0.5});
  assert.deepEqual(circuit.state('btn1', {v: () => 0, i: () => 0}), {
    pressed: false,
  });
});
