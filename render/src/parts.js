/**
 * @fileoverview Drawings for parts that wokwi-elements does not have.
 *
 * The sim core supports these types, so the renderer must draw them. Each
 * element has pinInfo and updateComplete, like a wokwi element, so the
 * renderer can treat all parts the same.
 */

const STROKE = 'stroke="#333" stroke-width="2" fill="none"';

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
      <path d="M14 2L26 10L14 18Z" fill="#333"/>`,
    label: {x: 20, y: 29, attr: 'model', fallback: '1N4148'},
  },
  'spice-npn': {
    width: 44,
    height: 50,
    pins: [['C', 30, 0], ['B', 0, 25], ['E', 30, 50]],
    svg: `
      <circle cx="22" cy="25" r="16" ${STROKE}/>
      <path d="M0 25H16M16 15V35M16 20L30 11V0M16 30L30 39V50" ${STROKE}/>
      <path d="M30 39L21 37L25 31Z" fill="#333"/>`,
    label: {x: 34, y: 50, attr: 'model', fallback: '2N2222', anchor: 'start'},
  },
};

// One sheet for all instances, so each element does not parse its own CSS.
const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { display: inline-block; }
  svg { display: block; overflow: visible; }
  text { font: 9px sans-serif; fill: #333; }
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
