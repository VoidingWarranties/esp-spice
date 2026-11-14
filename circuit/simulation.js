/**
 * @file Steps a circuit in time with ngspice, in lockstep with other
 * simulators. Node only. See docs/circuit-format.md.
 */

import {toNetlist} from './netlist.js';
import {ngspice} from './ngspice.js';
import {OPEN_OHMS} from './parts.js';
import {TraceRecorder} from './trace.js';

/** Times closer than this are equal, in seconds. */
const EPSILON = 1e-12;

/** @type {Simulation | null} */
let current = null;

/**
 * A pin drive. See "Boards" in docs/circuit-format.md.
 * @typedef {object} Drive
 * @property {number} [volts]
 * @property {number} [ohms]
 * @property {number} [freqHz] PWM frequency. 0 for no PWM.
 * @property {number} [duty] PWM duty cycle, 0..1.
 */

/** A running transient simulation of a diagram. */
export class Simulation {
  /** @type {import('./netlist.js').Circuit} */
  #circuit;
  #ng = ngspice();
  #recorder = new TraceRecorder();
  #frameInterval;
  /** @type {string[]} */
  #probes;
  #time = 0;
  #started = false;
  /** Index in the time vector of the last record. */
  #mark = 0;
  /** Index in the time vector of the record before the last. */
  #previousMark = 0;

  /**
   * @param {Parameters<typeof toNetlist>[0]} diagram
   * @param {object} [options]
   * @param {number} [options.maxStep] Largest time step, in seconds.
   * @param {number} [options.frameInterval] Time between trace records, in
   *     seconds. LED brightness is the mean over this time.
   * @param {string[]} [options.probes] Pins to record in the trace.
   */
  constructor(
    diagram,
    {maxStep = 10e-6, frameInterval = 0.01, probes = []} = {},
  ) {
    if (current) throw new Error('only one Simulation can be open at a time');
    this.#circuit = toNetlist(diagram);
    this.#frameInterval = frameInterval;
    this.#probes = probes;
    for (const pin of probes) this.#node(pin);

    const saved = this.#circuit.usedNodes
      .filter((node) => node !== '0')
      .concat(this.#circuit.senses.map((source) => `${source}#branch`));
    const netlist = this.#circuit.netlist.replace(
      /\.end\n$/,
      [
        ...(saved.length ? [`.save ${saved.join(' ')}`] : []),
        // Stop time is far away: advanceTo() pauses the run.
        `.tran ${maxStep} 1e9 0 ${maxStep}`,
        '.end\n',
      ].join('\n'),
    );
    this.#ng.load(netlist);
    current = this;
    try {
      this.#run(0);
      this.#record();
    } catch (e) {
      this.close();
      throw e;
    }
  }

  /** @return {string} The netlist, for debugging. */
  get netlist() {
    return this.#circuit.netlist;
  }

  /** @return {string[]} */
  get warnings() {
    return this.#circuit.warnings;
  }

  /** @return {number} Simulation time, in seconds. */
  get time() {
    return this.#time;
  }

  /** @return {Record<string, number>} Control name to value. */
  get controls() {
    return {...this.#circuit.controls};
  }

  /**
   * Runs the simulation to time `t`, and records the trace at each frame.
   * @param {number} t Seconds.
   * @return {number} The new time.
   */
  advanceTo(t) {
    this.#checkOpen();
    if (t < this.#time - EPSILON) {
      throw new Error(`cannot go back in time: ${t} < ${this.#time}`);
    }
    const frame = this.#frameInterval;
    for (
      let k = Math.floor(this.#time / frame + 1e-6) + 1;
      k * frame <= t + EPSILON;
      k++
    ) {
      this.#run(k * frame);
      this.#record();
    }
    if (t > this.#time + EPSILON) this.#run(t);
    return this.#time;
  }

  /**
   * Changes a control, such as "btn1.pressed" or "esp:2.volts".
   * @param {string} name
   * @param {number} value
   */
  set(name, value) {
    this.#checkOpen();
    this.#apply(this.#circuit.setControl(name, Number(value), this.#time));
    this.#record();
  }

  /**
   * Changes the drive of a board pin. Keys that are not given keep their
   * value.
   * @param {string} pin Such as "esp:2".
   * @param {Drive} drive
   */
  setPin(pin, drive) {
    this.#checkOpen();
    const controls = this.#circuit.controls;
    for (const key of Object.keys(drive)) {
      if (!Object.hasOwn(controls, `${pin}.${key}`)) {
        throw new Error(`unknown control: "${pin}.${key}"`);
      }
    }
    /** @type {string[]} */
    let commands = [];
    // Each call returns the commands for the whole pin, so use the last.
    for (const [key, value] of Object.entries(drive)) {
      commands = this.#circuit.setControl(
        `${pin}.${key}`,
        Number(value),
        this.#time,
      );
    }
    this.#apply(commands);
    this.#record();
  }

  /**
   * @param {string} pin Such as "led1:A".
   * @return {number} Volts at the net of the pin.
   */
  voltage(pin) {
    this.#checkOpen();
    const node = this.#node(pin);
    if (node === '0' || this.#ng.length(node) > 0) return this.#volts(node);
    // A board pin that is not wired reads its own drive.
    const controls = this.#circuit.controls;
    const ohms = controls[`${pin}.ohms`];
    return ohms !== undefined && ohms < OPEN_OHMS
      ? controls[`${pin}.volts`]
      : 0;
  }

  /**
   * @param {string} id Part id.
   * @return {Record<string, unknown>} Trace props of the part now.
   */
  state(id) {
    this.#checkOpen();
    return this.#circuit.state(id, this.#reader());
  }

  /** @return {import('./trace.js').Trace} The trace so far. */
  trace() {
    return this.#recorder.toJSON(this.#time);
  }

  /** Frees ngspice for the next Simulation. */
  close() {
    if (current !== this) return;
    current = null;
    this.#ng.stopAt(Infinity);
    this.#ng.command('delete all');
    this.#ng.command('destroy all');
    this.#ng.command('remcirc');
  }

  #checkOpen() {
    if (current !== this) throw new Error('the simulation is closed');
  }

  /** @param {string} pin @return {string} */
  #node(pin) {
    const node = this.#circuit.nodes[pin];
    if (node === undefined) throw new Error(`unknown pin: "${pin}"`);
    return node;
  }

  /**
   * @param {string} node
   * @return {number} Volts now. 0 for a node that is not in the netlist.
   */
  #volts(node) {
    return node === '0' || this.#ng.length(node) === 0 ? 0 : this.#last(node);
  }

  /** @param {string} name @return {number} Last value of a vector. */
  #last(name) {
    const data = this.#ng.vector(name, -1);
    if (!data?.length) throw new Error(`ngspice has no vector "${name}"`);
    return data[0];
  }

  /** @param {number} t */
  #run(t) {
    this.#ng.stopAt(t);
    this.#ng.command('delete all');
    this.#ng.command(`stop when time >= ${t - EPSILON}`);
    this.#ng.command(this.#started ? 'resume' : 'run');
    this.#started = true;
    const actual = this.#last('time');
    if (Math.abs(actual - t) > 1e-9) {
      throw new Error(
        `ngspice stopped at ${actual} s, not ${t} s:\n` +
          this.#ng.log.join('\n'),
      );
    }
    this.#time = t;
  }

  /** @param {string[]} commands */
  #apply(commands) {
    for (const command of commands) this.#ng.command(command);
  }

  /**
   * Reads the circuit. Currents are the mean since the last record, or
   * over the last frame if there are no new points.
   * @return {import('./netlist.js').CircuitReader}
   */
  #reader() {
    const mark =
      this.#ng.length('time') > this.#mark ? this.#mark : this.#previousMark;
    const from = Math.max(0, mark - 1);
    const times = this.#ng.vector('time', from) ?? [];
    return {
      v: (node) => this.#volts(node),
      i: (source) => {
        const values = this.#ng.vector(`${source}#branch`, from) ?? [];
        const span = times[times.length - 1] - times[0];
        if (!(span > 0)) return values[values.length - 1];
        let sum = 0;
        for (let k = 1; k < times.length; k++) {
          sum += ((values[k] + values[k - 1]) / 2) * (times[k] - times[k - 1]);
        }
        return sum / span;
      },
    };
  }

  #record() {
    const reader = this.#reader();
    /** @type {Record<string, Record<string, unknown>>} */
    const parts = {};
    for (const id of this.#circuit.stateParts) {
      parts[id] = this.#circuit.state(id, reader);
    }
    /** @type {Record<string, number>} */
    const probes = {};
    for (const pin of this.#probes) probes[pin] = this.voltage(pin);
    this.#recorder.record(this.#time, parts, probes);
    const length = this.#ng.length('time');
    if (length > this.#mark)
      [this.#previousMark, this.#mark] = [this.#mark, length];
  }
}
