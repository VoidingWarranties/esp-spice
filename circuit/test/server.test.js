import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

const SERVER = fileURLToPath(new URL('../server.js', import.meta.url));
const DIAGRAM = fileURLToPath(
  new URL('../../examples/esp32-led/diagram.json', import.meta.url),
);

test('the server answers each command with one line', async () => {
  const args = [SERVER, DIAGRAM, '--probe', 'esp:34'];
  const child = spawn(process.execPath, args, {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const lines = createInterface({input: child.stdout})[Symbol.asyncIterator]();
  /** @param {object} request */
  const send = async (request) => {
    child.stdin.write(JSON.stringify(request) + '\n');
    return JSON.parse((await lines.next()).value);
  };

  assert.deepEqual(
    await send({cmd: 'set_pin', pin: 'esp:2', volts: 3.3, ohms: 40}),
    {ok: true},
  );
  assert.deepEqual(await send({cmd: 'set', name: 'btn1.pressed', value: 1}), {
    ok: true,
  });
  const step = await send({
    cmd: 'advance_to',
    t: 0.001,
    pins: ['esp:2', 'esp:4'],
  });
  assert.equal(step.t, 0.001);
  assert.ok(step.v['esp:2'] > 3);
  assert.ok(Math.abs(step.v['esp:4']) < 0.01);
  assert.ok((await send({cmd: 'voltage', pin: 'esp:34'})).v > 1);
  assert.equal((await send({cmd: 'state', part: 'led1'})).value, true);
  const trace = await send({cmd: 'trace'});
  assert.equal(trace.version, 1);
  assert.ok(trace.probes['esp:34'][0].v > 1);
  assert.deepEqual(await send({cmd: 'nope'}), {error: 'unknown command: nope'});
  assert.match((await send({cmd: 'voltage', pin: 'x:1'})).error, /unknown pin/);

  child.stdin.end();
  const [code] = await new Promise((resolve) =>
    child.on('exit', (...args) => resolve(args)),
  );
  assert.equal(code, 0);
});

test('the server loads the part plugins of the diagram', async () => {
  const diagram = fileURLToPath(
    new URL('../../examples/audio-fader/diagram.json', import.meta.url),
  );
  const child = spawn(process.execPath, [SERVER, diagram], {
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const lines = createInterface({input: child.stdout})[Symbol.asyncIterator]();
  child.stdin.end(JSON.stringify({cmd: 'voltage', pin: 'fader:WIPER'}) + '\n');
  const {v} = JSON.parse((await lines.next()).value);
  assert.ok(Math.abs(v - 0.331) < 0.001, `${v}`);
});
