/**
 * @fileoverview Draws a demo and connects its parts to web/sim-worker.js.
 *
 * The page URL names the demo folder, for example
 * web/?demo=examples/led-button. The folder has a diagram.json, and a
 * firmware.bin (a merged ESP32 flash image) if the demo has firmware.
 */

import {renderCircuit} from '../render/src/circuit.js';

const DEFAULT_DEMO = 'examples/esp32-s3-button-led';

const status = document.querySelector('#status');
const error = document.querySelector('#error');
const readout = document.querySelector('#readout');
const netlistView = document.querySelector('#netlist');
const serialView = document.querySelector('#serial');

/**
 * How each input part sends its controls to the worker.
 *
 * @type {!Object<string, function(string, !HTMLElement,
 *     function(string, number))>}
 */
const INPUTS = {};
INPUTS['wokwi-potentiometer'] = INPUTS['wokwi-slide-potentiometer'] =
    INPUTS['wokwi-slide-switch'] = (id, el, control) => el.addEventListener(
        'input', () => control(`${id}.value`, el.value));
INPUTS['wokwi-pushbutton'] = INPUTS['wokwi-pushbutton-6mm'] =
    (id, el, control) => {
      el.addEventListener('button-press', () => control(`${id}.pressed`, 1));
      el.addEventListener('button-release', () => control(`${id}.pressed`, 0));
    };
// Inputs keep their own value, so that a state does not move a pot that the
// user drags.
const INPUT_PROPS = new Set(['value', 'pressed']);
/** Keeps the serial log short, so that appends stay fast. */
const SERIAL_MAX_CHARS = 20000;

/** @type {!Map<string, !HTMLElement>} */
let parts;

main().catch((e) => showError(e.message));

/** Loads the demo, draws it and starts the worker. */
async function main() {
  const demo = new URLSearchParams(location.search).get('demo') ?? DEFAULT_DEMO;
  const demoUrl = new URL(`../${demo}/`, location.href);
  document.querySelector('#demo').textContent = demo;

  const diagramUrl = new URL('diagram.json', demoUrl).href;
  const response = await fetch(diagramUrl);
  if (!response.ok) throw new Error(`${demo}/diagram.json: ${response.status}`);
  const diagram = await response.json();
  // With the integrity check, a changed or blocked bundle does not run.
  if (!customElements.get('wokwi-led')) {
    throw new Error('wokwi-elements did not load');
  }
  const firmwareUrl = new URL('firmware.bin', demoUrl);
  const hasFirmware = (await fetch(firmwareUrl, {method: 'HEAD'})).ok;
  serialView.hidden = !hasFirmware;
  ({elements: parts} = await renderCircuit(
      document.querySelector('#circuit'), diagram, {diagramUrl}));

  const worker = new Worker('sim-worker.js', {type: 'module'});
  // For example, when the worker cannot import ngspice.
  worker.onerror = (e) => showError(e.message || 'the simulator did not load');
  const control = (name, value) =>
      worker.postMessage({type: 'control', name, value});
  for (const [id, el] of parts) INPUTS[el.localName]?.(id, el, control);

  worker.onmessage = ({data}) => {
    switch (data.type) {
      case 'status':
        error.textContent = '';
        status.textContent = data.text;
        break;
      case 'error':
        showError(data.message);
        break;
      case 'serial':
        serialView.append(data.text);
        if (serialView.textContent.length > SERIAL_MAX_CHARS) {
          serialView.textContent =
              serialView.textContent.slice(-SERIAL_MAX_CHARS / 2);
        }
        serialView.scrollTop = serialView.scrollHeight;
        break;
      case 'state':
        error.textContent = '';
        show(data);
        if (!hasFirmware) {
          status.textContent = `Solved in ${data.ms.toFixed(1)} ms`;
        }
        break;
    }
  };
  worker.postMessage({
    type: 'start',
    diagram,
    diagramUrl,
    firmwareUrl: hasFirmware ? firmwareUrl.href : null,
  });
}

/**
 * Shows an error in place of the status.
 *
 * @param {string} message
 */
function showError(message) {
  status.textContent = '';
  error.textContent = `Error: ${message}`;
}

/**
 * Sets the part props and fills the readout table.
 *
 * @param {{parts: !Object, values: !Object, netlist: string}} state
 */
function show({parts: states, values, netlist}) {
  for (const [id, props] of Object.entries(states)) {
    const el = parts.get(id);
    // The renderer does not draw parts with "hide".
    if (!el) continue;
    if (!(el.localName in INPUTS)) {
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
    const header = document.createElement('th');
    header.scope = 'row';
    header.textContent = name;
    row.append(header);
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
  // Values under 1 pA or 1 pV are solver noise, so they show as 0.
  const [scale, prefix] = Math.abs(value) < 1e-12 ?
      prefixes[0] :
      prefixes.find(([s]) => Math.abs(value) >= s) ?? prefixes.at(-1);
  return `${(value / scale).toFixed(2)} ${prefix}${unit}`;
}
