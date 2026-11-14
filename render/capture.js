#!/usr/bin/env node
/**
 * @fileoverview Exports PNG screenshots and MP4 or GIF video of a circuit.
 *
 * Usage:
 *   node capture.js diagram.json [--trace trace.json]
 *       [--png out.png --at 0.5]...
 *       [--video out.mp4|out.gif --fps 20 --start 0 --end 2]
 *       [--scale 2] [--no-hidden] [--dark]
 *
 * Each --png pairs with the --at at the same position (default 0).
 * Parts with "hide": true show greyed out, unless you give --no-hidden.
 * --dark draws the circuit as the viewer does in dark mode.
 * Video needs ffmpeg on the PATH.
 */

import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {existsSync, realpathSync} from 'node:fs';
import {readFile, writeFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {chromium} from 'playwright';
import {traceEnd} from './src/trace.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
// Not a real host: page.route serves files from ROOT for this origin.
const ORIGIN = 'http://esp-spice.invalid';
const BUNDLE = 'node_modules/@wokwi/elements/dist/wokwi-elements.bundle.js';

/**
 * Opens the viewer in a headless browser with the circuit loaded.
 * @param {!Object} diagram
 * @param {!Object=} trace
 * @param {{scale: (number|undefined), showHidden: (boolean|undefined),
 *     dark: (boolean|undefined)}=} options
 * @return {!Promise<{shoot: function(number): !Promise<!Buffer>,
 *     close: function(): !Promise<void>}>}
 */
export async function openCircuit(
  diagram,
  trace,
  {scale = 2, showHidden = true, dark = false} = {},
) {
  if (!existsSync(path.join(ROOT, BUNDLE))) {
    throw new Error(`Missing ${BUNDLE}. Run "npm install" in ${ROOT}.`);
  }
  // CHROMIUM_PATH lets Nix and other systems use their own Chromium.
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || undefined,
  });
  try {
    const page = await browser.newPage({
      deviceScaleFactor: scale,
      colorScheme: dark ? 'dark' : 'light',
    });
    page.on('pageerror', (e) => console.error(e));
    // Shows renderer warnings, such as unknown part types or pins.
    page.on('console', (m) => {
      if (m.type() === 'warning') console.warn(m.text());
    });
    await page.route(`${ORIGIN}/**`, (route) => {
      const url = new URL(route.request().url());
      const file = path.join(ROOT, url.pathname);
      if (!file.startsWith(ROOT + path.sep) || !existsSync(file)) {
        return route.fulfill({status: 404});
      }
      return route.fulfill({path: file});
    });
    await page.goto(`${ORIGIN}/viewer.html`);
    await page.waitForFunction(() => window.espSpice);
    await page.evaluate(([d, t]) => window.espSpice.load(d, t), [
      diagram,
      trace,
    ]);
    await page.evaluate((s) => window.espSpice.showHidden(s), showHidden);
    return makeCircuit(browser, page);
  } catch (e) {
    await browser.close();
    throw e;
  }
}

function makeCircuit(browser, page) {
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
    : // H.264 with yuv420p needs even sizes. This also plays in browsers.
      ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264',
        '-pix_fmt', 'yuv420p'];
  const input = ['-f', 'image2pipe', '-framerate', String(fps), '-i', '-'];
  const ffmpeg = spawn(
    'ffmpeg',
    ['-y', '-loglevel', 'error', ...input, ...filter, out],
    {stdio: ['pipe', 'inherit', 'inherit']},
  );
  let spawnError;
  ffmpeg.on('error', (e) => (spawnError = e));
  // The exit code below reports the failure, so a broken pipe is not fatal.
  ffmpeg.stdin.on('error', () => {});
  const closed = new Promise((resolve) => ffmpeg.on('close', resolve));

  for await (const frame of frames) {
    if (spawnError || ffmpeg.exitCode !== null) break;
    if (!ffmpeg.stdin.write(frame)) {
      await Promise.race([once(ffmpeg.stdin, 'drain'), closed]);
    }
  }
  ffmpeg.stdin.end();
  const code = await closed;
  if (spawnError) throw new Error(`Cannot run ffmpeg: ${spawnError.message}`);
  if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
}

/**
 * @param {string} name Option name, for the error message.
 * @param {string} value
 * @param {number=} min Smallest allowed value.
 * @return {number}
 */
function toNumber(name, value, min = -Infinity) {
  const n = Number(value);
  if (value === '' || !Number.isFinite(n) || n < min) {
    throw new Error(`--${name} must be a number >= ${min}, got "${value}"`);
  }
  return n;
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
      'no-hidden': {type: 'boolean', default: false},
      dark: {type: 'boolean', default: false},
    },
  });
  if (positionals.length !== 1) {
    console.error('Usage: node capture.js diagram.json [--trace trace.json] ' +
      '[--png out.png --at 0.5]... [--video out.mp4|out.gif]');
    process.exit(2);
  }
  const scale = toNumber('scale', values.scale, 0.1);
  const times = values.png.map((_, i) => toNumber('at', values.at[i] ?? '0'));
  const fps = toNumber('fps', values.fps, 1);
  const start = toNumber('start', values.start);

  const readJson = async (file) => JSON.parse(await readFile(file, 'utf8'));
  const diagram = await readJson(positionals[0]);
  const trace = values.trace ? await readJson(values.trace) : {parts: {}};
  const end = values.end ? toNumber('end', values.end, start) : traceEnd(trace);

  const showHidden = !values['no-hidden'];
  const circuit = await openCircuit(diagram, trace, {
    scale,
    showHidden,
    dark: values.dark,
  });
  try {
    for (const [i, out] of values.png.entries()) {
      await writeFile(out, await circuit.shoot(times[i]));
      console.log(out);
    }
    if (values.video) {
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

// Compare real paths, so this also runs from the npm bin symlink.
if (realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
}
