/**
 * @fileoverview Draws a demo and connects its parts to web/sim-worker.js.
 *
 * The page URL names the demo folder, for example
 * web/?demo=examples/led-button. The folder has a diagram.json, and a
 * firmware.bin (a merged ESP32 flash image) if the demo has firmware.
 */

import {renderCircuit} from '../render/src/circuit.js';

const DEFAULT_DEMO = 'examples/esp32-pot-button-leds';

const status = document.querySelector('#status');
const readout = document.querySelector('#readout');
const netlistView = document.querySelector('#netlist');
const serialView = document.querySelector('#serial');

const demo = new URLSearchParams(location.search).get('demo') ?? DEFAULT_DEMO;
const demoUrl = new URL(`../${demo}/`, location.href);
document.querySelector('#demo').textContent = demo;

const diagram = await (await fetch(new URL('diagram.json', demoUrl))).json();
const firmwareUrl = new URL('firmware.bin', demoUrl);
const hasFirmware = (await fetch(firmwareUrl, {method: 'HEAD'})).ok;
serialView.hidden = !hasFirmware;
const {elements: parts} =
    await renderCircuit(document.querySelector('#circuit'), diagram);

const worker = new Worker('sim-worker.js', {type: 'module'});
const control = (name, value) => worker.postMessage({type: 'control', name, value});
for (const [id, el] of parts) {
  switch (el.localName) {
    case 'wokwi-potentiometer':
    case 'wokwi-slide-potentiometer':
      el.addEventListener('input', () => control(`${id}.value`, el.value));
      break;
    case 'wokwi-pushbutton':
    case 'wokwi-pushbutton-6mm':
      el.addEventListener('button-press', () => control(`${id}.pressed`, 1));
      el.addEventListener('button-release', () => control(`${id}.pressed`, 0));
      break;
  }
}

// Inputs keep their own value, so that a state does not move a pot that the
// user drags.
const INPUT_PROPS = new Set(['value', 'pressed']);
const INPUT_TYPES = new Set([
  'wokwi-potentiometer', 'wokwi-slide-potentiometer', 'wokwi-pushbutton',
  'wokwi-pushbutton-6mm',
]);

worker.onmessage = ({data}) => {
  switch (data.type) {
    case 'status':
      status.textContent = data.text;
      break;
    case 'error':
      status.textContent = `Error: ${data.message}`;
      break;
    case 'serial':
      serialView.textContent += data.text;
      serialView.scrollTop = serialView.scrollHeight;
      break;
    case 'state':
      show(data);
      if (!hasFirmware) status.textContent = `Solved in ${data.ms.toFixed(1)} ms`;
      break;
  }
};
worker.postMessage({
  type: 'start',
  diagram,
  firmwareUrl: hasFirmware ? firmwareUrl.href : null,
});

/**
 * Sets the part props and fills the readout table.
 *
 * @param {{parts: !Object, values: !Object, netlist: string}} state
 */
function show({parts: states, values, netlist}) {
  for (const [id, props] of Object.entries(states)) {
    const el = parts.get(id);
    if (!INPUT_TYPES.has(el.localName)) {
      Object.assign(el, props);
      continue;
    }
    for (const [key, value] of Object.entries(props)) {
      if (!INPUT_PROPS.has(key)) el[key] = value;
    }
  }
  netlistView.textContent = netlist;
  // Nodes with "__" are inside parts, so they do not help the reader.
  const shown = Object.entries(values).filter(([name]) => !name.includes('__'));
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
