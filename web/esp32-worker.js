/**
 * @fileoverview Runs the ESP32 (web/esp32) in a worker, at wall-clock
 * speed. It sends its pin drives to the circuit worker (web/sim-worker.js)
 * and reads the pin voltages back.
 *
 * Messages in:
 *   {type: 'start', diagram, firmwareUrl, port} `port` goes to the circuit
 *   worker.
 * Messages out:
 *   {type: 'status', text}
 *   {type: 'serial', text}
 *   {type: 'error', message}
 * Port messages in: {t, volts: {pin: number}}
 * Port messages out: {t, drives: [{t, pin, volts, ohms, freqHz, duty}]}
 */

import {sleep, yieldToEvents} from './timing.js';

const WASM_URL = 'dist/esp_spice_web.wasm';
const ROM_URL = 'dist/esp32_rev300_rom.elf';

/** Emulated time between reads of the pin drives, in seconds. */
const STEP_SECONDS = 1e-3;
/** The longest time the worker runs before it reads messages, in ms. */
const SLICE_MS = 5;
/** When the ESP32 falls this far behind wall time, it skips ahead, in s. */
const MAX_LAG_SECONDS = 0.5;
/**
 * How far the ESP32 can run ahead of the circuit, in seconds. The ESP32
 * reads pin voltages that are up to this old.
 */
const MAX_LEAD_SECONDS = 0.05;

/** Circuit time, in seconds. -Infinity until the circuit starts. */
let circuitTime = -Infinity;
/** @type {?Object<string, number>} Pin voltages that are not applied yet. */
let volts = null;

self.onmessage = ({data}) => {
  if (data.type !== 'start') return;
  data.port.onmessage = (event) => {
    circuitTime = event.data.t;
    volts = event.data.volts;
  };
  run(data.diagram, data.firmwareUrl, data.port)
      .catch((e) => self.postMessage({type: 'error', message: e.message}));
};

/**
 * Boots the firmware and runs it until the page closes.
 *
 * @param {!Object} diagram
 * @param {string} firmwareUrl A merged flash image.
 * @param {!MessagePort} circuit
 */
async function run(diagram, firmwareUrl, circuit) {
  self.postMessage({type: 'status', text: 'Loading the ESP32…'});
  const [wasm, firmware, rom] = await Promise.all(
      [WASM_URL, firmwareUrl, ROM_URL].map(fetchBytes));
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
  check(withBytes(
      [encoder.encode(JSON.stringify(diagram)), firmware, rom],
      w.esp_web_new));

  let wallStart = performance.now();
  let simStart = 0;
  let lastStatus = 0;
  let lastSpeed = {wall: wallStart, sim: 0};
  for (;;) {
    if (volts) {
      for (const [pin, value] of Object.entries(volts)) {
        check(withBytes([encoder.encode(pin)],
            (ptr, len) => w.esp_web_set_voltage(ptr, len, value)));
      }
      volts = null;
    }
    const sliceEnd = performance.now() + SLICE_MS;
    const drives = [];
    let wait = 0;
    while (performance.now() < sliceEnd) {
      const time = w.esp_web_time();
      const lag = (performance.now() - wallStart) / 1000 - (time - simStart);
      if (time - circuitTime > MAX_LEAD_SECONDS) {
        // Waits for the circuit.
        wait = 1e-3;
        break;
      }
      if (lag < 0) {
        wait = -lag;
        break;
      }
      if (lag > MAX_LAG_SECONDS) {
        wallStart = performance.now();
        simStart = time;
      }
      check(w.esp_web_run_for(STEP_SECONDS));
      check(w.esp_web_take_drives());
      drives.push(...JSON.parse(decoder.decode(out())));
    }
    circuit.postMessage({t: w.esp_web_time(), drives});
    check(w.esp_web_take_serial());
    const text = decoder.decode(out());
    if (text) self.postMessage({type: 'serial', text});
    const now = performance.now();
    if (now - lastStatus > 500) {
      const speed = (w.esp_web_time() - lastSpeed.sim) /
          ((now - lastSpeed.wall) / 1000);
      lastSpeed = {wall: now, sim: w.esp_web_time()};
      lastStatus = now;
      self.postMessage({
        type: 'status',
        text: `ESP32 at ${w.esp_web_time().toFixed(2)} s, ` +
            `${(speed * 100).toFixed(0)}% of real time`,
      });
    }
    // Lets messages in. It waits when the ESP32 is ahead.
    await (wait ? sleep(wait * 1000) : yieldToEvents());
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
