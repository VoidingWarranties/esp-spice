#!/usr/bin/env node
/**
 * @file Runs a Simulation over JSON lines on stdin and stdout, for programs
 * that are not JavaScript. See "Process protocol" in docs/circuit-format.md.
 *
 * Usage: node circuit/server.js diagram.json [--max-step 10e-6]
 *     [--probe PIN]...
 */

import {readFileSync} from 'node:fs';
import {createInterface} from 'node:readline';
import {parseArgs} from 'node:util';
import {parseValue} from './netlist.js';
import {Simulation} from './simulation.js';

const {values, positionals} = parseArgs({
  allowPositionals: true,
  options: {
    'max-step': {type: 'string'},
    probe: {type: 'string', multiple: true, default: []},
  },
});
if (positionals.length !== 1) {
  process.stderr.write(
    'usage: node circuit/server.js diagram.json [--max-step 10e-6] ' +
      '[--probe PIN]...\n',
  );
  process.exit(2);
}

const diagram = JSON.parse(readFileSync(positionals[0], 'utf8'));
const maxStep = values['max-step'] ? parseValue(values['max-step']) : undefined;
/** @type {Simulation} */
let sim;
try {
  sim = new Simulation(diagram, {maxStep, probes: values.probe});
} catch (e) {
  // A message, not a stack trace, for a bad diagram or --probe pin.
  process.stderr.write(`${/** @type {Error} */ (e).message}\n`);
  process.exit(2);
}
for (const warning of sim.warnings)
  process.stderr.write(`warning: ${warning}\n`);

/** @type {Record<string, (request: any) => unknown>} */
const COMMANDS = {
  advance_to({t, pins}) {
    const time = sim.advanceTo(t);
    if (!pins) return {t: time};
    const v = pins.map((/** @type {string} */ pin) => [pin, sim.voltage(pin)]);
    return {t: time, v: Object.fromEntries(v)};
  },
  set({name, value}) {
    sim.set(name, value);
    return {ok: true};
  },
  set_pin({pin, volts, ohms, freq_hz: freqHz, duty}) {
    const drive = Object.fromEntries(
      Object.entries({volts, ohms, freqHz, duty}).filter(
        ([, value]) => value !== undefined,
      ),
    );
    sim.setPin(pin, drive);
    return {ok: true};
  },
  voltage: ({pin}) => ({v: sim.voltage(pin)}),
  state: ({part}) => sim.state(part),
  trace: () => sim.trace(),
};

for await (const line of createInterface({input: process.stdin})) {
  if (!line.trim()) continue;
  let reply;
  try {
    const request = JSON.parse(line);
    const command = Object.hasOwn(COMMANDS, request.cmd)
      ? COMMANDS[request.cmd]
      : null;
    if (!command) throw new Error(`unknown command: ${request.cmd}`);
    reply = command(request);
  } catch (e) {
    reply = {error: /** @type {Error} */ (e).message};
  }
  process.stdout.write(JSON.stringify(reply) + '\n');
}
sim.close();
