/**
 * @file A part plugin: a slide fader with an audio (log) taper. See "Part
 * plugins" in docs/circuit-format.md.
 */

// With this base, the wiper is at 10% of the track at mid travel.
const BASE = 81;
// As a closed switch in esp-spice, so the ends never have 0 ohms.
const MIN_OHMS = 0.05;
const STROKE = 'stroke="currentColor" stroke-width="2" fill="none"';

export default {
  'audio-fader': {
    pins: ['A', 'WIPER', 'B'],
    build(p) {
      const ohms = p.num('resistance', '10k');
      p.unit(p.id, {value: p.num('value', '0')}, ({value}) => {
        const x = Math.min(1, Math.max(0, value / 1023));
        const low = (ohms * (BASE ** x - 1)) / (BASE - 1);
        return [
          p.resistor(
            p.el('r', 'a'),
            p.node('A'),
            p.node('WIPER'),
            Math.max(MIN_OHMS, low),
          ),
          p.resistor(
            p.el('r', 'b'),
            p.node('WIPER'),
            p.node('B'),
            Math.max(MIN_OHMS, ohms - low),
          ),
        ];
      });
    },
    state: (r) => ({value: r.control('value')}),
    drawing: {
      width: 40,
      height: 120,
      pins: [
        ['B', 20, 0],
        ['WIPER', 40, 60],
        ['A', 20, 120],
      ],
      svg: `
        <path d="M20 0V120M29 60H40" ${STROKE}/>
        <rect x="11" y="54" width="18" height="12" rx="2" ${STROKE}/>`,
      label: {x: 0, y: 100, attr: 'resistance', fallback: '10k', anchor: 'end'},
    },
  },
};
