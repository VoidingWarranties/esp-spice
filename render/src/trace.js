/**
 * @fileoverview Playback of a sim trace.
 *
 * Format, shared with the sim core (version 1 adds "nets", unused here):
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

/**
 * Returns the element properties of each part at time t.
 * @param {{parts: !Object<string, !Array<!Object>>}} trace
 * @param {number} t Seconds.
 * @return {!Object<string, !Object>}
 */
export function stateAt(trace, t) {
  const state = {};
  for (const [id, frames] of Object.entries(trace.parts ?? {})) {
    const props = {};
    for (const frame of frames) {
      if (frame.t > t) break;
      Object.assign(props, frame);
    }
    delete props.t;
    state[id] = props;
  }
  return state;
}

/**
 * Returns the trace length in seconds.
 * @param {{end: (number|undefined), parts: !Object<string, !Array<!Object>>}} trace
 * @return {number}
 */
export function traceEnd(trace) {
  if (trace.end !== undefined) return trace.end;
  const times = Object.values(trace.parts ?? {}).flatMap((f) => f.map((k) => k.t));
  return Math.max(0, ...times);
}
