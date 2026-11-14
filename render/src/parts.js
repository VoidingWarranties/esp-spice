/**
 * @fileoverview Drawings for parts that wokwi-elements does not have.
 *
 * The sim core supports these types, so the renderer must draw them. Each
 * element has pinInfo and updateComplete, like a wokwi element, so the
 * renderer can treat all parts the same.
 */

// currentColor, so the drawings follow the page text color, also in dark
// mode.
const STROKE = 'stroke="currentColor" stroke-width="2" fill="none"';

/**
 * Each part has static SVG markup and an optional text label. The label
 * shows an attribute value, such as the capacitor value.
 */
const PARTS = {
  'wokwi-gnd': {
    width: 24,
    height: 24,
    pins: [['GND', 12, 0]],
    svg: `<path d="M12 0V12M2 12H22M6 17H18M10 22H14" ${STROKE}/>`,
  },
  'wokwi-vcc': {
    width: 32,
    height: 32,
    pins: [['VCC', 16, 32]],
    svg: `<path d="M16 32V18M6 18H26" ${STROKE}/>`,
    label: {x: 16, y: 12, attr: 'voltage', fallback: '3.3', suffix: 'V'},
  },
  'spice-capacitor': {
    width: 40,
    height: 30,
    pins: [['1', 0, 10], ['2', 40, 10]],
    svg: `<path d="M0 10H17M23 10H40M17 1V19M23 1V19" ${STROKE}/>`,
    label: {x: 20, y: 29, attr: 'value', fallback: '1u'},
  },
  'spice-diode': {
    width: 40,
    height: 30,
    pins: [['A', 0, 10], ['C', 40, 10]],
    svg: `
      <path d="M0 10H40M26 2V18" ${STROKE}/>
      <path d="M14 2L26 10L14 18Z" fill="currentColor"/>`,
    label: {x: 20, y: 29, attr: 'model', fallback: '1N4148'},
  },
  'spice-npn': {
    width: 44,
    height: 50,
    pins: [['C', 30, 0], ['B', 0, 25], ['E', 30, 50]],
    svg: `
      <circle cx="22" cy="25" r="16" ${STROKE}/>
      <path d="M0 25H16M16 15V35M16 20L30 11V0M16 30L30 39V50" ${STROKE}/>
      <path d="M30 39L21 37L25 31Z" fill="currentColor"/>`,
    label: {x: 34, y: 50, attr: 'model', fallback: '2N2222', anchor: 'start'},
  },
  'spice-pnp': {
    width: 44,
    height: 50,
    pins: [['E', 30, 0], ['B', 0, 25], ['C', 30, 50]],
    svg: `
      <circle cx="22" cy="25" r="16" ${STROKE}/>
      <path d="M0 25H16M16 15V35M16 20L30 11V0M16 30L30 39V50" ${STROKE}/>
      <path d="M17 19L26 17L22 11Z" fill="currentColor"/>`,
    label: {x: 34, y: 50, attr: 'model', fallback: '2N3906', anchor: 'start'},
  },
  'spice-nmos': {
    width: 44,
    height: 50,
    pins: [['D', 30, 0], ['G', 0, 25], ['S', 30, 50]],
    svg: `
      <path d="M0 25H12M12 14V36M17 12V19M17 21.5V28.5M17 31V38
          M17 15.5H30V0M17 34.5H30V50M17 25H30V34.5" ${STROKE}/>
      <path d="M18 25L25 21.5V28.5Z" fill="currentColor"/>`,
    label: {x: 34, y: 50, attr: 'model', fallback: '2N7000', anchor: 'start'},
  },
  'spice-pmos': {
    width: 44,
    height: 50,
    pins: [['S', 30, 0], ['G', 0, 25], ['D', 30, 50]],
    svg: `
      <path d="M0 25H12M12 14V36M17 12V19M17 21.5V28.5M17 31V38
          M17 15.5H30V0M17 34.5H30V50M17 25H30V15.5" ${STROKE}/>
      <path d="M28 25L21 21.5V28.5Z" fill="currentColor"/>`,
    label: {x: 34, y: 50, attr: 'model', fallback: 'BS250', anchor: 'start'},
  },
  'spice-zener': {
    width: 40,
    height: 30,
    pins: [['A', 0, 10], ['C', 40, 10]],
    svg: `
      <path d="M0 10H40M22 0L26 2V18L30 20" ${STROKE}/>
      <path d="M14 2L26 10L14 18Z" fill="currentColor"/>`,
    label: {x: 20, y: 29, attr: 'model', fallback: '1N4733A'},
  },
  'spice-inductor': {
    width: 48,
    height: 30,
    pins: [['1', 0, 10], ['2', 48, 10]],
    svg: `<path d="M0 10H8a4 4 0 0 1 8 0a4 4 0 0 1 8 0a4 4 0 0 1 8 0
        a4 4 0 0 1 8 0H48" ${STROKE}/>`,
    label: {x: 24, y: 26, attr: 'value', fallback: '1m'},
  },
  'spice-sine-source': {
    width: 40,
    height: 60,
    pins: [['+', 20, 0], ['-', 20, 60]],
    svg: `
      <circle cx="20" cy="30" r="14" ${STROKE}/>
      <path d="M20 0V16M20 44V60M12 30C15 21 17 21 20 30S25 39 28 30
          M27 7H33M30 4V10" ${STROKE}/>`,
    label: {x: 36, y: 34, attr: 'frequency', fallback: '1k', anchor: 'start'},
  },
  'spice-opamp': {
    width: 60,
    height: 60,
    pins: [
      ['IN-', 0, 20],
      ['IN+', 0, 40],
      ['OUT', 60, 30],
      ['V+', 30, 0],
      ['V-', 30, 60],
    ],
    svg: `
      <path d="M8 5L52 30L8 55Z M0 20H8M0 40H8M52 30H60M30 0V17.5M30 60V42.5
          M12 20H18M12 40H18M15 37V43" ${STROKE}/>`,
    label: {x: 27, y: 33, attr: 'model', fallback: 'LM358'},
  },
};

// One sheet for all instances, so each element does not parse its own CSS.
const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { display: inline-block; }
  svg { display: block; overflow: visible; }
  text { font: 9px sans-serif; fill: currentColor; }
`);

for (const [tag, {width, height, pins, svg, label}] of Object.entries(PARTS)) {
  // A later wokwi-elements version may define some of these.
  if (customElements.get(tag)) continue;

  // Parse the markup once, then clone it for each element.
  const template = document.createElement('template');
  template.innerHTML = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      ${svg}
      ${label ? `<text x="${label.x}" y="${label.y}"
          text-anchor="${label.anchor ?? 'middle'}"></text>` : ''}
    </svg>`;

  customElements.define(tag, class extends HTMLElement {
    static observedAttributes = label ? [label.attr] : [];
    updateComplete = Promise.resolve(true);
    pinInfo = pins.map(([name, x, y]) => ({name, x, y, signals: []}));

    #text;

    constructor() {
      super();
      this.attachShadow({mode: 'open'});
      this.shadowRoot.adoptedStyleSheets = [sheet];
      this.shadowRoot.append(template.content.cloneNode(true));
      this.#text = this.shadowRoot.querySelector('text');
    }

    connectedCallback() {
      this.render();
    }

    attributeChangedCallback() {
      this.render();
    }

    render() {
      if (!label) return;
      const value = this.getAttribute(label.attr) ?? label.fallback;
      // textContent, so attribute values cannot add markup.
      this.#text.textContent = value + (label.suffix ?? '');
    }
  });
}
