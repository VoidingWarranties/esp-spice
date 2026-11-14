/**
 * @fileoverview Playback of a sim trace.
 *
 * Format, shared with the sim core. Its "probes" key is not used here:
 *   {
 *     "version": 1,
 *     "end": 2.0,
 *     "parts": {
 *       "led1": [{"t": 0, "value": false}, {"t": 0.5, "value": true}]
 *     }
 *   }
 * Each key frame sets element properties (for example "value",
 * "brightness", "text", "angle"). A property keeps its value until a later
 * key frame changes it. Times are in seconds and sorted.
 */

// Cumulative state after each key frame, so a seek is a binary search.
const cache = new WeakMap();

/**
 * Returns the element properties of each part at time t.
 * @param {{parts: !Object<string, !Array<!Object>>}} trace
 * @param {number} t Seconds.
 * @return {!Object<string, !Object>}
 */
export function stateAt(trace, t) {
  const state = {};
  for (const [id, frames] of Object.entries(trace.parts ?? {})) {
    const states = cumulative(frames);
    // Index of the last key frame at or before t.
    let lo = 0;
    let hi = frames.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (frames[mid].t <= t) lo = mid + 1;
      else hi = mid;
    }
    const {t: _, ...props} = lo > 0 ? states[lo - 1] : {};
    state[id] = props;
  }
  return state;
}

/**
 * @param {!Array<!Object>} frames
 * @return {!Array<!Object>}
 */
function cumulative(frames) {
  let states = cache.get(frames);
  if (!states) {
    let acc = {};
    states = frames.map((frame) => (acc = {...acc, ...frame}));
    cache.set(frames, states);
  }
  return states;
}

/**
 * Returns the trace length in seconds.
 * @param {{end: (number|undefined),
 *     parts: !Object<string, !Array<!Object>>}} trace
 * @return {number}
 */
export function traceEnd(trace) {
  if (trace.end !== undefined) return trace.end;
  const frames = Object.values(trace.parts ?? {}).flat();
  const times = frames.map((frame) => frame.t);
  return Math.max(0, ...times);
}
