import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {afterEach, test} from 'node:test';
import {pathToFileURL} from 'node:url';
import {loadPlugins} from '../plugins.js';
import {Simulation} from '../simulation.js';

const EXAMPLE = new URL(
  '../../examples/audio-fader/diagram.json',
  import.meta.url,
);
const example = JSON.parse(readFileSync(EXAMPLE, 'utf8'));

/** @param {string[]} parts */
const named = (parts) => ({
  version: 1,
  parts: [],
  connections: [],
  'esp-spice': {parts},
});

/** @type {Simulation | undefined} */
let sim;
afterEach(() => sim?.close());

test('audio-fader: the wiper is at 3.3 V (81^x - 1) / 80', async () => {
  const parts = await loadPlugins(example, EXAMPLE);
  assert.deepEqual(Object.keys(parts), ['audio-fader']);
  sim = new Simulation(example, {parts});
  const volts = (value) => (3.3 * (81 ** (value / 1023) - 1)) / 80;
  assert.ok(Math.abs(sim.voltage('fader:WIPER') - volts(512)) < 1e-4);
  sim.set('fader.value', 1023);
  sim.advanceTo(0.01);
  assert.ok(Math.abs(sim.voltage('fader:WIPER') - volts(1023)) < 1e-4);
  assert.deepEqual(sim.state('fader'), {value: 1023});
});

test('a diagram with no plugins loads none', async () => {
  assert.deepEqual(await loadPlugins({parts: []}, EXAMPLE), {});
});

test('only files in the diagram folder load', async () => {
  for (const bad of [
    '../x.js',
    'a/../../x.js',
    '/x.js',
    'https://x/x.js',
    'data:text/javascript,',
    '..\\x.js',
    '%2e%2e/x.js',
    'a/.%2E/../x.js',
  ]) {
    await assert.rejects(loadPlugins(named([bad]), EXAMPLE), /relative path/);
  }
});

test('a plugin type is a custom element name', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'esp-spice-'));
  writeFileSync(
    path.join(dir, 'p.js'),
    `export default {fader: {pins: [], build() {}}};`,
  );
  const url = pathToFileURL(path.join(dir, 'diagram.json'));
  await assert.rejects(loadPlugins(named(['p.js']), url), /with a "-"/);
});

test('a plugin cannot replace a type', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'esp-spice-'));
  const write = (name, type) =>
    writeFileSync(
      path.join(dir, name),
      `export default {'${type}': {pins: [], build() {}}};`,
    );
  write('led.js', 'wokwi-led');
  write('a.js', 'my-x');
  write('b.js', 'my-x');
  const url = pathToFileURL(path.join(dir, 'diagram.json'));
  await assert.rejects(loadPlugins(named(['led.js']), url), /already a type/);
  await assert.rejects(loadPlugins(named(['a.js', 'b.js']), url), /already/);
});
