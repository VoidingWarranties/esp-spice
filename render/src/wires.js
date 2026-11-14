/**
 * @fileoverview Wire routing for Wokwi diagram.json connections.
 *
 * Moves before "*" start at the source pin. Moves after "*" end at the
 * target pin, so we walk them backwards from the target. The gap between
 * the two ends is closed with one horizontal and one vertical segment.
 */

/**
 * Returns the corner points of a wire.
 * @param {!Array<number>} from Source pin [x, y].
 * @param {!Array<number>} to Target pin [x, y].
 * @param {!Array<string>=} moves Wokwi placement moves, such as
 *     ['v10', '*', 'h5'].
 * @return {!Array<!Array<number>>}
 */
export function wirePoints(from, to, moves = []) {
  const star = moves.indexOf('*');
  const head = star < 0 ? moves : moves.slice(0, star);
  const tail = star < 0 ? [] : moves.slice(star + 1);

  const start = [from];
  for (const move of head) start.push(step(start.at(-1), move, 1));

  const end = [to];
  for (const move of tail.slice().reverse()) {
    end.unshift(step(end[0], move, -1));
  }

  const a = start.at(-1);
  const b = end[0];
  // Change direction after the last move, as a hand-routed wire would.
  const lastMove = head.at(-1) ?? '';
  const corner = lastMove.startsWith('h') ? [a[0], b[1]] : [b[0], a[1]];

  return dedupe([...start, corner, ...end]);
}

/**
 * @param {!Array<number>} point
 * @param {string} move
 * @param {number} sign 1 to walk forward, -1 to walk backward.
 * @return {!Array<number>}
 */
function step([x, y], move, sign) {
  const delta = sign * Number(move.slice(1));
  if (move[0] === 'h') return [x + delta, y];
  if (move[0] === 'v') return [x, y + delta];
  throw new Error(`Unknown wire move: ${move}`);
}

/**
 * Removes repeated points and middle points of straight runs.
 * @param {!Array<!Array<number>>} points
 * @return {!Array<!Array<number>>}
 */
function dedupe(points) {
  const out = [];
  for (const p of points) {
    const prev = out.at(-1);
    if (prev && prev[0] === p[0] && prev[1] === p[1]) continue;
    const before = out.at(-2);
    if (before && prev && collinear(before, prev, p)) out.pop();
    out.push(p);
  }
  return out;
}

function collinear(a, b, c) {
  return (a[0] === b[0] && b[0] === c[0]) || (a[1] === b[1] && b[1] === c[1]);
}

/**
 * Returns a pin's position in diagram space.
 * Parts rotate around their center, as CSS transforms do by default.
 * @param {{left: (number|undefined), top: (number|undefined),
 *     rotate: (number|undefined)}} part
 * @param {{x: number, y: number}} pin Pin position in the element.
 * @param {{width: number, height: number}} size Unrotated element size.
 * @return {!Array<number>}
 */
export function pinPosition(part, pin, size) {
  const cx = size.width / 2;
  const cy = size.height / 2;
  const rad = ((part.rotate ?? 0) * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const dx = pin.x - cx;
  const dy = pin.y - cy;
  return [
    round((part.left ?? 0) + cx + dx * cos - dy * sin),
    round((part.top ?? 0) + cy + dx * sin + dy * cos),
  ];
}

// Hides float noise from sin/cos, e.g. 1e-15 instead of 0.
function round(n) {
  return Math.round(n * 1000) / 1000;
}
