import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFile, stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {after, before, test} from 'node:test';
import {encodeVideo, openCircuit} from '../capture.js';

const example = new URL('../examples/blink/', import.meta.url);
const readJson = async (name) => JSON.parse(await readFile(new URL(name, example), 'utf8'));

let circuit;
before(async () => {
  circuit = await openCircuit(await readJson('diagram.json'), await readJson('trace.json'), {scale: 1});
});
after(() => circuit.close());

test('trace changes the picture over time', async () => {
  const off = await circuit.shoot(0);
  const on = await circuit.shoot(0.6);
  assert.notDeepEqual(off, on);
  await circuit.shoot(1.2);
  assert.deepEqual(await circuit.shoot(0.6), on, 'seeking back gives the same picture');
});

test('writes an MP4 and a GIF', {skip: !hasFfmpeg() && 'ffmpeg not found'}, async () => {
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
