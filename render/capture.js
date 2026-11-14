#!/usr/bin/env node
/**
 * @fileoverview Exports PNG screenshots and MP4 or GIF video of a circuit.
 *
 * Usage:
 *   node capture.js diagram.json [--trace trace.json]
 *       [--png out.png --at 0.5]...
 *       [--video out.mp4|out.gif --fps 20 --start 0 --end 2]
 *       [--scale 2]
 *
 * Each --png pairs with the --at at the same position (default 0).
 * Video needs ffmpeg on the PATH.
 */

import {spawn} from 'node:child_process';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {chromium} from 'playwright';
import {traceEnd} from './src/trace.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// Not a real host: page.route serves files from ROOT for this origin.
const ORIGIN = 'http://esp-spice.invalid';

/**
 * Opens the viewer in a headless browser with the circuit loaded.
 * @param {!Object} diagram
 * @param {!Object=} trace
 * @param {{scale: (number|undefined)}=} options
 * @return {!Promise<{shoot: function(number): !Promise<!Buffer>,
 *     close: function(): !Promise<void>}>}
 */
export async function openCircuit(diagram, trace, {scale = 2} = {}) {
  const browser = await chromium.launch();
  const page = await browser.newPage({deviceScaleFactor: scale});
  page.on('pageerror', (e) => console.error(e));
  // Shows renderer warnings, such as unknown part types or pins.
  page.on('console', (m) => m.type() === 'warning' && console.warn(m.text()));
  await page.route(`${ORIGIN}/**`, (route) => {
    const file = path.join(ROOT, new URL(route.request().url()).pathname);
    if (!file.startsWith(ROOT + path.sep)) return route.abort();
    return route.fulfill({path: file});
  });
  await page.goto(`${ORIGIN}/viewer.html`);
  await page.waitForFunction(() => window.espSpice);
  await page.evaluate(([d, t]) => window.espSpice.load(d, t), [diagram, trace]);
  const stage = page.locator('#stage');
  return {
    async shoot(t) {
      await page.evaluate((time) => window.espSpice.setTime(time), t);
      return stage.screenshot({animations: 'disabled'});
    },
    close: () => browser.close(),
  };
}

/**
 * Writes PNG frames into ffmpeg to make an MP4 or GIF.
 * @param {!Array<!Buffer>|!AsyncIterable<!Buffer>} frames
 * @param {string} out
 * @param {number} fps
 */
export async function encodeVideo(frames, out, fps) {
  const filter = out.endsWith('.gif')
    ? ['-vf', 'split[a][b];[a]palettegen[p];[b][p]paletteuse']
    // H.264 with yuv420p needs even sizes. This also plays in browsers.
    : ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p'];
  const ffmpeg = spawn(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(fps), '-i', '-', ...filter, out],
    {stdio: ['pipe', 'inherit', 'inherit']},
  );
  const done = new Promise((resolve, reject) => {
    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))));
  });
  for await (const frame of frames) {
    if (!ffmpeg.stdin.write(frame)) {
      await new Promise((resolve) => ffmpeg.stdin.once('drain', resolve));
    }
  }
  ffmpeg.stdin.end();
  await done;
}

async function main() {
  const {values, positionals} = parseArgs({
    allowPositionals: true,
    options: {
      trace: {type: 'string'},
      png: {type: 'string', multiple: true, default: []},
      at: {type: 'string', multiple: true, default: []},
      video: {type: 'string'},
      fps: {type: 'string', default: '20'},
      start: {type: 'string', default: '0'},
      end: {type: 'string'},
      scale: {type: 'string', default: '2'},
    },
  });
  if (positionals.length !== 1) {
    console.error('Usage: node capture.js diagram.json [--trace trace.json] ' +
      '[--png out.png --at 0.5]... [--video out.mp4|out.gif]');
    process.exit(2);
  }
  const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
  const diagram = await readJson(positionals[0]);
  const trace = values.trace ? await readJson(values.trace) : {parts: {}};

  const circuit = await openCircuit(diagram, trace, {scale: Number(values.scale)});
  try {
    for (const [i, out] of values.png.entries()) {
      await writeFile(out, await circuit.shoot(Number(values.at[i] ?? 0)));
      console.log(out);
    }
    if (values.video) {
      const fps = Number(values.fps);
      const start = Number(values.start);
      const end = Number(values.end ?? traceEnd(trace));
      const count = Math.max(1, Math.round((end - start) * fps) + 1);
      async function* frames() {
        for (let i = 0; i < count; i++) yield circuit.shoot(start + i / fps);
      }
      await encodeVideo(frames(), values.video, fps);
      console.log(values.video);
    }
  } finally {
    await circuit.close();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
