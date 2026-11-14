/**
 * @fileoverview Draws a demo and connects its parts to web/sim-worker.js
 * (the circuit) and web/esp32-worker.js (the ESP32).
 *
 * The page URL names the demo folder, for example
 * web/?demo=examples/led-button. The folder has a diagram.json, and a
 * firmware.bin (a merged ESP32 flash image) if the demo has firmware.
 */

import {renderCircuit} from '../render/src/circuit.js';

const DEFAULT_DEMO = 'examples/esp32-s3-button-led';
/** The readout shows the range of a voltage that changes this much. */
const MIN_RANGE_VOLTS = 0.01;

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

/** Loads the demo, draws it and starts the workers. */
async function main() {
  const demo = new URLSearchParams(location.search).get('demo') ?? DEFAULT_DEMO;
  const demoUrl = new URL(`../${demo}/`, location.href);
  document.querySelector('#demo').textContent = demo;

  const response = await fetch(new URL('diagram.json', demoUrl));
  if (!response.ok) throw new Error(`${demo}/diagram.json: ${response.status}`);
  const diagram = await response.json();
  // With the integrity check, a changed or blocked bundle does not run.
  if (!customElements.get('wokwi-led')) {
    throw new Error('wokwi-elements did not load');
  }
  const firmwareUrl = new URL('firmware.bin', demoUrl);
  const hasFirmware = (await fetch(firmwareUrl, {method: 'HEAD'})).ok;
  serialView.hidden = !hasFirmware;
  ({elements: parts} =
      await renderCircuit(document.querySelector('#circuit'), diagram));

  const circuit = new Worker('sim-worker.js', {type: 'module'});
  const control = (name, value) =>
      circuit.postMessage({type: 'control', name, value});
  for (const [id, el] of parts) INPUTS[el.localName]?.(id, el, control);

  const onMessage = ({data}) => {
    switch (data.type) {
      case 'status':
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
        show(data);
        break;
    }
  };
  // For example, when a worker cannot import its WebAssembly module.
  const onError = (e) => showError(e.message || 'the simulator did not load');
  circuit.onmessage = onMessage;
  circuit.onerror = onError;
  if (!hasFirmware) {
    circuit.postMessage({type: 'start', diagram});
    return;
  }
  // The ESP32 runs in its own worker, so that both can run in real time.
  const esp32 = new Worker('esp32-worker.js', {type: 'module'});
  esp32.onmessage = onMessage;
  esp32.onerror = onError;
  const {port1, port2} = new MessageChannel();
  circuit.postMessage({type: 'start', diagram, port: port1}, [port1]);
  esp32.postMessage(
      {type: 'start', diagram, firmwareUrl: firmwareUrl.href, port: port2},
      [port2]);
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
 * @param {{parts: !Object, values: !Object, ranges: !Object,
 *     netlist: (string|undefined)}} state `ranges` has the lowest and
 *     highest value of voltages since the last state.
 */
function show({parts: states, values, ranges, netlist}) {
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
  if (netlist) netlistView.textContent = netlist;
  // Nodes with "__" are inside parts, so they do not help the reader.
  const shown = Object.entries(values).filter(([name]) => !name.includes('__'));
  readout.replaceChildren(...shown.map(([name, value]) => {
    const row = document.createElement('tr');
    const unit = name.startsWith('i(') ? 'A' : 'V';
    const header = document.createElement('th');
    header.scope = 'row';
    header.textContent = name;
    row.append(header);
    const [low, high] = ranges[name] ?? [value, value];
    // A voltage that changes, such as a wave, shows its range.
    row.insertCell().textContent = high - low >= MIN_RANGE_VOLTS ?
        `${formatSi(low, unit)} to ${formatSi(high, unit)}` :
        formatSi(value, unit);
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
