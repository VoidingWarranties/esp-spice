/**
 * @fileoverview Runs ngspice in the page and connects it to the drawn parts.
 */

import {Simulation} from 'eecircuit-engine';

import {renderCircuit} from '../render/src/circuit.js';

import {toNetlist} from './netlist.js';

/** The LED current that shows as full brightness, in amperes. */
const FULL_BRIGHTNESS_AMPS = 5e-3;

const status = document.querySelector('#status');
const readout = document.querySelector('#readout');
const netlistView = document.querySelector('#netlist');

const sim = new Simulation();
const simReady = sim.start();
const diagram = await (await fetch('diagram.json')).json();
const {elements: parts} =
    await renderCircuit(document.querySelector('#circuit'), diagram);

const inputs = {};
for (const [id, el] of parts) {
  switch (el.localName) {
    case 'wokwi-potentiometer':
      el.value = 512;
      inputs[id] = el.value / el.max;
      el.addEventListener('input', () => {
        inputs[id] = el.value / el.max;
        solve();
      });
      break;
    case 'wokwi-pushbutton':
      inputs[id] = false;
      el.addEventListener('button-press', () => {
        inputs[id] = true;
        solve();
      });
      el.addEventListener('button-release', () => {
        inputs[id] = false;
        solve();
      });
      break;
  }
}

status.textContent = 'Loading ngspice…';
await simReady;

let running = false;
let pending = false;

/**
 * Solves the circuit for the current inputs and shows the result.
 *
 * Only one solve runs at a time. Changes during a solve cause one more solve,
 * so a fast pot drag does not queue a solve for each step.
 */
async function solve() {
  if (running) {
    pending = true;
    return;
  }
  running = true;
  do {
    pending = false;
    const netlist = toNetlist(diagram, inputs);
    netlistView.textContent = netlist;
    sim.setNetList(netlist);
    const start = performance.now();
    const result = await sim.runSim();
    const ms = performance.now() - start;
    show(result);
    status.textContent = `Solved in ${ms.toFixed(1)} ms`;
  } while (pending);
  running = false;
}

/**
 * Updates the LEDs and the readout table from an .op result.
 *
 * @param {!Object} result An eecircuit-engine result.
 */
function show(result) {
  const values = new Map(result.data.map((d) => [d.name, d.values[0]]));
  for (const [id, el] of parts) {
    if (el.localName !== 'wokwi-led') continue;
    const amps = values.get(`i(v_${id})`) ?? 0;
    el.brightness = Math.min(1, Math.max(0, amps / FULL_BRIGHTNESS_AMPS));
    el.value = el.brightness > 0.01;
  }
  // The `_k` nodes are the LED current probes from netlist.js. They are 0 V.
  const shown = [...values].filter(([name]) => !name.endsWith('_k)'));
  readout.replaceChildren(...shown.map(([name, value]) => {
    const row = document.createElement('tr');
    const unit = name.startsWith('i(') ? 'A' : 'V';
    row.insertCell().textContent = name;
    row.insertCell().textContent = formatSi(value, unit);
    return row;
  }));
}

/**
 * Formats a number with an SI prefix, for example 0.0042 as "4.20 mA".
 *
 * @param {number} value The value.
 * @param {string} unit The unit symbol.
 * @return {string} The text.
 */
function formatSi(value, unit) {
  const prefixes = [[1, ''], [1e-3, 'm'], [1e-6, 'µ'], [1e-9, 'n']];
  const [scale, prefix] =
      prefixes.find(([s]) => Math.abs(value) >= s) ?? prefixes.at(-1);
  return `${(value / scale).toFixed(2)} ${prefix}${unit}`;
}

solve();
