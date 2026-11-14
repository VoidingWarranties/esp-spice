/**
 * @file Records a trace: part props and probe voltages as keyframes. No
 * Node imports, so a browser can use this file. See docs/circuit-format.md.
 */

/**
 * @typedef {{t: number} & Record<string, unknown>} Keyframe
 */

/**
 * @typedef {object} Trace
 * @property {1} version
 * @property {number} end Last simulated time, in seconds.
 * @property {Record<string, Keyframe[]>} parts
 * @property {Record<string, Keyframe[]>} [probes]
 */

/** @param {number} t @return {number} Time without float noise. */
const roundTime = (t) => Math.round(t * 1e9) / 1e9;

/**
 * Adds a keyframe with the props that changed since `last`.
 * @param {Keyframe[]} frames
 * @param {Record<string, unknown> | undefined} last
 * @param {number} t
 * @param {Record<string, unknown>} props
 */
function addFrame(frames, last, t, props) {
  /** @type {Record<string, unknown>} */
  const changed = {};
  for (const [key, value] of Object.entries(props)) {
    if (!last || JSON.stringify(last[key]) !== JSON.stringify(value)) {
      changed[key] = value;
    }
  }
  if (Object.keys(changed).length === 0) return;
  const previous = frames.at(-1);
  if (previous?.t === t) {
    Object.assign(previous, changed);
  } else {
    frames.push({t, ...changed});
  }
}

/** Builds a trace from states that the simulation reports over time. */
export class TraceRecorder {
  /** @type {Record<string, Keyframe[]>} */
  #parts = {};
  /** @type {Record<string, Keyframe[]>} */
  #probes = {};
  /** @type {Map<string, Record<string, unknown>>} */
  #last = new Map();
  #end = 0;

  /**
   * @param {number} t Time, in seconds. Not less than the last call.
   * @param {Record<string, Record<string, unknown>>} parts Part id to props.
   * @param {Record<string, number>} [probes] Pin to volts.
   */
  record(t, parts, probes = {}) {
    t = roundTime(t);
    for (const [id, props] of Object.entries(parts)) {
      addFrame((this.#parts[id] ??= []), this.#last.get(id), t, props);
      this.#last.set(id, props);
    }
    for (const [pin, volts] of Object.entries(probes)) {
      const props = {v: Math.round(volts * 1000) / 1000};
      addFrame(
        (this.#probes[pin] ??= []),
        this.#last.get(`probe ${pin}`),
        t,
        props,
      );
      this.#last.set(`probe ${pin}`, props);
    }
    this.#end = t;
  }

  /**
   * @param {number} [end] Last simulated time. Default: last record.
   * @return {Trace}
   */
  toJSON(end = this.#end) {
    // Copy, so later records do not change a trace that was returned.
    return structuredClone({
      version: /** @type {1} */ (1),
      end: roundTime(end),
      parts: this.#parts,
      ...(Object.keys(this.#probes).length ? {probes: this.#probes} : {}),
    });
  }
}
