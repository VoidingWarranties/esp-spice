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
