/**
 * @fileoverview Runs ngspice in the page and connects it to the drawn parts.
 */

import {Simulation} from 'eecircuit-engine';

import {toNetlist} from '../circuit/netlist.js';
import {PARTS} from '../circuit/parts.js';
import {renderCircuit} from '../render/src/circuit.js';

const status = document.querySelector('#status');
const readout = document.querySelector('#readout');
const netlistView = document.querySelector('#netlist');

const sim = new Simulation();
const simReady = sim.start();
const diagram = await (await fetch('diagram.json')).json();
const {elements: parts} =
    await renderCircuit(document.querySelector('#circuit'), diagram);

const controls = {};
for (const [id, el] of parts) {
  const set = (name, value) => {
    controls[`${id}.${name}`] = value;
    solve();
  };
  switch (el.localName) {
    case 'wokwi-potentiometer':
      el.value = 512;
      controls[`${id}.value`] = el.value;
      el.addEventListener('input', () => set('value', el.value));
      break;
    case 'wokwi-pushbutton':
      el.addEventListener('button-press', () => set('pressed', 1));
      el.addEventListener('button-release', () => set('pressed', 0));
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
    const circuit = toNetlist(diagram, {analysis: '.op', controls});
    netlistView.textContent = circuit.netlist;
    sim.setNetList(circuit.netlist);
    const start = performance.now();
    const result = await sim.runSim();
    const ms = performance.now() - start;
    show(circuit, result);
    status.textContent = `Solved in ${ms.toFixed(1)} ms`;
  } while (pending);
  running = false;
}

/**
 * Updates the parts and the readout table from an .op result.
 *
 * @param {!Object} circuit The toNetlist() result.
 * @param {!Object} result The eecircuit-engine result.
 */
function show(circuit, result) {
  const values = new Map(result.data.map((d) => [d.name, d.values[0]]));
  const read = {
    v: (node) => node === '0' ? 0 : values.get(`v(${node})`) ?? 0,
    i: (source) => values.get(`i(${source})`) ?? 0,
  };
  for (const {id, type} of diagram.parts) {
    if (PARTS[type]?.state) Object.assign(parts.get(id), circuit.state(id, read));
  }
  // Nodes with "__" are inside parts, so they do not help the reader.
  const shown = [...values].filter(([name]) => !name.includes('__'));
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
