/**
 * @fileoverview Drawings for parts that wokwi-elements does not have.
 *
 * The sim core supports these types, so the renderer must draw them. Each
 * element has pinInfo and updateComplete, like a wokwi element, so the
 * renderer can treat all parts the same.
 */

const STROKE = 'stroke="#333" stroke-width="2" fill="none"';

const PARTS = {
  'wokwi-gnd': {
    width: 24,
    height: 24,
    pins: [['GND', 12, 0]],
    draw: () => `
      <path d="M12 0V12M2 12H22M6 17H18M10 22H14" ${STROKE}/>`,
  },
  'wokwi-vcc': {
    width: 32,
    height: 32,
    pins: [['VCC', 16, 32]],
    draw: (el) => `
      <path d="M16 32V18M6 18H26" ${STROKE}/>
      ${label(16, 12, `${el.getAttribute('voltage') ?? '3.3'}V`)}`,
  },
  'spice-capacitor': {
    width: 40,
    height: 30,
    pins: [['1', 0, 10], ['2', 40, 10]],
    draw: (el) => `
      <path d="M0 10H17M23 10H40M17 1V19M23 1V19" ${STROKE}/>
      ${label(20, 29, el.getAttribute('value') ?? '1u')}`,
  },
  'spice-diode': {
    width: 40,
    height: 30,
    pins: [['A', 0, 10], ['C', 40, 10]],
    draw: (el) => `
      <path d="M0 10H40M26 2V18" ${STROKE}/>
      <path d="M14 2L26 10L14 18Z" fill="#333"/>
      ${label(20, 29, el.getAttribute('model') ?? '1N4148')}`,
  },
  'spice-npn': {
    width: 44,
    height: 50,
    pins: [['C', 30, 0], ['B', 0, 25], ['E', 30, 50]],
    draw: (el) => `
      <circle cx="22" cy="25" r="16" ${STROKE}/>
      <path d="M0 25H16M16 15V35M16 20L30 11V0M16 30L30 39V50" ${STROKE}/>
      <path d="M30 39L21 37L25 31Z" fill="#333"/>
      ${label(34, 50, el.getAttribute('model') ?? '2N2222', 'start')}`,
  },
};

function label(x, y, text, anchor = 'middle') {
  const safe = String(text).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
  return `<text x="${x}" y="${y}" text-anchor="${anchor}"
    font-family="sans-serif" font-size="9" fill="#333">${safe}</text>`;
}

for (const [tag, {width, height, pins, draw}] of Object.entries(PARTS)) {
  // A later wokwi-elements version may define some of these.
  if (customElements.get(tag)) continue;
  customElements.define(tag, class extends HTMLElement {
    static observedAttributes = ['value', 'model', 'voltage'];
    updateComplete = Promise.resolve(true);
    pinInfo = pins.map(([name, x, y]) => ({name, x, y, signals: []}));

    connectedCallback() {
      this.render();
    }

    attributeChangedCallback() {
      this.render();
    }

    render() {
      const root = this.shadowRoot ?? this.attachShadow({mode: 'open'});
      root.innerHTML = `
        <style>
          :host { display: inline-block; }
          svg { display: block; overflow: visible; }
        </style>
        <svg width="${width}" height="${height}"
            viewBox="0 0 ${width} ${height}">${draw(this)}</svg>`;
    }
  });
}
