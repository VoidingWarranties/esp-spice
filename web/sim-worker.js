/**
 * @fileoverview Runs the circuit in ngspice (web/transient.js) in a worker,
 * at wall-clock speed. If the demo has firmware, the ESP32 runs in
 * web/esp32-worker.js, and the circuit follows its time.
 *
 * Messages in:
 *   {type: 'start', diagram, port?} `port` goes to the ESP32 worker.
 *   {type: 'control', name, value}
 * Messages out:
 *   {type: 'status', text}
 *   {type: 'state', parts: {id: props}, values: {name: number},
 *       ranges: {name: [low, high]}, netlist?}
 *   {type: 'error', message}
 * Port messages in: {t, drives: [{t, pin, volts, ohms, freqHz, duty}]}
 * Port messages out: {t, volts: {pin: number}}
 */

// Import maps do not apply in workers, so this is the full URL.
import {Simulation} from 'https://cdn.jsdelivr.net/npm/eecircuit-engine@1.9.0/dist/eecircuit-engine.mjs';

import {sleep, yieldToEvents} from './timing.js';
import {Transient} from './transient.js';

/** The longest time the worker runs before it reads messages, in ms. */
const SLICE_MS = 5;
/** Time between part states for the page, in ms. */
const STATE_MS = 50;
/** When the circuit falls this far behind wall time, it skips ahead, in s. */
const MAX_LAG_SECONDS = 0.5;
/** Times closer than this are equal, in seconds. */
const EPSILON = 1e-9;

// ngspice logs each pause of the run on stderr, and eecircuit-engine copies
// stderr to console.error. Those lines are not errors.
const PAUSE = new RegExp(
    '^(\\d+ ?: condition met:|doAnalyses: pause requested|' +
    '(run )?simulation interrupted|$)');
const consoleError = console.error;
console.error = (...args) => {
  if (!PAUSE.test(String(args[0]).trim())) consoleError(...args);
};

/** @type {?MessagePort} */
let esp = null;
/** ESP32 time, in seconds. The circuit does not run past it. */
let espTime = 0;
/** Pin drives from the ESP32 that are not applied yet, by time. */
const drives = [];
/** Controls from the page that are not applied yet. */
let changes = {};

self.onmessage = ({data}) => {
  if (data.type === 'start') {
    esp = data.port ?? null;
    if (esp) esp.onmessage = onDrives;
    run(data.diagram).catch((e) => post({type: 'error', message: e.message}));
  } else if (data.type === 'control') {
    changes[data.name] = data.value;
  }
};

/** @param {!MessageEvent} event */
function onDrives({data}) {
  espTime = data.t;
  drives.push(...data.drives);
}

/** @param {!Object} message */
function post(message) {
  self.postMessage(message);
}

/**
 * Loads the circuit and runs it until the page closes.
 *
 * @param {!Object} diagram
 */
async function run(diagram) {
  post({type: 'status', text: 'Loading ngspice…'});
  const sim = new Simulation();
  await sim.start();
  const circuit = new Transient(sim, diagram);
  await circuit.start();
  // Board pins are the units with a "volts" control, such as "esp:D2".
  const pins = Object.keys(circuit.controls)
      .filter((name) => name.includes(':') && name.endsWith('.volts'))
      .map((name) => name.slice(0, -'.volts'.length));

  let wallStart = performance.now();
  let simStart = 0;
  let lastState = -Infinity;
  let lastSpeed = {wall: wallStart, sim: 0};
  let sentTime = -Infinity;
  // The netlist changes only in its start values, so the page gets it once.
  let netlist = circuit.netlist;
  for (;;) {
    const sliceEnd = performance.now() + SLICE_MS;
    let done = false;
    while (!done && performance.now() < sliceEnd) {
      const wallTime = simStart + (performance.now() - wallStart) / 1000;
      if (!esp && wallTime - circuit.time > MAX_LAG_SECONDS) {
        wallStart = performance.now();
        simStart = circuit.time;
      }
      const due = {...changes};
      changes = {};
      while (drives.length && drives[0].t <= circuit.time + EPSILON) {
        const {pin, ...drive} = drives.shift();
        delete drive.t;
        for (const [key, value] of Object.entries(drive)) {
          due[`${pin}.${key}`] = value;
        }
      }
      if (Object.keys(due).length) await circuit.set(due);
      const limit =
          Math.min(esp ? espTime : wallTime, drives[0]?.t ?? Infinity);
      done = limit <= circuit.time + EPSILON;
      if (!done) await circuit.advanceTo(limit);
    }
    if (esp && circuit.time !== sentTime) {
      sentTime = circuit.time;
      esp.postMessage({t: sentTime, volts: await circuit.voltages(pins)});
    }
    const now = performance.now();
    if (now - lastState >= STATE_MS) {
      lastState = now;
      post({type: 'state', ...await circuit.snapshot(), netlist});
      netlist = undefined;
    }
    if (!esp && now - lastSpeed.wall > 500) {
      const speed =
          (circuit.time - lastSpeed.sim) / ((now - lastSpeed.wall) / 1000);
      lastSpeed = {wall: now, sim: circuit.time};
      post({
        type: 'status',
        text: `Circuit at ${circuit.time.toFixed(2)} s, ` +
            `${(speed * 100).toFixed(0)}% of real time`,
      });
    }
    // Lets messages in. When the circuit has caught up, it waits a bit.
    await (done ? sleep(2) : yieldToEvents());
  }
}
