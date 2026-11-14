/**
 * @fileoverview Draws a Wokwi diagram.json with wokwi-elements in the DOM.
 *
 * Load the wokwi-elements bundle before you call renderCircuit, so that the
 * custom elements are defined.
 */

import './parts.js';
import {stateAt} from './trace.js';
import {pinPosition, wirePoints} from './wires.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
const PADDING = 20;
// Hidden parts are still in the sim, so we show them, but greyed out.
const HIDDEN_STYLE = 'opacity: 0.35; filter: grayscale(1);';
// A light edge under each wire, so dark wires show on dark parts and
// panels.
const HALO_COLOR = 'rgb(255 255 255 / 0.5)';

// The sim gives slide pot values as 0..1023, as for the rotary pot.
const DEFAULT_ATTRS = {'wokwi-slide-potentiometer': {max: '1023'}};

/**
 * Draws the diagram into the container.
 * @param {!HTMLElement} container
 * @param {!Object} diagram Parsed diagram.json.
 * @return {!Promise<{setTime: function(!Object, number): !Promise<void>,
 *     elements: !Map<string, !HTMLElement>, hasHidden: boolean,
 *     showHidden: function(boolean)}>}
 */
export async function renderCircuit(container, diagram) {
  container.replaceChildren();
  container.style.position = 'relative';

  const parts = diagram.parts;
  const partsById = new Map(parts.map((p) => [p.id, p]));
  const isHidden = (ref) => Boolean(partsById.get(ref.split(':')[0])?.hide);
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
    const a = pinAt(partsById, elements, from);
    const b = pinAt(partsById, elements, to);
    if (!a || !b) continue;
    const hidden = isHidden(from) || isHidden(to);
    wires.push({color, hidden, points: wirePoints(a, b, moves)});
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

  // Parts and wires to show or hide with showHidden.
  const hiddenNodes = [...container.querySelectorAll('[data-hidden]')];

  // Element values from before the trace changed them, so seeking back works.
  const defaults = new Map();

  return {
    elements,
    hasHidden: hiddenNodes.length > 0,
    /**
     * Shows or hides the parts with "hide": true, and their wires.
     * @param {boolean} show
     */
    showHidden(show) {
      for (const node of hiddenNodes) {
        node.style.visibility = show ? '' : 'hidden';
      }
    },
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
    const attrs = {...DEFAULT_ATTRS[part.type], ...part.attrs};
    for (const [name, value] of Object.entries(attrs)) {
      el.setAttribute(name, value);
    }
  } else {
    // Show unknown parts, so that a missing element is easy to see.
    console.warn(`No element for part type: ${part.type}`);
    el = document.createElement('div');
    el.textContent = part.type;
    el.style.cssText =
      'border: 1px dashed #c00; padding: 4px; font: 12px sans-serif;';
  }
  el.style.position = 'absolute';
  el.style.left = `${part.left ?? 0}px`;
  el.style.top = `${part.top ?? 0}px`;
  if (part.rotate) el.style.transform = `rotate(${part.rotate}deg)`;
  if (part.hide) {
    el.dataset.hidden = '';
    el.style.cssText += HIDDEN_STYLE;
  }
  return el;
}

/**
 * @param {!Map<string, !Object>} partsById
 * @param {!Map<string, !HTMLElement>} elements
 * @param {string} ref "partId:pinName".
 * @return {?Array<number>}
 */
function pinAt(partsById, elements, ref) {
  const [id, name] = ref.split(':');
  const part = partsById.get(id);
  const el = elements.get(id);
  const pin = el?.pinInfo?.find((p) => p.name === name);
  if (!part || !pin) {
    console.warn(`Unknown pin: ${ref}`);
    return null;
  }
  const size = {width: el.offsetWidth, height: el.offsetHeight};
  return pinPosition(part, pin, size);
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
    for (const cx of [0, size.width]) {
      for (const cy of [0, size.height]) {
        const [x, y] = pinPosition(part, {x: cx, y: cy}, size);
        xs.push(x);
        ys.push(y);
      }
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
 * @param {!Array<{color: string, hidden: boolean,
 *     points: !Array<!Array<number>>}>} wires
 * @param {!Array<number>} shift
 * @return {!SVGSVGElement}
 */
function drawWires(wires, shift) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.style.cssText =
    'position: absolute; inset: 0; width: 100%; height: 100%;' +
    ' overflow: visible; pointer-events: none;';
  const halos = [];
  const lines = [];
  for (const {color, hidden, points} of wires) {
    const moved = points.map(([x, y]) => `${x + shift[0]},${y + shift[1]}`);
    const halo = polyline(moved, HALO_COLOR, 4);
    const line = polyline(moved, color, 2);
    if (hidden) {
      for (const el of [halo, line]) {
        el.dataset.hidden = '';
        el.style.cssText = HIDDEN_STYLE;
      }
    }
    halos.push(halo);
    lines.push(line);
  }
  // All halos go first, so a halo never covers a wire that crosses it.
  svg.append(...halos, ...lines);
  return svg;
}

/**
 * @param {!Array<string>} points "x,y" pairs.
 * @param {string} color
 * @param {number} width
 * @return {!SVGPolylineElement}
 */
function polyline(points, color, width) {
  const line = document.createElementNS(SVG_NS, 'polyline');
  line.setAttribute('points', points.join(' '));
  line.setAttribute('fill', 'none');
  line.setAttribute('stroke', color);
  line.setAttribute('stroke-width', String(width));
  line.setAttribute('stroke-linejoin', 'round');
  line.setAttribute('stroke-linecap', 'round');
  return line;
}
