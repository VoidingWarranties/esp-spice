import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, before, mock, test} from 'node:test';
import {encodeVideo, openCircuit} from '../capture.js';

const example = new URL('../examples/blink/', import.meta.url);
const readJson = async (name, dir = example) =>
  JSON.parse(await readFile(new URL(name, dir), 'utf8'));

let circuit;
before(async () => {
  circuit = await openCircuit(
    await readJson('diagram.json'),
    await readJson('trace.json'),
    {scale: 1},
  );
});
after(() => circuit.close());

test('trace changes the picture over time', async () => {
  const off = await circuit.shoot(0);
  const on = await circuit.shoot(0.6);
  assert.notDeepEqual(off, on);
  await circuit.shoot(1.2);
  // Seeking back gives the same picture.
  assert.deepEqual(await circuit.shoot(0.6), on);
});

const skip = !hasFfmpeg() && 'ffmpeg not found';

test('writes an MP4 and a GIF', {skip}, async () => {
  const frames = [await circuit.shoot(0), await circuit.shoot(0.6)];
  for (const name of ['out.mp4', 'out.gif']) {
    const out = path.join(tmpdir(), `esp-spice-${process.pid}-${name}`);
    await encodeVideo(frames, out, 2);
    assert.ok((await stat(out)).size > 0);
  }
});

function hasFfmpeg() {
  try {
    execFileSync('ffmpeg', ['-version'], {stdio: 'ignore'});
    return true;
  } catch {
    return false;
  }
}

test('rejects when ffmpeg fails', {skip}, async () => {
  const frames = [await circuit.shoot(0), await circuit.shoot(0.6)];
  await assert.rejects(
    encodeVideo(frames, '/no/such/dir/out.mp4', 2),
    /ffmpeg exited/,
  );
});

test('draws spice parts with pins and no warnings', async () => {
  const dir = new URL('../examples/npn-switch/', import.meta.url);
  const warn = mock.method(console, 'warn', () => {});
  const npn = await openCircuit(
    await readJson('diagram.json', dir),
    await readJson('trace.json', dir),
    {scale: 1},
  );
  try {
    assert.notDeepEqual(await npn.shoot(0), await npn.shoot(1));
    assert.deepEqual(warn.mock.calls.map((c) => c.arguments), []);
  } finally {
    warn.mock.restore();
    await npn.close();
  }
});

test('draws hidden parts greyed out, or not at all', async () => {
  const dir = new URL('../examples/npn-switch/', import.meta.url);
  const diagram = await readJson('diagram.json', dir);
  const shots = [];
  for (const hide of [false, true]) {
    for (const part of diagram.parts) part.hide = hide && part.id === 'c1';
    for (const showHidden of [true, false]) {
      const options = {scale: 1, showHidden};
      const view = await openCircuit(diagram, undefined, options);
      shots.push((await view.shoot(0)).toString('base64'));
      await view.close();
    }
  }
  const [plain, plainNoHidden, grey, greyNoHidden] = shots;
  assert.equal(plain, plainNoHidden, 'no hidden parts, so no change');
  assert.notEqual(grey, plain, 'hidden part is greyed out');
  assert.notEqual(greyNoHidden, grey, 'hidden part is not drawn');
});

test('draws on a dark grey panel in dark mode', async () => {
  const diagram = await readJson('diagram.json');
  const shots = [];
  for (const dark of [false, true]) {
    const view = await openCircuit(diagram, undefined, {scale: 1, dark});
    shots.push(await view.shoot(0));
    await view.close();
  }
  assert.notDeepEqual(shots[0], shots[1]);
});

test('draws the analog examples with no warnings', async () => {
  const names = ['zener-regulator', 'opamp-amplifier', 'rlc-resonance'];
  const warn = mock.method(console, 'warn', () => {});
  try {
    for (const name of names) {
      const dir = new URL(`../../examples/${name}/`, import.meta.url);
      const view = await openCircuit(await readJson('diagram.json', dir));
      await view.close();
    }
    assert.deepEqual(warn.mock.calls.map((c) => c.arguments), []);
  } finally {
    warn.mock.restore();
  }
});
