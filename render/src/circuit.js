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

// Marks a part or a wire end that the renderer cannot draw correctly.
const WARN_COLOR = '#c00';

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
  const connections = (diagram.connections ?? []).filter(isDrawn);
  const pins = usedPins(connections, partsById);
  const elements = new Map();
  for (const part of parts) {
    const el = createPart(part, pins.get(part.id) ?? new Map());
    container.append(el);
    elements.set(part.id, el);
  }
  await Promise.all([...elements.values()].map((el) => el.updateComplete));

  const wires = [];
  for (const [from, to, color, moves] of connections) {
    const a = pinAt(partsById, elements, from);
    const b = pinAt(partsById, elements, to);
    if (!a || !b) continue;
    const hidden = isHidden(from) || isHidden(to);
    const points = wirePoints(a.point, b.point, moves);
    const unknown = [a, b].filter((end) => end.unknown);
    wires.push({color, hidden, points, unknown});
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
 * @param {!Array} connection A diagram.json connection.
 * @return {boolean}
 */
function isDrawn([from, to, color]) {
  // "" hides the wire. "$" parts, such as $serialMonitor, are not drawn.
  return Boolean(color) && !from.startsWith('$') && !to.startsWith('$');
}

/**
 * Returns the pins that wires use on each part. Each pin gets the side of the
 * part that faces the other end of its first wire.
 * @param {!Array<!Array>} connections
 * @param {!Map<string, !Object>} partsById
 * @return {!Map<string, !Map<string, string>>} Part id to pin name to side.
 */
function usedPins(connections, partsById) {
  const used = new Map();
  const leftOf = (ref) => partsById.get(ref.split(':')[0])?.left ?? 0;
  for (const [from, to] of connections) {
    for (const [ref, other] of [[from, to], [to, from]]) {
      const [id, name] = ref.split(':');
      if (!used.has(id)) used.set(id, new Map());
      const side = leftOf(other) < leftOf(ref) ? 'left' : 'right';
      if (!used.get(id).has(name)) used.get(id).set(name, side);
    }
  }
  return used;
}

/**
 * @param {!Object} part
 * @param {!Map<string, string>} pins Pin names that wires use, to their side.
 *     Only parts with no element use them.
 * @return {!HTMLElement}
 */
function createPart(part, pins) {
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
    el = placeholder(part.type, pins);
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
 * Returns a dashed box with the part type and a pin on its edge for each
 * pin that wires use, so that the wires still show.
 * @param {string} type
 * @param {!Map<string, string>} pins Pin name to side.
 * @return {!HTMLElement}
 */
function placeholder(type, pins) {
  const el = document.createElement('div');
  el.style.cssText = `border: 1px dashed ${WARN_COLOR}; padding: 4px;` +
    ' font: 12px sans-serif; white-space: nowrap;';
  const columns = document.createElement('div');
  columns.style.cssText = 'display: flex; justify-content: space-between;' +
    ' gap: 16px; font-size: 9px;';
  const sides = {left: document.createElement('div'),
    right: document.createElement('div')};
  sides.right.style.textAlign = 'right';
  for (const [name, side] of pins) {
    const label = document.createElement('div');
    label.textContent = name;
    sides[side].append(label);
  }
  columns.append(sides.left, sides.right);
  el.append(type, columns);
  // A getter, because the positions are only known after layout.
  Object.defineProperty(el, 'pinInfo', {
    get: () => Object.entries(sides).flatMap(([side, column]) =>
      [...column.children].map((label) => ({
        name: label.textContent,
        x: side === 'left' ? 0 : el.offsetWidth,
        y: el.clientTop + label.offsetTop + label.offsetHeight / 2,
      }))),
  });
  return el;
}

/**
 * Returns where a wire ends. A pin that the part does not have gives the part
 * center, so that the wire still shows, and unknown: true.
 * @param {!Map<string, !Object>} partsById
 * @param {!Map<string, !HTMLElement>} elements
 * @param {string} ref "partId:pinName".
 * @return {?{point: !Array<number>, unknown: (string|undefined)}}
 */
function pinAt(partsById, elements, ref) {
  const [id, name] = ref.split(':');
  const part = partsById.get(id);
  if (!part) {
    console.warn(`Unknown part: ${ref}`);
    return null;
  }
  const el = elements.get(id);
  const size = {width: el.offsetWidth, height: el.offsetHeight};
  const pin = el.pinInfo?.find((p) => p.name === name);
  if (pin) return {point: pinPosition(part, pin, size)};
  console.warn(`Unknown pin: ${ref}`);
  const center = {x: size.width / 2, y: size.height / 2};
  return {point: pinPosition(part, center, size), unknown: ref};
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
 *     points: !Array<!Array<number>>,
 *     unknown: !Array<{point: !Array<number>, unknown: string}>}>} wires
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
  const marks = [];
  for (const {color, hidden, points, unknown} of wires) {
    const moved = points.map(([x, y]) => `${x + shift[0]},${y + shift[1]}`);
    const halo = polyline(moved, HALO_COLOR, 4);
    const line = polyline(moved, color, 2);
    const ends = unknown.map((end) => mark(end, shift));
    marks.push(...ends);
    if (hidden) {
      for (const el of [halo, line, ...ends]) {
        el.dataset.hidden = '';
        el.style.cssText = HIDDEN_STYLE;
      }
    }
    halos.push(halo);
    lines.push(line);
  }
  // All halos go first, so a halo never covers a wire that crosses it.
  svg.append(...halos, ...lines, ...marks);
  return svg;
}

/**
 * Returns a "?" badge that marks a wire end at an unknown pin.
 * @param {{point: !Array<number>, unknown: string}} end
 * @param {!Array<number>} shift
 * @return {!SVGGElement}
 */
function mark({point: [x, y], unknown}, shift) {
  const badge = document.createElementNS(SVG_NS, 'g');
  badge.setAttribute('transform', `translate(${x + shift[0]} ${y + shift[1]})`);
  badge.innerHTML = `
    <title></title>
    <circle r="6" fill="white" stroke="${WARN_COLOR}" stroke-width="1.5"/>
    <text y="3.5" text-anchor="middle" fill="${WARN_COLOR}"
        style="font: bold 10px sans-serif">?</text>`;
  badge.querySelector('title').textContent = `Unknown pin: ${unknown}`;
  return badge;
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
