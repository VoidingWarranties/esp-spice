/**
 * @file Circuit models for diagram.json part types. No Node imports, so a
 * browser can use this file.
 */

/** Resistance of a closed switch, in ohms. */
export const CLOSED_OHMS = 0.05;
/** Resistance of an open switch, in ohms. */
export const OPEN_OHMS = 1e9;
/** LED current for full brightness, in amps. */
export const LED_FULL_AMPS = 5e-3;
/** kT/q at 27 C, the ngspice default temperature, in volts. */
const THERMAL_VOLTS = 0.025865;

/**
 * Context that a part model uses to add itself to the netlist.
 * @typedef {object} PartContext
 * @property {string} id Part id.
 * @property {(name: string, fallback: string) => string} attr
 * @property {(name: string, fallback: string) => number} num Attr as a number.
 * @property {(pin: string) => string} node Node of a pin.
 * @property {(pin: string) => boolean} wired True if a pin connects to
 *     another part.
 * @property {(suffix: string) => string} inner A node inside the part.
 * @property {(letter: string, suffix?: string) => string} el Element name.
 * @property {(line: string) => void} add Adds a netlist line.
 * @property {(name: string, body: string) => string} model Adds a .model.
 * @property {(label: string, from: string, to: string) => void} sense
 *     Adds a 0 V source to read the current from `from` to `to`.
 * @property {(unit: string, values: Record<string, number>,
 *     render: Render) => void} unit Adds elements that controls change.
 */

/**
 * Makes the elements of a control unit from its control values.
 * @callback Render
 * @param {Record<string, number>} values Control values.
 * @param {number} time Simulation time, in seconds.
 * @return {Element[]}
 */

/**
 * @typedef {object} Element
 * @property {string} line Netlist line.
 * @property {string} alter Command that changes a running simulation to
 *     match `line`.
 */

/**
 * Reads the circuit for a part's trace props.
 * @typedef {object} Reader
 * @property {(pin: string) => number} v Volts at a pin.
 * @property {(label: string) => number} i Amps through a sense source.
 * @property {(name: string) => number} control Value of a control.
 */

/**
 * @typedef {object} PartModel
 * @property {string[]} pins
 * @property {string[]} [ground] Pins that are always at node 0.
 * @property {string[][]} [shorts] Groups of pins that the part connects.
 * @property {(p: PartContext) => void} build
 * @property {(r: Reader) => Record<string, unknown>} [state] Trace props.
 */

/**
 * @param {string} name
 * @param {string} a
 * @param {string} b
 * @param {number} ohms
 * @return {Element}
 */
export function resistor(name, a, b, ohms) {
  return {line: `${name} ${a} ${b} ${ohms}`, alter: `alter ${name} = ${ohms}`};
}

/**
 * A voltage source for a DC level, or a square wave when `freqHz` > 0.
 * @param {string} name
 * @param {string} a
 * @param {string} b
 * @param {Record<string, number>} drive Has `volts`, and can have `freqHz`
 *     and `duty`.
 * @param {number} time Start of the wave, in seconds.
 * @return {Element}
 */
export function pulseSource(name, a, b, {volts, freqHz = 0, duty = 0}, time) {
  let args;
  if (freqHz > 0 && duty > 0 && duty < 1) {
    const period = 1 / freqHz;
    // Short enough that the pulse width stays positive at any duty.
    const edge = Math.min(
      1e-8,
      period / 100,
      (duty * period) / 2,
      ((1 - duty) * period) / 2,
    );
    args = [0, volts, time, edge, edge, duty * period - edge, period];
  } else {
    const level = freqHz > 0 && duty <= 0 ? 0 : volts;
    // Same level at both ends, so the source is flat.
    args = [level, level, 0, 1e-9, 1e-9, 1, 2];
  }
  return {
    line: `${name} ${a} ${b} pulse(${args.join(' ')})`,
    alter: `alter @${name}[pulse] = [ ${args.join(' ')} ]`,
  };
}

/**
 * Forward voltage at 10 mA for LED colors.
 * @type {Record<string, number>}
 */
const LED_VOLTS = {
  red: 1.9,
  orange: 2.0,
  yellow: 2.0,
  green: 3.0,
  blue: 3.0,
  white: 3.0,
  purple: 3.0,
};

/**
 * Adds a diode model for an LED and returns its name.
 * @param {PartContext} p
 * @param {string} color
 * @return {string}
 */
function ledModel(p, color) {
  const volts = LED_VOLTS[color.toLowerCase()] ?? 2.0;
  const n = 2;
  const vt = 0.02585;
  const is = 0.01 * Math.exp(-volts / (n * vt));
  const name = `led_${String(volts).replace('.', 'v')}`;
  return p.model(name, `d(is=${is.toExponential(4)} n=${n} rs=1)`);
}

/**
 * Adds an LED from `a` to `c`, with a sense source labeled `label`.
 * @param {PartContext} p
 * @param {string} a Anode node.
 * @param {string} c Cathode node.
 * @param {string} color
 * @param {string} label
 */
function addLed(p, a, c, color, label) {
  const mid = p.inner(label);
  p.sense(label, a, mid);
  p.add(`${p.el('d', label)} ${mid} ${c} ${ledModel(p, color)}`);
}

/**
 * @param {number} amps
 * @return {number} LED brightness, 0..1, rounded to 0.01.
 */
function brightness(amps) {
  return Math.round(Math.min(1, Math.max(0, amps / LED_FULL_AMPS)) * 100) / 100;
}

/** @type {Record<string, string>} */
const DIODES = {
  '1N4148': 'd(is=2.52n rs=0.568 n=1.752 cjo=4p m=0.4 tt=20n bv=100 ibv=100u)',
  '1N4007':
    'd(is=7.03n rs=0.0342 n=1.81 bv=1000 ibv=0.1 cjo=10p vj=0.7 m=0.5 tt=100n)',
};

/** @type {Record<string, string>} */
const NPNS = {
  '2N2222':
    'npn(is=1e-14 vaf=100 bf=200 ikf=0.3 xtb=1.5 br=3 cjc=8p cje=25p ' +
    'tr=100n tf=400p itf=1 vtf=2 xtf=3 rb=10 rc=0.3 re=0.2)',
  '2N3904':
    'npn(is=6.734f xti=3 eg=1.11 vaf=74.03 bf=416.4 ne=1.259 ' +
    'ise=6.734f ikf=66.78m xtb=1.5 br=0.7371 nc=2 rc=1 cjc=3.638p ' +
    'mjc=0.3085 vjc=0.75 fc=0.5 cje=4.493p mje=0.2593 vje=0.75 tr=239.5n ' +
    'tf=301.2p itf=0.4 vtf=4 xtf=2 rb=10)',
};

/** @type {Record<string, string>} */
const PNPS = {
  '2N3906':
    'pnp(is=1.41f xti=3 eg=1.11 vaf=18.7 bf=180.7 ne=1.5 ikf=80m xtb=1.5 ' +
    'br=4.977 nc=2 rc=2.5 cjc=9.728p mjc=0.5776 vjc=0.75 fc=0.5 ' +
    'cje=8.063p mje=0.3677 vje=0.75 tr=33.42n tf=179.3p itf=0.4 vtf=4 ' +
    'xtf=6 rb=10)',
  '2N2907':
    'pnp(is=650.6e-18 xti=3 eg=1.11 vaf=115.7 bf=231.7 ne=1.829 ' +
    'ise=54.81f ikf=1.079 xtb=1.5 br=3.563 nc=2 rc=0.715 cjc=14.76p ' +
    'mjc=0.5383 vjc=0.75 fc=0.5 cje=19.82p mje=0.3357 vje=0.75 tr=111.3n ' +
    'tf=603.7p itf=0.65 vtf=5 xtf=1.7 rb=10)',
};

// ngspice VDMOS models: three pins and a body diode. The values are near
// the typical datasheet threshold and on resistance.
/** @type {Record<string, string>} */
const NMOS = {
  '2N7000':
    'vdmos(vto=1.6 kp=0.17 rs=0.75 rg=3 cgs=50p cgdmin=12p cgdmax=80p ' +
    'cjo=50p is=0.04p)',
  IRLZ44N:
    'vdmos(vto=1.5 kp=12 rd=3m rs=3m rg=3 cgs=1.6n cgdmin=0.1n ' +
    'cgdmax=1.8n cjo=0.6n is=72p)',
};

/** @type {Record<string, string>} */
const PMOS = {
  BS250:
    'vdmos(pchan vto=-2.2 kp=0.056 rd=1 rs=1 rg=3 cgs=60p cgdmin=10p ' +
    'cgdmax=60p cjo=30p is=0.04p)',
  IRF9540:
    'vdmos(pchan vto=-3 kp=1.3 rd=10m rs=10m rg=3 cgs=1.2n cgdmin=0.2n ' +
    'cgdmax=1n cjo=0.6n is=40p)',
};

/**
 * Zener voltage at the test current, test current, and impedance at the
 * test current, from datasheets.
 * @type {Record<string, {vz: number, izt: number, zzt: number}>}
 */
const ZENERS = {
  '1N4728A': {vz: 3.3, izt: 76e-3, zzt: 10},
  '1N4733A': {vz: 5.1, izt: 49e-3, zzt: 7},
  '1N4742A': {vz: 12, izt: 21e-3, zzt: 9},
};

/**
 * Open-loop gain, gain-bandwidth in Hz, slew rate in V/s, and how close the
 * output gets to each supply rail, in volts.
 * @type {Record<string, {gain: number, gbw: number, slew: number,
 *     high: number, low: number}>}
 */
const OPAMPS = {
  LM358: {gain: 1e5, gbw: 1e6, slew: 0.3e6, high: 1.5, low: 0.02},
  MCP6002: {gain: 4e5, gbw: 1e6, slew: 0.6e6, high: 0.025, low: 0.025},
};

/**
 * Adds a transistor whose model is from `table`.
 * @param {string} letter Element letter and model name prefix.
 * @param {Record<string, string>} table
 * @param {string} fallback Default model.
 * @param {string[]} pins In netlist order.
 * @return {PartModel}
 */
function transistor(letter, table, fallback, pins) {
  return {
    pins,
    build(p) {
      const key = p.attr('model', fallback);
      const model = p.model(
        `${letter}_${key.toLowerCase()}`,
        lookup(table, key, p.id),
      );
      p.add(`${p.el(letter)} ${pins.map(p.node).join(' ')} ${model}`);
    },
  };
}

/**
 * @template T
 * @param {Record<string, T>} table
 * @param {string} key
 * @param {string} id
 * @return {T}
 */
function lookup(table, key, id) {
  const body = table[key.toUpperCase()];
  if (!body) {
    throw new Error(
      `${id}: unknown model "${key}", use one of: ` +
        Object.keys(table).join(', '),
    );
  }
  return body;
}

/**
 * A potentiometer between GND, SIG and VCC.
 * @type {PartModel}
 */
const potentiometer = {
  pins: ['GND', 'SIG', 'VCC'],
  build(p) {
    const ohms = p.num('resistance', '10k');
    p.unit(p.id, {value: p.num('value', '0')}, ({value}) => {
      const x = Math.min(1, Math.max(0, value / 1023));
      return [
        resistor(
          p.el('r', 'low'),
          p.node('GND'),
          p.node('SIG'),
          Math.max(CLOSED_OHMS, ohms * x),
        ),
        resistor(
          p.el('r', 'high'),
          p.node('SIG'),
          p.node('VCC'),
          Math.max(CLOSED_OHMS, ohms * (1 - x)),
        ),
      ];
    });
  },
  state: (r) => ({value: r.control('value')}),
};

/** @type {PartModel} */
const pushbutton = {
  pins: ['1.l', '1.r', '2.l', '2.r'],
  shorts: [
    ['1.l', '1.r'],
    ['2.l', '2.r'],
  ],
  build(p) {
    p.unit(p.id, {pressed: 0}, ({pressed}) => [
      resistor(
        p.el('r'),
        p.node('1.l'),
        p.node('2.l'),
        pressed ? CLOSED_OHMS : OPEN_OHMS,
      ),
    ]);
  },
  state: (r) => ({pressed: Boolean(r.control('pressed'))}),
};

/**
 * A board with power pins and GPIO pin drivers.
 * @param {{gpio: string[], ground: string[], v3: string, v5: string,
 *     other: string[]}} pins
 * @return {PartModel}
 */
function board({gpio, ground, v3, v5, other}) {
  return {
    pins: [...gpio, ...ground, v3, v5, ...other],
    ground,
    build(p) {
      /** @type {Array<[string, number]>} */
      const supplies = [
        [v3, 3.3],
        [v5, 5],
      ];
      for (const [pin, volts] of supplies) {
        if (!p.wired(pin)) continue;
        const inner = p.inner(pin);
        p.add(`${p.el('v', pin)} ${inner} 0 dc ${volts}`);
        p.add(`${p.el('r', pin)} ${inner} ${p.node(pin)} 0.01`);
      }
      for (const pin of gpio) {
        const initial = {volts: 0, ohms: OPEN_OHMS, freqHz: 0, duty: 0};
        // A pin that is not wired keeps its drive, with no elements.
        if (!p.wired(pin)) {
          p.unit(`${p.id}:${pin}`, initial, () => []);
          continue;
        }
        const drv = p.inner(pin);
        p.unit(`${p.id}:${pin}`, initial, (drive, time) => [
          pulseSource(p.el('v', pin), drv, '0', drive, time),
          resistor(p.el('r', pin), drv, p.node(pin), drive.ohms),
        ]);
      }
    },
  };
}

/** @type {Record<string, PartModel>} */
export const PARTS = {
  'wokwi-resistor': {
    pins: ['1', '2'],
    build(p) {
      p.add(
        `${p.el('r')} ${p.node('1')} ${p.node('2')} ${p.num('value', '1000')}`,
      );
    },
  },

  'wokwi-led': {
    pins: ['A', 'C'],
    build(p) {
      addLed(p, p.node('A'), p.node('C'), p.attr('color', 'red'), 'i');
    },
    state(r) {
      const b = brightness(r.i('i'));
      return {value: b > 0, brightness: b};
    },
  },

  'wokwi-rgb-led': {
    pins: ['R', 'G', 'B', 'COM'],
    build(p) {
      const anode = p.attr('common', 'anode') !== 'cathode';
      /** @type {Array<[string, string]>} */
      const leds = [
        ['R', 'red'],
        ['G', 'green'],
        ['B', 'blue'],
      ];
      const com = p.node('COM');
      for (const [pin, color] of leds) {
        const n = p.node(pin);
        addLed(p, anode ? com : n, anode ? n : com, color, pin.toLowerCase());
      }
    },
    state: (r) => ({
      ledRed: brightness(r.i('r')),
      ledGreen: brightness(r.i('g')),
      ledBlue: brightness(r.i('b')),
    }),
  },

  'wokwi-led-bar-graph': {
    pins: [...Array(10)].flatMap((_, i) => [`A${i + 1}`, `C${i + 1}`]),
    build(p) {
      for (let i = 1; i <= 10; i++) {
        addLed(
          p,
          p.node(`A${i}`),
          p.node(`C${i}`),
          p.attr('color', 'red'),
          `i${i}`,
        );
      }
    },
    state: (r) => ({
      values: [...Array(10)].map((_, i) => brightness(r.i(`i${i + 1}`))),
    }),
  },

  'wokwi-pushbutton': pushbutton,
  'wokwi-pushbutton-6mm': pushbutton,

  'wokwi-slide-switch': {
    pins: ['1', '2', '3'],
    build(p) {
      const on = ['1', 'true'].includes(p.attr('value', '').toLowerCase());
      const initial = {value: on ? 1 : 0};
      p.unit(p.id, initial, ({value}) => [
        resistor(
          p.el('r', 'a'),
          p.node('2'),
          p.node('1'),
          value ? OPEN_OHMS : CLOSED_OHMS,
        ),
        resistor(
          p.el('r', 'b'),
          p.node('2'),
          p.node('3'),
          value ? CLOSED_OHMS : OPEN_OHMS,
        ),
      ]);
    },
    state: (r) => ({value: r.control('value') ? 1 : 0}),
  },

  'wokwi-potentiometer': potentiometer,
  'wokwi-slide-potentiometer': potentiometer,

  'wokwi-buzzer': {
    pins: ['1', '2'],
    build(p) {
      const mid = p.inner('i');
      p.sense('i', p.node('1'), mid);
      p.add(`${p.el('r')} ${mid} ${p.node('2')} ${p.num('resistance', '42')}`);
    },
    state: (r) => ({hasSignal: Math.abs(r.i('i')) > 1e-3}),
  },

  'wokwi-vcc': {
    pins: ['VCC'],
    build(p) {
      const inner = p.inner('src');
      p.add(`${p.el('v')} ${inner} 0 dc ${p.num('voltage', '3.3')}`);
      p.add(`${p.el('r')} ${inner} ${p.node('VCC')} 0.01`);
    },
  },

  'wokwi-gnd': {
    pins: ['GND'],
    ground: ['GND'],
    build() {},
  },

  'spice-capacitor': {
    pins: ['1', '2'],
    build(p) {
      p.add(
        `${p.el('c')} ${p.node('1')} ${p.node('2')} ${p.num('value', '1u')}`,
      );
    },
  },

  'spice-diode': {
    pins: ['A', 'C'],
    build(p) {
      const key = p.attr('model', '1N4148');
      const model = p.model(
        `d_${key.toLowerCase()}`,
        lookup(DIODES, key, p.id),
      );
      p.add(`${p.el('d')} ${p.node('A')} ${p.node('C')} ${model}`);
    },
  },

  'spice-npn': transistor('q', NPNS, '2N2222', ['C', 'B', 'E']),
  'spice-pnp': transistor('q', PNPS, '2N3906', ['C', 'B', 'E']),
  'spice-nmos': transistor('m', NMOS, '2N7000', ['D', 'G', 'S']),
  'spice-pmos': transistor('m', PMOS, 'BS250', ['D', 'G', 'S']),

  'spice-zener': {
    pins: ['A', 'C'],
    build(p) {
      const key = p.attr('model', '1N4733A');
      const {vz, izt, zzt} = lookup(ZENERS, key, p.id);
      // Breakdown current is izt * exp((v - bv) / vt) + a drop on rs, so
      // these give vz at izt and a slope of zzt there.
      const rs = zzt - THERMAL_VOLTS / izt;
      const bv = vz - izt * rs;
      const model = p.model(
        `dz_${key.toLowerCase()}`,
        `d(is=1n n=1 rs=${rs} bv=${bv} ibv=${izt} nbv=1)`,
      );
      p.add(`${p.el('d')} ${p.node('A')} ${p.node('C')} ${model}`);
    },
  },

  'spice-inductor': {
    pins: ['1', '2'],
    build(p) {
      p.add(
        `${p.el('l')} ${p.node('1')} ${p.node('2')} ${p.num('value', '1m')}`,
      );
    },
  },

  'spice-sine-source': {
    pins: ['+', '-'],
    build(p) {
      const inner = p.inner('src');
      const offset = p.num('offset', '0');
      const amplitude = p.num('amplitude', '1');
      const freq = p.num('frequency', '1k');
      p.add(
        `${p.el('v')} ${inner} ${p.node('-')} ` +
          `sin(${offset} ${amplitude} ${freq})`,
      );
      p.add(`${p.el('r')} ${inner} ${p.node('+')} 0.01`);
    },
  },

  'spice-opamp': {
    pins: ['IN+', 'IN-', 'OUT', 'V+', 'V-'],
    build(p) {
      const {gain, gbw, slew, high, low} = lookup(
        OPAMPS,
        p.attr('model', 'LM358'),
        p.id,
      );
      const [inp, inn, vp, vn] = ['IN+', 'IN-', 'V+', 'V-'].map(p.node);
      const x = p.inner('x');
      const out = p.inner('out');
      // A current into a capacitor sets the gain-bandwidth, and its limit
      // sets the slew rate. A large cap keeps r far below the 1 Gohm
      // rshunt, which would lower the gain.
      const cap = 1e-6;
      const gm = 2 * Math.PI * gbw * cap;
      const imax = slew * cap;
      /** @param {number} n */
      const f = (n) => n.toPrecision(4);
      p.add(
        `${p.el('b', 'in')} 0 ${x} i = ${f(imax)} * ` +
          `tanh(${f(gm)} * (v(${inp}) - v(${inn})) / ${f(imax)})`,
      );
      p.add(`${p.el('r')} ${x} 0 ${f(gain / gm)}`);
      p.add(`${p.el('c')} ${x} 0 ${cap}`);
      // 1 kS pulls x back inside the output range, so it leaves a rail at
      // once.
      p.add(
        `${p.el('b', 'clamp')} ${x} 0 i = 1000 * (` +
          `max(v(${x}) - v(${vp}) + ${high}, 0) - ` +
          `max(v(${vn}) + ${low} - v(${x}), 0))`,
      );
      p.add(`${p.el('e')} ${out} 0 ${x} 0 1`);
      p.add(`${p.el('r', 'out')} ${out} ${p.node('OUT')} 10`);
    },
  },

  'board-esp32-devkit-c-v4': board({
    gpio: [
      '0',
      '2',
      '4',
      '5',
      '12',
      '13',
      '14',
      '15',
      '16',
      '17',
      '18',
      '19',
      '21',
      '22',
      '23',
      '25',
      '26',
      '27',
      '32',
      '33',
      '34',
      '35',
      'TX',
      'RX',
      'VP',
      'VN',
    ],
    ground: ['GND.1', 'GND.2', 'GND.3'],
    v3: '3V3',
    v5: '5V',
    other: ['EN', 'CMD', 'CLK', 'D0', 'D1', 'D2', 'D3'],
  }),

  'wokwi-esp32-devkit-v1': board({
    gpio: [
      'D2',
      'D4',
      'D5',
      'D12',
      'D13',
      'D14',
      'D15',
      'D18',
      'D19',
      'D21',
      'D22',
      'D23',
      'D25',
      'D26',
      'D27',
      'D32',
      'D33',
      'D34',
      'D35',
      'TX0',
      'RX0',
      'TX2',
      'RX2',
      'VP',
      'VN',
    ],
    ground: ['GND.1', 'GND.2'],
    v3: '3V3',
    v5: 'VIN',
    other: ['EN'],
  }),
};
