# render

Draws a Wokwi `diagram.json` with [wokwi-elements], plays back sim state from
a trace file, and exports PNG screenshots and MP4 or GIF video.

![Blink example](examples/blink/blink.gif)

## Setup

```sh
cd render
npm install
```

Video export needs `ffmpeg` on the `PATH`.

## Capture

```sh
# One PNG for each --png, at the time of the matching --at (seconds).
node capture.js examples/blink/diagram.json --trace examples/blink/trace.json \
  --png off.png --at 0 --png on.png --at 0.6

# Video from --start to --end (default: the trace end). Use .mp4 or .gif.
node capture.js examples/blink/diagram.json --trace examples/blink/trace.json \
  --video blink.mp4 --fps 20
```

`--scale` sets the device pixel ratio (default 2).

## Interactive viewer

Serve this folder with a static file server, then open
`viewer.html?diagram=<path>&trace=<path>`:

```sh
python3 -m http.server
# http://localhost:8000/viewer.html?diagram=examples/blink/diagram.json&trace=examples/blink/trace.json
```

## Use in your own page

`src/` is plain ES modules for the browser, with no build step. Load the
wokwi-elements bundle first.

```html
<script src="https://cdn.jsdelivr.net/npm/@wokwi/elements@1.9.2/dist/wokwi-elements.bundle.min.js"></script>
<div id="circuit"></div>
<script type="module">
  import {renderCircuit} from './src/circuit.js';
  const circuit = await renderCircuit(document.getElementById('circuit'), diagram);
  circuit.elements.get('led1').value = true;  // Map of part id to element.
  await circuit.setTime(trace, 0.5);           // Show the trace state at 0.5 s.
</script>
```

## Trace format

```json
{
  "version": 1,
  "end": 2.0,
  "parts": {
    "led1": [{"t": 0, "value": false}, {"t": 0.5, "value": true, "brightness": 0.8}],
    "lcd1": [{"t": 0, "text": "Hello"}]
  }
}
```

The sim core writes this format (`docs/circuit-format.md`). The renderer
ignores `probes`. Each key frame sets properties of the part's wokwi element. A property keeps
its value until a later key frame changes it. Times are in seconds.

## Diagram support

- Parts: any `type` that is a wokwi-elements tag, for example `wokwi-led` or
  `wokwi-esp32-devkit-v1`. `src/parts.js` draws the types that
  wokwi-elements does not have: `wokwi-vcc`, `wokwi-gnd`, `spice-capacitor`,
  `spice-diode` and `spice-npn`. Other types show as a dashed box.
- `wokwi-slide-potentiometer` gets `max` 1023, because the sim gives pot
  values as 0..1023.
- `top`, `left`, `rotate`, `attrs` and `hide` are supported.
- Wires follow the Wokwi `h`, `v` and `*` moves. An empty color hides a wire.

[wokwi-elements]: https://github.com/wokwi/wokwi-elements
