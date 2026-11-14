/**
 * @fileoverview Steps a circuit in time with the ngspice of
 * eecircuit-engine, which runs ngspice as a command line. Like
 * circuit/simulation.js, but for the browser.
 *
 * eecircuit-engine gives no API to pause a run, so this sets its command
 * list: "stop when" pauses the transient run, "resume" continues it, and
 * "alter" changes controls. ngspice keeps every time point, so after
 * RESTART_SECONDS the run starts again from its state: the node voltages,
 * the inductor currents and the phase of each wave.
 */

import {toNetlist} from '../circuit/netlist.js';
import {OPEN_OHMS, TOGGLE_AMPS} from '../circuit/parts.js';

/** Largest time step, in seconds. */
const MAX_STEP = 100e-6;
/**
 * Run time after which the run starts again, to free memory, in seconds.
 * It starts again after a snapshot, so that each snapshot reads one run.
 */
const RESTART_SECONDS = 1;
/** Times closer than this are equal, in seconds. */
const EPSILON = 1e-9;
/** stderr lines that mean a failure. ngspice also logs notes there. */
const ERROR = /error/i;
/** Expressions in one print command, so that its line stays short. */
const PRINT_BATCH = 8;
/** The prompts that ngspice prints before the output of commands. */
const PROMPTS = /^(ngspice \d+ -> )+/;
/** A sine source in the netlist: its name and the arguments of sin(). */
const SINE = /^(v\S*) \S+ \S+ sin\(([^)]*)\)/gm;
/** Time over which toggles() counts, in seconds, as in simulation.js. */
const TOGGLE_SECONDS = 0.05;
/** An inductor in the netlist. */
const INDUCTOR = /^(l\S*) /gm;

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
  /** @type {!Array<string>} Nodes of part pins, without ground. */
  #nodes = [];
  /** @type {!Array<string>} All nodes, also those inside parts. */
  #allNodes = [];
  /** @type {!Array<string>} Sense sources, for currents. */
  #senses = [];
  /** @type {!Array<string>} Sense sources whose toggles a part reads. */
  #toggled = [];
  /**
   * Charge through each sense source since the run started, at the last
   * snapshot, in coulombs. Mean currents use the change.
   * @type {!Array<number>}
   */
  #charges = [];
  #snapshotTime = 0;
  /** Index of the last time point at the last snapshot. */
  #mark = 0;
  /** True when the next advanceTo() starts the run again. */
  #restartDue = false;
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
    await this.#load();
    await this.advanceTo(0);
    // The run has a vector for each node, also for those inside parts.
    const vectors = await this.#exec(['display']);
    // Nodes inside a device, such as "d1#internal", take no .ic.
    this.#allNodes = [...vectors.matchAll(/^\s*(\S+)\s+: voltage,/gm)]
        .map(([, node]) => node)
        .filter((node) => !node.includes('#') &&
            !this.#senses.some((s) => charge(s) === node));
    // Finds the sources whose toggles the part states read. A state must
    // read them each time, not only for some values.
    const toggled = new Set();
    const probe = {
      v: () => 0,
      i: () => 0,
      toggles: (source) => {
        toggled.add(source);
        return 0;
      },
    };
    for (const id of this.#circuit.stateParts) this.#circuit.state(id, probe);
    this.#toggled = [...toggled];
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
    if (this.#restartDue) await this.#restart();
    const stop = Math.max(t - this.#offset, MAX_STEP) - EPSILON;
    if (this.#started && stop <= this.#local) return this.time;
    const [local] = await this.#print([last('time')], {before: [
      'delete all',
      `stop when time > ${stop}`,
      this.#started ? 'resume' : 'run',
    ]});
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
        wired.map((pin) => last(volts(this.#circuit.nodes[pin]))));
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
   * Reads the part states and the values for the readout, since the last
   * snapshot. Voltages are the value now, with the lowest and highest.
   * Currents are the mean. Call it often: the run starts again only after
   * a snapshot.
   *
   * @return {!Promise<{parts: !Object, values: !Object<string, number>,
   *     ranges: !Object<string, !Array<number>>}>} `ranges` has the lowest
   *     and highest value of each voltage.
   */
  async snapshot() {
    // From the point before the last snapshot, so that it has 2 points.
    const from = Math.max(this.#mark - 1, 0);
    const window = (vector) => `${vector}[${from},n-1]`;
    const nodes = this.#nodes.map(volts);
    // Toggles count over the last TOGGLE_SECONDS of this run: "in" is 1 at
    // the points in that time. For each toggled source, lo and hi are its
    // range there, and s is 1 where it is above the middle.
    const toggleStart = this.#local - TOGGLE_SECONDS;
    const lets = this.#toggled.length ?
        [`let in__ = time ge ${toggleStart}`] : [];
    this.#toggled.forEach((source, k) => {
      const i = `i(${source})`;
      lets.push(
          `let lo__${k} = vecmin(${i} + (1 - in__) * 1e30)`,
          `let hi__${k} = vecmax(${i} - (1 - in__) * 1e30)`,
          `let s__${k} = ${i} gt (lo__${k} + hi__${k}) / 2`);
    });
    const read = await this.#print([
      'n',
      ...nodes.map(last),
      ...nodes.map((v) => `vecmin(${window(v)})`),
      ...nodes.map((v) => `vecmax(${window(v)})`),
      ...this.#senses.map((source) => last(volts(charge(source)))),
      ...this.#toggled.flatMap((_, k) => [
        `hi__${k}-lo__${k}`,
        // The changes of s in that time, so the times it crosses the middle.
        `mean(abs(s__${k}[1,n-1]-s__${k}[0,n-2])*in__[1,n-1])*(n-1)`,
      ]),
    ], {lets});
    let k = 0;
    const next = () => read[k++];
    this.#mark = next() - 1;
    /** @type {!Object<string, number>} */
    const values = {};
    /** @type {!Object<string, !Array<number>>} */
    const ranges = {};
    for (const v of nodes) values[v] = next();
    for (const v of nodes) ranges[v] = [next()];
    for (const v of nodes) ranges[v].push(next());
    const span = this.time - this.#snapshotTime;
    this.#senses.forEach((source, j) => {
      const now = next();
      values[`i(${source})`] =
          span > 0 ? (now - this.#charges[j]) / span : 0;
      this.#charges[j] = now;
    });
    /** @type {!Map<string, number>} */
    const toggles = new Map();
    for (const source of this.#toggled) {
      const range = next();
      const count = next();
      toggles.set(source, range >= TOGGLE_AMPS ? Math.round(count) : 0);
    }
    this.#snapshotTime = this.time;
    this.#restartDue = this.#local >= RESTART_SECONDS;
    const reader = {
      v: (node) => values[volts(node)] ?? 0,
      i: (source) => values[`i(${source})`] ?? 0,
      toggles: (source) => toggles.get(source) ?? 0,
    };
    const parts = {};
    for (const id of this.#circuit.stateParts) {
      parts[id] = this.#circuit.state(id, reader);
    }
    return {parts, values, ranges};
  }

  /**
   * Starts the run again at the current time, from its state now, so that
   * ngspice can free the old time points.
   */
  async #restart() {
    this.#restartDue = false;
    const inductors = this.#inductors();
    const read = await this.#print([
      ...this.#allNodes.map((node) => last(volts(node))),
      ...inductors.map((name) => last(`i(${name})`)),
      ...this.#senses.map((source) => last(volts(charge(source)))),
    ]);
    let k = 0;
    const nodes = this.#allNodes.map((node) => [node, read[k++]]);
    const amps = inductors.map((name) => [name, read[k++]]);
    // The meters start again at 0, so keep the charge since the snapshot.
    this.#charges = this.#charges.map((at) => at - read[k++]);
    this.#offset += this.#local;
    await this.#load({nodes, inductors: amps});
  }

  /**
   * Loads the netlist for a new run that starts at #offset.
   *
   * @param {{nodes: !Array<!Array>, inductors: !Array<!Array>}=} start
   *     The volts of each node and the amps of each inductor at the start.
   *     Without it, the run starts from the operating point.
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
    // The meters start at 0. Without this, the operating point puts the
    // current through rshunt on them.
    const ic = [
      ...(start?.nodes ?? []).map(([node, v]) => `.ic v(${node})=${v}`),
      ...this.#senses.map((source) => `.ic v(${charge(source)})=0`),
    ];
    // The first run saves all vectors, to find the nodes. Later runs save
    // what restarts, snapshots and toggles read.
    const saved = this.#allNodes.length ? [
      ...this.#allNodes.map(volts),
      ...this.#senses.map((source) => volts(charge(source))),
      ...this.#inductors().map((name) => `${name}#branch`),
      ...this.#toggled.map((source) => `${source}#branch`),
    ] : [];
    this.#sim.setNetList(this.#circuit.netlist.replace(/\.end\n$/, [
      ...meters,
      ...saved.map((vector) => `.save ${vector}`),
      ...ic,
      // Stop time is far away: "stop when" pauses the run. A restart uses
      // the start state ("uic"), not the operating point, which would
      // force the inductors' nodes to their voltages and so give them a
      // huge current.
      `.tran ${MAX_STEP} 1e9 0 ${MAX_STEP}${start ? ' uic' : ''}`,
      '.end\n',
    ].join('\n')));
    const inductors = (start?.inductors ?? []).map(([name, amps]) =>
      `alter ${name} ic=${amps}`);
    // Each PWM wave keeps its phase.
    const phases = [...this.#waveStarts.keys()].flatMap((unit) =>
      this.#circuit.setControl(`${unit}.freqHz`,
          this.#circuit.controls[`${unit}.freqHz`], this.#waveTime(unit)));
    // Each sine keeps its phase: a negative delay runs it as if it started
    // at time 0.
    const sines = [...this.#circuit.netlist.matchAll(SINE)].map(
        ([, name, args]) => {
          const [offset, amplitude, freqHz, delay = 0, ...rest] =
              args.trim().split(/\s+/).map(Number);
          const late = this.#offset - delay;
          const shift = late > 0 ? late % (1 / freqHz) : late;
          return `alter @${name}[sin] = [ ` +
              `${[offset, amplitude, freqHz, -shift, ...rest].join(' ')} ]`;
        });
    // eecircuit-engine changes "source test.cir" into "remcirc" and then
    // "source test.cir" when a circuit is loaded.
    await this.#exec([
      'destroy all', 'source test.cir', ...inductors, ...phases, ...sines,
    ]);
    this.#mark = 0;
    this.#local = 0;
    this.#started = false;
  }

  /** @return {!Array<string>} The names of the inductors. */
  #inductors() {
    return [...this.#circuit.netlist.matchAll(INDUCTOR)]
        .map(([, name]) => name);
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
   * Prints the values of expressions.
   *
   * @param {!Array<string>} expressions Such as "v(a)[n-1]", where n is the
   *     length of the time vector. They have no spaces.
   * @param {{before: (!Array<string>|undefined),
   *     lets: (!Array<string>|undefined)}=} commands To run before n is
   *     set, and after.
   * @return {!Promise<!Array<number>>}
   */
  async #print(expressions, {before = [], lets = []} = {}) {
    if (!expressions.length && !before.length) return [];
    const prints = [];
    for (let k = 0; k < expressions.length; k += PRINT_BATCH) {
      prints.push(
          `print ${expressions.slice(k, k + PRINT_BATCH).join(' ')}`);
    }
    const info = await this.#exec([
      ...before,
      ...(prints.length ? ['let n = length(time)', ...lets, ...prints] : []),
    ]);
    // ngspice prints each expression as "expression = value".
    /** @type {!Map<string, number>} */
    const printed = new Map();
    for (const line of info.split('\n')) {
      const match =
          line.replace(PROMPTS, '').trim().match(/^(\S+) = (\S+)$/);
      if (match) printed.set(match[1].toLowerCase(), Number(match[2]));
    }
    return expressions.map((expression) => {
      const value = printed.get(expression.toLowerCase());
      if (value === undefined) {
        throw new Error(`ngspice did not print ${expression}`);
      }
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
 * @param {string} vector
 * @return {string} The vector's value at the last time point.
 */
function last(vector) {
  return `${vector}[n-1]`;
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
