/**
 * @fileoverview Runs the circuit (ngspice) and, if the demo has firmware,
 * the ESP32 (web/esp32) in a worker, so that the page stays responsive.
 *
 * Messages in:
 *   {type: 'start', diagram, firmwareUrl?}
 *   {type: 'control', name, value}
 * Messages out:
 *   {type: 'status', text}
 *   {type: 'state', parts: {id: props}, values: {name: number}, netlist}
 *   {type: 'serial', text}
 *   {type: 'error', message}
 */

// Import maps do not apply in workers, so this is the full URL.
import {Simulation} from 'https://cdn.jsdelivr.net/npm/eecircuit-engine@1.9.0/dist/eecircuit-engine.mjs';

import {toNetlist} from '../circuit/netlist.js';
import {PARTS} from '../circuit/parts.js';

const WASM_URL = 'dist/esp_spice_web.wasm';
const ROM_URL = 'dist/esp32_rev300_rom.elf';

/** Emulated time between circuit solves, in seconds. */
const STEP_SECONDS = 1e-3;
/** The longest time the worker runs before it reads messages, in ms. */
const SLICE_MS = 20;
/** When the ESP32 falls this far behind wall time, it skips ahead, in s. */
const MAX_LAG_SECONDS = 0.5;

const sim = new Simulation();
let diagram;
/** @type {!Object<string, number>} */
const controls = {};
let controlsChanged = false;

self.onmessage = async ({data}) => {
  try {
    if (data.type === 'start') {
      diagram = data.diagram;
      post({type: 'status', text: 'Loading ngspice…'});
      await sim.start();
      if (data.firmwareUrl) {
        await runEsp32(data.firmwareUrl);
      } else {
        await solve();
      }
    } else if (data.type === 'control') {
      controls[data.name] = data.value;
      controlsChanged = true;
      // Without firmware, nothing else solves the circuit again.
      if (!bridge) await solveSoon();
    }
  } catch (e) {
    post({type: 'error', message: e.message});
  }
};

/** @param {!Object} message */
function post(message) {
  self.postMessage(message);
}

let solving = null;
let solveAgain = false;

/**
 * Solves now, or once more after the solve that is running.
 * A fast pot drag then does not queue a solve for each step.
 */
async function solveSoon() {
  if (solving) {
    solveAgain = true;
    return;
  }
  do {
    solveAgain = false;
    solving = solve();
    await solving;
  } while (solveAgain);
  solving = null;
}

/**
 * Solves the operating point and posts the part states.
 *
 * ngspice gives a PWM pin its low level in an .op solve. So with PWM pins,
 * this solves twice, with the PWM pins high and with them low, and mixes
 * the results by duty.
 *
 * @return {!Promise<!Object<string, number>>} Node voltages by pin, such as
 *     {'esp:2': 3.3}, for the board pins.
 */
async function solve() {
  controlsChanged = false;
  const pwmPins = Object.keys(controls)
      .filter((name) => name.endsWith('.duty') && controls[name] > 0 &&
          controls[name] < 1 && controls[name.replace('.duty', '.freqHz')] > 0)
      .map((name) => name.slice(0, -'.duty'.length));
  const duty = pwmPins.length ?
      pwmPins.reduce((sum, pin) => sum + controls[`${pin}.duty`], 0) /
          pwmPins.length :
      1;
  const steady = (level) => {
    const c = {...controls};
    for (const pin of pwmPins) {
      c[`${pin}.freqHz`] = 0;
      if (!level) c[`${pin}.volts`] = 0;
    }
    return c;
  };
  const start = performance.now();
  const high = await solveOp(steady(true));
  const low = pwmPins.length ? await solveOp(steady(false)) : high;
  const ms = performance.now() - start;

  const parts = mix(high.parts, low.parts, duty);
  const values = mix(high.values, low.values, duty);
  const pins = mix(high.pins, low.pins, duty);
  post({type: 'state', parts, values, netlist: high.netlist, ms});
  return pins;
}

/**
 * @param {!Object<string, number>} start Control values.
 * @return {!Promise<{parts: !Object, values: !Object, pins: !Object,
 *     netlist: string}>}
 */
async function solveOp(start) {
  const circuit = toNetlist(diagram, {analysis: '.op', controls: start});
  sim.setNetList(circuit.netlist);
  const result = await sim.runSim();
  const values = Object.fromEntries(result.data.map((d) => [d.name, d.values[0]]));
  const read = {
    v: (node) => node === '0' ? 0 : values[`v(${node})`] ?? 0,
    i: (source) => values[`i(${source})`] ?? 0,
  };
  const parts = {};
  for (const {id, type} of diagram.parts) {
    if (PARTS[type]?.state) parts[id] = circuit.state(id, read);
  }
  // Board pins are the units with a "volts" control, such as "esp:2.volts".
  const pins = {};
  for (const name of Object.keys(circuit.controls)) {
    if (!name.includes(':') || !name.endsWith('.volts')) continue;
    const pin = name.slice(0, -'.volts'.length);
    pins[pin] = read.v(circuit.nodes[pin]);
  }
  return {parts, values, pins, netlist: circuit.netlist};
}

/**
 * Mixes two results by weight. Numbers get the weighted mean. Booleans are
 * true when either is true.
 *
 * @param {*} high
 * @param {*} low
 * @param {number} weight The weight of `high`, 0 to 1.
 * @return {*}
 */
function mix(high, low, weight) {
  if (high === low) return high;
  if (typeof high === 'number') return high * weight + low * (1 - weight);
  if (typeof high === 'boolean') return high || low;
  if (high && typeof high === 'object') {
    return Object.fromEntries(Object.keys(high).map(
        (key) => [key, mix(high[key], low[key], weight)]));
  }
  return high;
}

/** @type {?Object} The web/esp32 exports. */
let bridge = null;

/**
 * Boots the firmware and runs it at wall-clock speed, with a circuit solve
 * after each step in which a pin drive or a control changed.
 *
 * @param {string} firmwareUrl A merged flash image.
 */
async function runEsp32(firmwareUrl) {
  post({type: 'status', text: 'Loading the ESP32…'});
  const [wasm, firmware, rom] = await Promise.all(
      [WASM_URL, firmwareUrl, ROM_URL].map(fetchBytes));
  // The emulator can compile hot code at run time. 0 tells it to interpret.
  const {instance} = await WebAssembly.instantiate(wasm, {
    env: {host_jit_compile: () => 0, host_jit_release: () => {}},
  });
  const w = instance.exports;
  bridge = w;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  const put = (bytes) => {
    const ptr = w.esp_web_alloc(bytes.length);
    new Uint8Array(w.memory.buffer, ptr, bytes.length).set(bytes);
    return [ptr, bytes.length];
  };
  const out = () => new Uint8Array(
      w.memory.buffer, w.esp_web_out_ptr(), w.esp_web_out_len()).slice();
  const check = (code) => {
    if (code) throw new Error(decoder.decode(out()));
  };
  check(w.esp_web_new(
      ...put(encoder.encode(JSON.stringify(diagram))), ...put(firmware),
      ...put(rom)));

  let wallStart = performance.now();
  let simStart = 0;
  let lastStatus = 0;
  let lastSpeed = {wall: wallStart, sim: 0};
  for (;;) {
    const sliceEnd = performance.now() + SLICE_MS;
    while (performance.now() < sliceEnd) {
      const wallSeconds = (performance.now() - wallStart) / 1000;
      const lag = wallSeconds - (w.esp_web_time() - simStart);
      if (lag < 0) break;
      if (lag > MAX_LAG_SECONDS) {
        wallStart = performance.now();
        simStart = w.esp_web_time();
      }
      check(w.esp_web_run_for(STEP_SECONDS));
      check(w.esp_web_take_drives());
      const drives = JSON.parse(decoder.decode(out()));
      for (const {pin, volts, ohms, freqHz, duty} of drives) {
        Object.assign(controls, {
          [`${pin}.volts`]: volts,
          [`${pin}.ohms`]: ohms,
          [`${pin}.freqHz`]: freqHz,
          [`${pin}.duty`]: duty,
        });
      }
      if (drives.length || controlsChanged) {
        const pins = await solve();
        for (const [pin, volts] of Object.entries(pins)) {
          check(w.esp_web_set_voltage(...put(encoder.encode(pin)), volts));
        }
      }
    }
    check(w.esp_web_take_serial());
    const text = decoder.decode(out());
    if (text) post({type: 'serial', text});
    const now = performance.now();
    if (now - lastStatus > 500) {
      const speed = (w.esp_web_time() - lastSpeed.sim) /
          ((now - lastSpeed.wall) / 1000);
      lastSpeed = {wall: now, sim: w.esp_web_time()};
      lastStatus = now;
      post({
        type: 'status',
        text: `ESP32 at ${w.esp_web_time().toFixed(2)} s, ` +
            `${(speed * 100).toFixed(0)}% of real time`,
      });
    }
    // Lets control messages in.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

/**
 * @param {string} url
 * @return {!Promise<!Uint8Array>}
 */
async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}
