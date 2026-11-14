/**
 * @fileoverview Converts a Wokwi diagram.json into an ngspice netlist.
 *
 * Temporary: the circuit core (circuit/netlist.js) will replace this.
 */

/** Pins that are connected inside a part. */
const INTERNAL_LINKS = {
  'wokwi-pushbutton': [['1.l', '1.r'], ['2.l', '2.r']],
  'wokwi-esp32-devkit-v1': [['GND.1', 'GND.2']],
};

/** Pins that are the ground node. */
const GROUND_PINS = {
  'wokwi-esp32-devkit-v1': ['GND.1', 'GND.2'],
};

/** Saturation currents that give a typical forward voltage per LED color. */
const LED_IS = {
  red: '93.2p',
  yellow: '10p',
  green: '3.4p',
  blue: '0.34f',
  white: '0.34f',
};

const POT_OHMS = 10000;

/**
 * Makes a netlist for an operating-point (.op) solve.
 *
 * @param {!Object} diagram A parsed diagram.json.
 * @param {!Object<string, number|boolean>} inputs Control values by part id:
 *     pot position from 0 to 1, or true when a button is pressed.
 * @return {string} The netlist.
 */
export function toNetlist(diagram, inputs) {
  const node = netNamer(diagram);
  const lines = [`* ${diagram.author ?? 'diagram'}`];
  const colors = new Set();
  for (const {type, id, attrs = {}} of diagram.parts) {
    const n = (pin) => node(`${id}:${pin}`);
    switch (type) {
      case 'wokwi-esp32-devkit-v1':
        lines.push(`V_${id} ${n('3V3')} 0 3.3`);
        break;
      case 'wokwi-resistor':
        lines.push(`R_${id} ${n('1')} ${n('2')} ${attrs.value ?? '1k'}`);
        break;
      case 'wokwi-led': {
        // A 0 V source in series measures the LED current.
        const color = (attrs.color ?? 'red').toLowerCase();
        colors.add(color);
        lines.push(`D_${id} ${n('A')} ${id}_k LED_${color}`);
        lines.push(`V_${id} ${id}_k ${n('C')} 0`);
        break;
      }
      case 'wokwi-potentiometer': {
        // The +1 ohm keeps the solve away from a zero-ohm resistor.
        const p = inputs[id] ?? 0.5;
        lines.push(`R_${id}_top ${n('VCC')} ${n('SIG')} ${(1 - p) * POT_OHMS + 1}`);
        lines.push(`R_${id}_bot ${n('SIG')} ${n('GND')} ${p * POT_OHMS + 1}`);
        break;
      }
      case 'wokwi-pushbutton':
        lines.push(`R_${id} ${n('1.l')} ${n('2.l')} ${inputs[id] ? '10m' : '1G'}`);
        break;
    }
  }
  for (const color of colors) {
    lines.push(`.model LED_${color} D(IS=${LED_IS[color] ?? LED_IS.red} ` +
        'RS=42m N=3.73 BV=4 IBV=10u)');
  }
  lines.push('.op', '.end');
  return lines.join('\n');
}

/**
 * Groups connected pins into nets.
 *
 * @param {!Object} diagram A parsed diagram.json.
 * @return {function(string): string} Gives the node name for a 'part:pin'.
 */
function netNamer(diagram) {
  const parent = new Map();
  const find = (pin) => {
    while (parent.has(pin)) pin = parent.get(pin);
    return pin;
  };
  const join = (a, b) => {
    a = find(a);
    b = find(b);
    if (a !== b) parent.set(b, a);
  };
  for (const [a, b] of diagram.connections) join(a, b);
  const grounds = new Set();
  for (const {type, id} of diagram.parts) {
    for (const [a, b] of INTERNAL_LINKS[type] ?? []) join(`${id}:${a}`, `${id}:${b}`);
    for (const pin of GROUND_PINS[type] ?? []) grounds.add(`${id}:${pin}`);
  }
  const groundRoots = new Set([...grounds].map(find));
  return (pin) => {
    const root = find(pin);
    if (groundRoots.has(root)) return '0';
    return root.replace(/[^A-Za-z0-9]/g, '_').toLowerCase();
  };
}
