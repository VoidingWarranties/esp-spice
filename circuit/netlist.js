/**
 * @file Changes a diagram.json into an ngspice netlist. No Node imports, so
 * a browser can use this file. See docs/circuit-format.md.
 */

import {PARTS} from './parts.js';

/** Powers of ten for SI prefixes. @type {Record<string, number>} */
const PREFIXES = {
  f: -15,
  p: -12,
  n: -9,
  u: -6,
  µ: -6,
  m: -3,
  k: 3,
  K: 3,
  M: 6,
  meg: 6,
  G: 9,
};

/**
 * Parses a number with an optional SI prefix and unit, such as "4.7k" or
 * "100nF". The unit is ignored.
 * @param {string | number} text
 * @return {number}
 */
export function parseValue(text) {
  if (typeof text === 'number') return text;
  const match =
    /^\s*([+-]?(?:\d+\.?\d*|\.\d+))(?:[eE]([+-]?\d+))?\s*(meg|[fpnuµmkKMG])?[a-zA-ZΩ]*\s*$/.exec(
      String(text),
    );
  if (!match) throw new Error(`not a number: "${text}"`);
  // Add exponents instead of multiplying, so "100n" is exactly 1e-7.
  const exponent = Number(match[2] ?? 0) + (match[3] ? PREFIXES[match[3]] : 0);
  return Number(`${match[1]}e${exponent}`);
}

/**
 * @param {string} text
 * @return {string} Lower case, with only letters, digits and "_".
 */
function sanitize(text) {
  return text.toLowerCase().replace(/[^a-z0-9_]/g, '_');
}

/**
 * Reads values from a solved circuit.
 * @typedef {object} CircuitReader
 * @property {(node: string) => number} v Volts at a node.
 * @property {(source: string) => number} i Amps through a voltage source.
 */

/**
 * @typedef {object} Circuit
 * @property {string} netlist The ngspice deck. It ends with ".end".
 * @property {Record<string, string>} nodes Pin reference to node name.
 * @property {Record<string, number>} controls Control name to value.
 * @property {string[]} warnings
 * @property {string[]} senses Voltage sources that read part currents.
 * @property {string[]} stateParts Ids of parts that have trace props.
 * @property {(name: string, value: number, time: number) => string[]}
 *     setControl Changes a control. Returns the ngspice commands that change
 *     a running simulation to match.
 * @property {(id: string, read: CircuitReader) => Record<string, unknown>}
 *     state Trace props of a part.
 */

/**
 * Changes a diagram into an ngspice netlist.
 * @param {{parts: Array<{type: string, id: string,
 *     attrs?: Record<string, string | number | boolean>}>,
 *     connections: Array<string[]>}} diagram
 * @param {{analysis?: string, controls?: Record<string, number>}} [options]
 *     `analysis` is a line to add before ".end", such as ".op".
 *     `controls` sets start values for controls.
 * @return {Circuit}
 */
export function toNetlist(diagram, {analysis, controls: start = {}} = {}) {
  /** @type {string[]} */
  const warnings = [];
  /** @type {Map<string, {type: string, attrs: Record<string, unknown>,
   *     model: import('./parts.js').PartModel | undefined}>} */
  const parts = new Map();
  for (const {type, id, attrs = {}} of diagram.parts) {
    if (parts.has(id)) throw new Error(`duplicate part id: ${id}`);
    const model = Object.hasOwn(PARTS, type) ? PARTS[type] : undefined;
    if (!model) warnings.push(`unsupported part type: ${type} (${id})`);
    parts.set(id, {type, attrs, model});
  }

  // Union-find over pin references. GROUND is node 0.
  const GROUND = '';
  /** @type {Map<string, string>} */
  const parent = new Map();
  /** @param {string} x @return {string} */
  const find = (x) => {
    if (!parent.has(x)) parent.set(x, x);
    let root = x;
    while (parent.get(root) !== root)
      root = /** @type {string} */ (parent.get(root));
    parent.set(x, root);
    return root;
  };
  /** @param {string} a @param {string} b */
  const union = (a, b) => parent.set(find(a), find(b));

  for (const [id, {model}] of parts) {
    if (!model) continue;
    for (const pin of model.pins) find(`${id}:${pin}`);
    for (const group of model.shorts ?? []) {
      for (const pin of group.slice(1))
        union(`${id}:${group[0]}`, `${id}:${pin}`);
    }
    for (const pin of model.ground ?? []) union(`${id}:${pin}`, GROUND);
  }
  for (const [from, to] of diagram.connections) {
    const refs = [from, to].filter((ref) => checkRef(ref));
    if (refs.length === 2) union(refs[0], refs[1]);
  }

  /**
   * @param {string} ref
   * @return {boolean} False if the reference is not a circuit pin.
   */
  function checkRef(ref) {
    const colon = ref.indexOf(':');
    if (colon < 1) throw new Error(`bad pin reference: "${ref}"`);
    const id = ref.slice(0, colon);
    if (id.startsWith('$')) return false;
    const part = parts.get(id);
    if (!part) throw new Error(`connection to unknown part: "${ref}"`);
    if (part.model && !part.model.pins.includes(ref.slice(colon + 1))) {
      throw new Error(
        `unknown pin: "${ref}" (${part.type} has ` +
          `${part.model.pins.join(', ')})`,
      );
    }
    return true;
  }

  // Names that ngspice reads must be unique.
  /** @type {Set<string>} */
  const used = new Set(['0']);
  /** @param {string} base @return {string} */
  const unique = (base) => {
    let name = sanitize(base);
    for (let i = 2; used.has(name); i++) name = `${sanitize(base)}_${i}`;
    used.add(name);
    return name;
  };

  /** @type {Map<string, string[]>} */
  const members = new Map();
  for (const ref of parent.keys()) {
    const root = find(ref);
    members.set(root, [...(members.get(root) ?? []), ref]);
  }
  /** @type {Map<string, string>} */
  const rootNode = new Map();
  /** @type {Record<string, string>} */
  const nodes = {};
  /** @type {string[]} */
  const nodeComments = [];
  for (const [root, refs] of members) {
    const pins = refs.filter((ref) => ref !== GROUND).sort();
    const node = refs.includes(GROUND) ? '0' : unique(pins[0]);
    rootNode.set(root, node);
    for (const ref of pins) nodes[ref] = node;
    nodeComments.push(`* ${node}: ${pins.join(' ')}`);
  }

  /** @type {string[]} */
  const lines = [];
  /** @type {Map<string, string>} */
  const models = new Map();
  /** @type {Map<string, {values: Record<string, number>,
   *     render: import('./parts.js').Render}>} */
  const units = new Map();
  /** @type {Map<string, Map<string, string>>} */
  const senses = new Map();
  /** @type {Record<string, number>} */
  const controls = {};

  for (const [id, {attrs, model}] of parts) {
    if (!model) continue;
    /** @type {Map<string, string>} */
    const names = new Map();
    /** @param {string} key @return {string} */
    const once = (key) => {
      if (!names.has(key)) names.set(key, unique(key));
      return /** @type {string} */ (names.get(key));
    };
    /** @type {Map<string, string>} */
    const partSenses = new Map();
    senses.set(id, partSenses);
    /** @param {string} name @param {string} fallback @return {string} */
    const attr = (name, fallback) => String(attrs[name] ?? fallback);

    /** @type {import('./parts.js').PartContext} */
    const p = {
      id,
      attr,
      num(name, fallback) {
        try {
          return parseValue(attr(name, fallback));
        } catch (e) {
          throw new Error(
            `${id}: attr ${name}: ${/** @type {Error} */ (e).message}`,
          );
        }
      },
      node: (pin) => /** @type {string} */ (rootNode.get(find(`${id}:${pin}`))),
      wired: (pin) => (members.get(find(`${id}:${pin}`)) ?? []).length > 1,
      inner: (suffix) => once(`${id}__${suffix}`),
      el: (letter, suffix = '') =>
        once(`${letter}_${id}${suffix && '_'}${suffix}`),
      add: (line) => void lines.push(line),
      model(name, body) {
        models.set(name, `.model ${name} ${body}`);
        return name;
      },
      sense(label, from, to) {
        const name = p.el('v', label);
        partSenses.set(label, name);
        lines.push(`${name} ${from} ${to} dc 0`);
      },
      unit(name, defaults, render) {
        const values = {...defaults};
        for (const key of Object.keys(values)) {
          const full = `${name}.${key}`;
          if (full in start) values[key] = start[full];
          controls[full] = values[key];
        }
        units.set(name, {values, render});
        for (const element of render(values, 0)) lines.push(element.line);
      },
    };
    model.build(p);
  }

  for (const name of Object.keys(start)) {
    if (!(name in controls) && !isUnwiredPin(name)) {
      throw new Error(`unknown control: "${name}"`);
    }
  }

  /**
   * @param {string} name Control name, such as "esp:2.volts".
   * @return {boolean} True for a board pin that is not in the circuit.
   */
  function isUnwiredPin(name) {
    const ref = name.slice(0, name.lastIndexOf('.'));
    const colon = ref.indexOf(':');
    const model = parts.get(ref.slice(0, colon))?.model;
    return colon > 0 && Boolean(model?.pins.includes(ref.slice(colon + 1)));
  }

  const netlist =
    [
      'esp-spice circuit',
      '.options rshunt=1e9',
      ...nodeComments.sort(),
      ...lines,
      ...models.values(),
      ...(analysis ? [analysis] : []),
      '.end',
    ].join('\n') + '\n';

  return {
    netlist,
    nodes,
    controls,
    warnings,
    senses: [...senses.values()].flatMap((m) => [...m.values()]),
    stateParts: [...parts]
      .filter(([, {model}]) => model?.state)
      .map(([id]) => id),

    setControl(name, value, time) {
      const dot = name.lastIndexOf('.');
      const unit = units.get(name.slice(0, dot));
      const key = name.slice(dot + 1);
      if (!unit || !(key in unit.values)) {
        if (isUnwiredPin(name)) return [];
        throw new Error(`unknown control: "${name}"`);
      }
      unit.values[key] = value;
      controls[name] = value;
      return unit.render(unit.values, time).map((element) => element.alter);
    },

    state(id, read) {
      const model = parts.get(id)?.model;
      if (!model?.state) throw new Error(`part has no state: "${id}"`);
      const partSenses = /** @type {Map<string, string>} */ (senses.get(id));
      return model.state({
        v: (pin) => read.v(nodes[`${id}:${pin}`]),
        i: (label) => read.i(/** @type {string} */ (partSenses.get(label))),
        control: (key) => controls[`${id}.${key}`],
      });
    },
  };
}
