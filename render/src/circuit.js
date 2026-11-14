/**
 * @fileoverview Draws a Wokwi diagram.json with wokwi-elements in the DOM.
 *
 * Load the wokwi-elements bundle before you call renderCircuit, so that the
 * custom elements are defined.
 */

import {stateAt} from './trace.js';
import {pinPosition, wirePoints} from './wires.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PADDING = 20;

/**
 * Draws the diagram into the container.
 * @param {!HTMLElement} container
 * @param {!Object} diagram Parsed diagram.json.
 * @return {!Promise<{setTime: function(!Object, number): !Promise<void>,
 *     elements: !Map<string, !HTMLElement>}>}
 */
export async function renderCircuit(container, diagram) {
  container.replaceChildren();
  container.style.position = 'relative';

  const parts = diagram.parts.filter((p) => !p.hide);
  const elements = new Map();
  for (const part of parts) {
    const el = createPart(part);
    container.append(el);
    elements.set(part.id, el);
  }
  await Promise.all([...elements.values()].map((el) => el.updateComplete));

  const wires = [];
  for (const [from, to, color, moves] of diagram.connections ?? []) {
    // "" hides the wire. "$" parts, such as $serialMonitor, are not drawn.
    if (!color || from.startsWith('$') || to.startsWith('$')) continue;
    const a = pinAt(diagram, elements, from);
    const b = pinAt(diagram, elements, to);
    if (a && b) wires.push({color, points: wirePoints(a, b, moves)});
  }

  const box = bounds(parts, elements, wires);
  const shift = [PADDING - box.left, PADDING - box.top];
  for (const part of parts) {
    const el = elements.get(part.id);
    el.style.left = `${(part.left ?? 0) + shift[0]}px`;
    el.style.top = `${(part.top ?? 0) + shift[1]}px`;
  }
  container.append(drawWires(wires, shift));
  container.style.width = `${box.right - box.left + 2 * PADDING}px`;
  container.style.height = `${box.bottom - box.top + 2 * PADDING}px`;

  // Element values from before the trace changed them, so seeking back works.
  const defaults = new Map();

  return {
    elements,
    /**
     * Shows the trace state at time t.
     * @param {!Object} trace
     * @param {number} t Seconds.
     */
    async setTime(trace, t) {
      for (const [id, props] of Object.entries(stateAt(trace, t))) {
        const el = elements.get(id);
        if (!el) continue;
        const saved = defaults.get(el) ?? {};
        for (const key of Object.keys(props)) {
          if (!(key in saved)) saved[key] = el[key];
        }
        defaults.set(el, saved);
        Object.assign(el, saved, props);
      }
      await Promise.all([...elements.values()].map((el) => el.updateComplete));
    },
  };
}

/**
 * @param {!Object} part
 * @return {!HTMLElement}
 */
function createPart(part) {
  let el;
  if (customElements.get(part.type)) {
    el = document.createElement(part.type);
    for (const [name, value] of Object.entries(part.attrs ?? {})) {
      el.setAttribute(name, value);
    }
  } else {
    // Show unknown parts, so that a missing element is easy to see.
    console.warn(`No element for part type: ${part.type}`);
    el = document.createElement('div');
    el.textContent = part.type;
    el.style.cssText = 'border: 1px dashed #c00; padding: 4px; font: 12px sans-serif;';
  }
  el.style.position = 'absolute';
  el.style.left = `${part.left ?? 0}px`;
  el.style.top = `${part.top ?? 0}px`;
  if (part.rotate) el.style.transform = `rotate(${part.rotate}deg)`;
  return el;
}

/**
 * @param {!Object} diagram
 * @param {!Map<string, !HTMLElement>} elements
 * @param {string} ref "partId:pinName".
 * @return {?Array<number>}
 */
function pinAt(diagram, elements, ref) {
  const [id, name] = ref.split(':');
  const part = diagram.parts.find((p) => p.id === id);
  const el = elements.get(id);
  const pin = el?.pinInfo?.find((p) => p.name === name);
  if (!part || !pin) {
    console.warn(`Unknown pin: ${ref}`);
    return null;
  }
  return pinPosition(part, pin, {width: el.offsetWidth, height: el.offsetHeight});
}

/**
 * Returns the box around all parts and wires, in diagram space.
 */
function bounds(parts, elements, wires) {
  const xs = [];
  const ys = [];
  for (const part of parts) {
    const el = elements.get(part.id);
    const size = {width: el.offsetWidth, height: el.offsetHeight};
    for (const corner of [[0, 0], [size.width, 0], [0, size.height], [size.width, size.height]]) {
      const [x, y] = pinPosition(part, {x: corner[0], y: corner[1]}, size);
      xs.push(x);
      ys.push(y);
    }
  }
  for (const [x, y] of wires.flatMap((w) => w.points)) {
    xs.push(x);
    ys.push(y);
  }
  return {
    left: Math.min(...xs),
    top: Math.min(...ys),
    right: Math.max(...xs),
    bottom: Math.max(...ys),
  };
}

/**
 * @param {!Array<{color: string, points: !Array<!Array<number>>}>} wires
 * @param {!Array<number>} shift
 * @return {!SVGSVGElement}
 */
function drawWires(wires, shift) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.style.cssText =
    'position: absolute; inset: 0; width: 100%; height: 100%; overflow: visible; pointer-events: none;';
  for (const {color, points} of wires) {
    const line = document.createElementNS(SVG_NS, 'polyline');
    line.setAttribute('points', points.map(([x, y]) => `${x + shift[0]},${y + shift[1]}`).join(' '));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', color);
    line.setAttribute('stroke-width', '2');
    line.setAttribute('stroke-linejoin', 'round');
    line.setAttribute('stroke-linecap', 'round');
    svg.append(line);
  }
  return svg;
}
