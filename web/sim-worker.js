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
let hasFirmware = false;

self.onmessage = async ({data}) => {
  try {
    if (data.type === 'start') {
      diagram = data.diagram;
      hasFirmware = Boolean(data.firmwareUrl);
      post({type: 'status', text: 'Loading ngspice…'});
      await ready;
      if (hasFirmware) {
        await runEsp32(data.firmwareUrl);
      } else {
        await solveSoon();
      }
    } else if (data.type === 'control') {
      controls[data.name] = data.value;
      controlsChanged = true;
      // With firmware, the ESP32 loop solves after its next step.
      if (!hasFirmware) await solveSoon();
    }
  } catch (e) {
    post({type: 'error', message: e.message});
  }
};

/** @param {!Object} message */
function post(message) {
  self.postMessage(message);
}

// All solves share one ngspice, so they run one at a time, after it starts.
const ready = sim.start();
let lock = ready;
let queued = false;

/**
 * Runs fn after the solves before it.
 *
 * @param {function(): !Promise<T>} fn
 * @return {!Promise<T>}
 * @template T
 */
function exclusive(fn) {
  const run = lock.then(fn);
  lock = run.catch(() => {});
  return run;
}

/**
 * Solves once more, unless a solve is waiting to start. That solve reads
 * the newest controls, so a fast pot drag does not queue a solve per step.
 *
 * @return {!Promise<void>}
 */
async function solveSoon() {
  if (queued) return;
  queued = true;
  await exclusive(() => {
    queued = false;
    return solveNow();
  });
}

/**
 * Solves the operating point and posts the part states.
 *
 * ngspice gives a PWM pin its low level in an .op solve. So with PWM pins,
 * this solves with all of them low, and once for each PWM pin high. Then it
 * adds the change from each pin, weighted by its duty. This is exact when
 * each PWM pin drives its own parts, such as one LED per pin.
 *
 * @return {!Promise<!Object<string, number>>} Node voltages by pin, such as
 *     {'esp:2': 3.3}, for the board pins.
 */
async function solveNow() {
  controlsChanged = false;
  const pwmPins = Object.keys(controls)
      .filter((name) => name.endsWith('.duty') && controls[name] > 0 &&
          controls[name] < 1 && controls[name.replace('.duty', '.freqHz')] > 0)
      .map((name) => name.slice(0, -'.duty'.length));
  // `high` is the PWM pin to hold high. The other PWM pins are low.
  const steady = (high) => {
    const c = {...controls};
    for (const pin of pwmPins) {
      c[`${pin}.freqHz`] = 0;
      if (pin !== high) c[`${pin}.volts`] = 0;
    }
    return c;
  };
  const start = performance.now();
  const base = await solveOp(steady(null));
  const highs = [];
  for (const pin of pwmPins) highs.push(await solveOp(steady(pin)));
  const ms = performance.now() - start;

  const duties = pwmPins.map((pin) => controls[`${pin}.duty`]);
  const combine = (key) =>
      mix(base[key], highs.map((h) => h[key]), duties);
  post({
    type: 'state',
    parts: combine('parts'),
    values: combine('values'),
    netlist: base.netlist,
    ms,
  });
  return combine('pins');
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
 * Adds to a base result the change of each other result, weighted.
 * Booleans are true when the base or a result with weight above 0 is true.
 *
 * @param {*} base
 * @param {!Array<*>} others
 * @param {!Array<number>} weights The weight of each of `others`, 0 to 1.
 * @return {*}
 */
function mix(base, others, weights) {
  if (typeof base === 'number') {
    return others.reduce((sum, o, i) => sum + weights[i] * (o - base), base);
  }
  if (typeof base === 'boolean') {
    return others.reduce((any, o, i) => any || (weights[i] > 0 && o), base);
  }
  if (base && typeof base === 'object') {
    return Object.fromEntries(Object.keys(base).map((key) => [
      key, mix(base[key], others.map((o) => o[key]), weights),
    ]));
  }
  return base;
}

/**
 * Boots the firmware and runs it at wall-clock speed, with a circuit solve
 * after each step in which a pin drive or a control changed.
 *
 * @param {string} firmwareUrl A merged flash image.
 */
async function runEsp32(firmwareUrl) {
  post({type: 'status', text: 'Loading the ESP32…'});
  const firmwareBytes = fetchBytes(firmwareUrl);
  const wasm = await fetchBytes(WASM_URL);
  // The emulator can compile hot code at run time. 0 tells it to interpret.
  const {instance} = await WebAssembly.instantiate(wasm, {
    env: {host_jit_compile: () => 0, host_jit_release: () => {}},
  });
  const w = instance.exports;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  // Copies each input into wasm memory for the call, then frees it.
  const withBytes = (inputs, call) => {
    const args = inputs.map((bytes) => {
      const ptr = w.esp_web_alloc(bytes.length);
      new Uint8Array(w.memory.buffer, ptr, bytes.length).set(bytes);
      return [ptr, bytes.length];
    });
    try {
      return call(...args.flat());
    } finally {
      for (const [ptr, len] of args) w.esp_web_free(ptr, len);
    }
  };
  const out = () => new Uint8Array(
      w.memory.buffer, w.esp_web_out_ptr(), w.esp_web_out_len()).slice();
  const check = (code) => {
    if (code) throw new Error(decoder.decode(out()));
  };
  const diagramBytes = encoder.encode(JSON.stringify(diagram));
  // The board part selects the chip, and so the ROM.
  check(withBytes([diagramBytes], w.esp_web_rom_name));
  const [firmware, rom] = await Promise.all(
      [firmwareBytes, fetchBytes(`dist/${decoder.decode(out())}`)]);
  check(withBytes([diagramBytes, firmware, rom], w.esp_web_new));

  let wallStart = performance.now();
  let simStart = 0;
  let lastStatus = 0;
  let lastSpeed = {wall: wallStart, sim: 0};
  for (;;) {
    const sliceEnd = performance.now() + SLICE_MS;
    let ahead = 0;
    while (performance.now() < sliceEnd) {
      const wallSeconds = (performance.now() - wallStart) / 1000;
      const lag = wallSeconds - (w.esp_web_time() - simStart);
      if (lag < 0) {
        ahead = -lag;
        break;
      }
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
        const pins = await exclusive(solveNow);
        for (const [pin, volts] of Object.entries(pins)) {
          check(withBytes([encoder.encode(pin)],
              (ptr, len) => w.esp_web_set_voltage(ptr, len, volts)));
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
    // Lets control messages in, and waits when the ESP32 is ahead.
    await new Promise((resolve) => setTimeout(resolve, ahead * 1000));
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
