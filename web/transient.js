/**
 * @fileoverview Steps a circuit in time with the ngspice of
 * eecircuit-engine, which runs ngspice as a command line. Like
 * circuit/simulation.js, but for the browser.
 *
 * eecircuit-engine gives no API to pause a run, so this sets its command
 * list: "stop when" pauses the transient run, "resume" continues it, and
 * "alter" changes controls. ngspice keeps every time point, so the run
 * starts again from the node voltages every RESTART_SECONDS.
 */

import {toNetlist} from '../circuit/netlist.js';
import {OPEN_OHMS} from '../circuit/parts.js';

/** Largest time step, in seconds. */
const MAX_STEP = 100e-6;
/** Run time after which the run starts again, to free memory, in s. */
const RESTART_SECONDS = 1;
/** Times closer than this are equal, in seconds. */
const EPSILON = 1e-9;
/** stderr lines that mean a failure. ngspice also logs notes there. */
const ERROR = /error/i;
/** Vectors in one print command, so that its line stays short. */
const PRINT_BATCH = 8;

/** A running transient simulation of a diagram. */
export class Transient {
  /** @type {!Object} eecircuit-engine Simulation. */
  #sim;
  #diagram;
  /** @type {!Object} The circuit from toNetlist. */
  #circuit;
  /** @type {!Object<string, number>} Controls that changed. */
  #controls = {};
  /** Time of the current run's start, in seconds. */
  #offset = 0;
  /** Time in the current run, in seconds. */
  #local = 0;
  #started = false;
  /** @type {!Array<string>} Nodes in the netlist, without ground. */
  #nodes = [];
  /** @type {!Array<string>} Sense sources, for currents. */
  #senses = [];
  /**
   * Charge through each sense source since the run started, at the last
   * snapshot, in coulombs. Mean currents use the change.
   * @type {!Array<number>}
   */
  #charges = [];
  #snapshotTime = 0;
  /**
   * Start of the wave of each PWM unit, in seconds since the first run.
   * @type {!Map<string, number>}
   */
  #waveStarts = new Map();

  /**
   * @param {!Object} sim A started eecircuit-engine Simulation.
   * @param {!Object} diagram
   */
  constructor(sim, diagram) {
    this.#sim = sim;
    this.#diagram = diagram;
  }

  /** @return {number} Simulation time, in seconds. */
  get time() {
    return this.#offset + this.#local;
  }

  /** @return {string} The netlist of the current run. */
  get netlist() {
    return this.#circuit.netlist;
  }

  /** @return {!Object<string, number>} Control name to value. */
  get controls() {
    return {...this.#circuit.controls};
  }

  /** Loads the circuit and solves its start. */
  async start() {
    stopLeak(this.#sim);
    // eecircuit-engine reads out.raw after each command list, so it must
    // exist. numdgt gives printed values more digits.
    await this.#exec(['set numdgt=12', 'setplot const', 'write out.raw e']);
    await this.#load({});
    await this.advanceTo(0);
  }

  /**
   * Changes controls now.
   *
   * @param {!Object<string, number>} changes Control name to value, such as
   *     {"btn1.pressed": 1, "esp:D2.volts": 3.3}.
   */
  async set(changes) {
    /** @type {!Map<string, string>} Unit to the name of a changed control. */
    const units = new Map();
    for (const [name, value] of Object.entries(changes)) {
      const unit = name.slice(0, name.lastIndexOf('.'));
      // A new frequency starts a new wave. Other changes keep the phase,
      // like a PWM peripheral that changes the duty at the period's end.
      if (name.endsWith('.freqHz') && value !== this.#circuit.controls[name]) {
        this.#waveStarts.delete(unit);
      }
      this.#circuit.setControl(name, value, 0);
      this.#controls[name] = value;
      units.set(unit, name);
    }
    // Each control gives the commands for its whole unit.
    const commands = [...units].flatMap(([unit, name]) => {
      if (this.#isPwm(unit) && !this.#waveStarts.has(unit)) {
        this.#waveStarts.set(unit, this.time);
      }
      return this.#circuit.setControl(
          name, this.#circuit.controls[name], this.#waveTime(unit));
    });
    await this.#exec(commands);
  }

  /**
   * Runs the simulation to time `t`. ngspice stops at its first time point
   * at or after `t`, which is up to MAX_STEP later.
   *
   * @param {number} t Seconds.
   * @return {!Promise<number>} The new time.
   */
  async advanceTo(t) {
    if (this.#local >= RESTART_SECONDS) await this.#restart();
    const stop = Math.max(t - this.#offset, MAX_STEP) - EPSILON;
    if (this.#started && stop <= this.#local) return this.time;
    const [local] = await this.#print(['time'], [
      'delete all',
      `stop when time > ${stop}`,
      this.#started ? 'resume' : 'run',
    ]);
    this.#started = true;
    this.#local = local;
    return this.time;
  }

  /**
   * @param {!Array<string>} pins Such as "esp:D2".
   * @return {!Promise<!Object<string, number>>} Volts at each pin now.
   */
  async voltages(pins) {
    const wired = pins.filter((pin) =>
      this.#nodes.includes(this.#circuit.nodes[pin]));
    const values = await this.#print(
        wired.map((pin) => volts(this.#circuit.nodes[pin])));
    const controls = this.#circuit.controls;
    return Object.fromEntries(pins.map((pin) => {
      const k = wired.indexOf(pin);
      if (k >= 0) return [pin, values[k]];
      if (this.#circuit.nodes[pin] === '0') return [pin, 0];
      // A board pin that is not wired reads its own drive.
      const ohms = controls[`${pin}.ohms`];
      return [pin, ohms < OPEN_OHMS ? controls[`${pin}.volts`] : 0];
    }));
  }

  /**
   * Reads the part states and the values for the readout. Currents are the
   * mean since the last snapshot.
   *
   * @return {!Promise<{parts: !Object, values: !Object<string, number>}>}
   */
  async snapshot() {
    const read = await this.#print(this.#state());
    const span = this.time - this.#snapshotTime;
    /** @type {!Object<string, number>} */
    const values = {};
    this.#nodes.forEach((node, k) => {
      values[`v(${node})`] = read[k];
    });
    this.#senses.forEach((source, k) => {
      const now = read[this.#nodes.length + k];
      values[`i(${source})`] =
          span > 0 ? (now - this.#charges[k]) / span : 0;
      this.#charges[k] = now;
    });
    this.#snapshotTime = this.time;
    const reader = {
      v: (node) => values[`v(${node})`] ?? 0,
      i: (source) => values[`i(${source})`] ?? 0,
    };
    const parts = {};
    for (const id of this.#circuit.stateParts) {
      parts[id] = this.#circuit.state(id, reader);
    }
    return {parts, values};
  }

  /**
   * Starts the run again at the current time, from the node voltages now,
   * so that ngspice can free the old time points.
   */
  async #restart() {
    const read = await this.#print(this.#state());
    const charges = read.slice(this.#nodes.length);
    // Keep the charge since the last snapshot.
    this.#charges = this.#charges.map((last, k) => last - charges[k]);
    this.#offset += this.#local;
    await this.#load(Object.fromEntries(
        this.#nodes.map((node, k) => [node, read[k]])));
  }

  /**
   * Loads the netlist for a new run that starts at #offset.
   *
   * @param {!Object<string, number>} start Node voltages at the start.
   */
  async #load(start) {
    this.#circuit = toNetlist(this.#diagram, {controls: this.#controls});
    this.#nodes = this.#circuit.usedNodes.filter((node) => node !== '0');
    this.#senses = this.#circuit.senses;
    if (!this.#charges.length) this.#charges = this.#senses.map(() => 0);
    // A capacitor of 1 F that gets the current of a sense source has the
    // charge through the source as its voltage.
    const meters = this.#senses.flatMap((source, k) => [
      `f__meter${k} 0 ${charge(source)} ${source} 1`,
      `c__meter${k} ${charge(source)} 0 1`,
    ]);
    const saved = this.#state();
    // The meters start at 0. Without this, the operating point puts the
    // current through rshunt on them.
    const ic = [
      ...Object.entries(start).map(([node, v]) => `.ic v(${node})=${v}`),
      ...this.#senses.map((source) => `.ic v(${charge(source)})=0`),
    ];
    this.#sim.setNetList(this.#circuit.netlist.replace(/\.end\n$/, [
      ...meters,
      ...(saved.length ? [`.save ${saved.join(' ')}`] : []),
      ...ic,
      // Stop time is far away: "stop when" pauses the run.
      `.tran ${MAX_STEP} 1e9 0 ${MAX_STEP}`,
      '.end\n',
    ].join('\n')));
    // Each PWM wave keeps its phase.
    const phases = [...this.#waveStarts.keys()].flatMap((unit) =>
      this.#circuit.setControl(`${unit}.freqHz`,
          this.#circuit.controls[`${unit}.freqHz`], this.#waveTime(unit)));
    // eecircuit-engine changes "source test.cir" into "remcirc" and then
    // "source test.cir" when a circuit is loaded.
    await this.#exec(['destroy all', 'source test.cir', ...phases]);
    this.#local = 0;
    this.#started = false;
  }

  /**
   * @return {!Array<string>} The vectors of the node voltages, then of the
   *     charges through the sense sources.
   */
  #state() {
    return [
      ...this.#nodes.map(volts),
      ...this.#senses.map((source) => volts(charge(source))),
    ];
  }

  /**
   * @param {string} unit
   * @return {boolean} True if the unit has a PWM control.
   */
  #isPwm(unit) {
    return Object.hasOwn(this.#circuit.controls, `${unit}.freqHz`);
  }

  /**
   * @param {string} unit
   * @return {number} Start time of the unit's wave in this run. It is before
   *     the run when the wave started in an earlier run.
   */
  #waveTime(unit) {
    const start = (this.#waveStarts.get(unit) ?? this.time) - this.#offset;
    const freqHz = this.#circuit.controls[`${unit}.freqHz`];
    if (start >= 0 || !(freqHz > 0)) return Math.max(start, 0);
    // ngspice runs a pulse with a negative delay as if it started earlier.
    const period = 1 / freqHz;
    return ((start % period) + period) % period - period;
  }

  /**
   * Prints vector values at the last time point.
   *
   * @param {!Array<string>} vectors Such as "v(a)".
   * @param {!Array<string>=} before Commands to run first.
   * @return {!Promise<!Array<number>>}
   */
  async #print(vectors, before = []) {
    if (!vectors.length && !before.length) return [];
    const prints = [];
    for (let k = 0; k < vectors.length; k += PRINT_BATCH) {
      const batch = vectors.slice(k, k + PRINT_BATCH);
      prints.push(`print ${batch.map((v) => `${v}[n-1]`).join(' ')}`);
    }
    const info = await this.#exec([
      ...before,
      ...(prints.length ? ['let n = length(time)', ...prints] : []),
    ]);
    /** @type {!Map<string, number>} */
    const printed = new Map();
    const lines = info.matchAll(/([^\s>]+)\[n-1\] = (\S+)/g);
    for (const [, name, value] of lines) {
      printed.set(name, Number(value));
    }
    return vectors.map((v) => {
      const value = printed.get(v);
      if (value === undefined) throw new Error(`ngspice did not print ${v}`);
      return value;
    });
  }

  /**
   * Runs ngspice commands.
   *
   * @param {!Array<string>} commands
   * @return {!Promise<string>} What ngspice printed.
   */
  async #exec(commands) {
    if (!commands.length) return '';
    // eecircuit-engine runs the list, then writes out.raw and reads it,
    // which starts with " ".
    this.#sim.commandList = [' ', ...commands];
    await this.#sim.runSim();
    const errors = this.#sim.getError().filter((line) => ERROR.test(line));
    if (errors.length) throw new Error(`ngspice: ${errors.join('\n')}`);
    return this.#sim.getInfo();
  }
}

/**
 * eecircuit-engine waits for each command with two nested Asyncify sleeps.
 * The outer sleep gets new Asyncify data and drops the data of the inner
 * one, so each command leaks about 4 kB. This makes the outer sleep use the
 * inner one's data.
 *
 * @param {!Object} sim An eecircuit-engine Simulation.
 */
function stopLeak(sim) {
  const asyncify = sim.__getSpiceModuleForTests().Asyncify;
  if (asyncify.allocateData.patched) return;
  const allocate = asyncify.allocateData;
  asyncify.allocateData = function() {
    const data = asyncify.currData;
    if (!data) return allocate.call(asyncify);
    asyncify.setDataHeader(data, data + 12, asyncify.StackSize);
    asyncify.setDataRewindFunc(data);
    return data;
  };
  asyncify.allocateData.patched = true;
}

/**
 * @param {string} node
 * @return {string} The vector of the node's voltage.
 */
function volts(node) {
  return `v(${node})`;
}

/**
 * @param {string} source A sense source.
 * @return {string} The node whose voltage is the charge through it.
 */
function charge(source) {
  return `${source}__q`;
}
