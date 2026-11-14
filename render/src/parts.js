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
const THIN = 'stroke="currentColor" stroke-width="1" fill="none"';

// Pixels per mm, at the 96 dpi that diagrams use.
const MM = 96 / 25.4;
// Header pin pitch.
const PITCH = 2.54;

/**
 * Returns a simple drawing of a devkit board with two pin headers.
 *
 * Sizes and pin positions are in mm and match Wokwi's boards, so that
 * diagrams made in Wokwi keep their wires. The drawing is our own.
 *
 * @param {{chip: string, width: number, height: number,
 *     left: !Array, right: !Array}} spec Each header is [x, y, ...names],
 *     with y of the first pin.
 * @return {!Object} A PARTS entry.
 */
function board({chip, width, height, left, right}) {
  const px = (mm) => +(mm * MM).toFixed(2);
  const w = px(width);
  const h = px(height);
  const pins = [];
  let pads = '';
  for (const [[x, y, ...names], anchor, dx] of
      [[left, 'start', 6], [right, 'end', -6]]) {
    names.forEach((name, i) => {
      const [cx, cy] = [px(x), px(y + i * PITCH)];
      pins.push([name, cx, cy]);
      pads += `<circle cx="${cx}" cy="${cy}" r="3"/>
        <text class="pin" x="${cx + dx}" y="${cy + 2}"
            text-anchor="${anchor}">${name}</text>`;
    });
  }
  // The module sits between the two columns of pin names, with a meander
  // antenna at its top. The chip name runs down the board below it.
  const mx = 36;
  const mw = w - 2 * mx;
  const mh = +(h * 0.3).toFixed(2);
  const antenna = 'v-8h3v8h3'.repeat(Math.floor((mw - 8) / 6));
  return {
    width: w,
    height: h,
    pins,
    svg: `
      <rect x="1" y="1" width="${w - 2}" height="${h - 2}" rx="4"
          stroke="currentColor" fill="currentColor" fill-opacity="0.08"/>
      <rect x="${mx}" y="4" width="${mw}" height="${mh}" ${STROKE}/>
      <path d="M${mx + 4} 16${antenna}" ${THIN}/>
      <text transform="translate(${w / 2 - 3} ${mh + 12}) rotate(90)"
          >${chip}</text>
      <rect x="${w / 2 - 15}" y="${h - 12}" width="30" height="12" ${STROKE}/>
      <g ${THIN}>${pads}</g>`,
  };
}

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
  'board-esp32-devkit-c-v4': board({
    chip: 'ESP32',
    width: 27.9,
    height: 56.628,
    left: [1.22, 7.62, '3V3', 'EN', 'VP', 'VN', '34', '35', '32', '33', '25',
      '26', '27', '14', '12', 'GND.1', '13', 'D2', 'D3', 'CMD', '5V'],
    right: [26.66, 7.62, 'GND.2', '23', '22', 'TX', 'RX', '21', 'GND.3', '19',
      '18', '5', '17', '16', '4', '0', '2', '15', 'D1', 'D0', 'CLK'],
  }),
  'board-esp32-s3-devkitc-1': board({
    chip: 'ESP32-S3',
    width: 25.527,
    height: 70.057,
    left: [1.343, 7.667, '3V3.1', '3V3.2', 'RST', '4', '5', '6', '7', '15',
      '16', '17', '18', '8', '3', '46', '9', '10', '11', '12', '13', '14', '5V',
      'GND.1'],
    right: [24.19, 7.667, 'GND.2', 'TX', 'RX', '1', '2', '42', '41', '40', '39',
      '38', '37', '36', '35', '0', '45', '48', '47', '21', '20', '19', 'GND.3',
      'GND.4'],
  }),
  'board-esp32-c3-devkitm-1': board({
    chip: 'ESP32-C3',
    width: 25.4,
    height: 42.91,
    left: [1, 5.16, 'GND.1', '3V3.1', '3V3.2', '2', '3', 'GND.2', 'RST',
      'GND.3', '0', '1', '10', 'GND.4', '5V.1', '5V.2', 'GND.5'],
    right: [24.2, 5.16, 'GND.10', 'TX', 'RX', 'GND.9', '9', '8', 'GND.8', '7',
      '6', '5', '4', 'GND.7', '18', '19', 'GND.6'],
  }),
  'board-esp32-c6-devkitc-1': board({
    chip: 'ESP32-C6',
    width: 26.214,
    height: 57.74,
    left: [1.45, 8.76, '3V3', 'RST', '4', '5', '6', '7', '0', '1', '8', '10',
      '11', '2', '3', '5V', 'GND.1', 'NC0'],
    right: [24.6, 8.76, 'GND.4', 'TX', 'RX', '15', '23', '22', '21', '20', '19',
      '18', '9', 'GND.3', '13', '12', 'GND.2', 'NC1'],
  }),
};

// One sheet for all instances, so each element does not parse its own CSS.
const sheet = new CSSStyleSheet();
sheet.replaceSync(`
  :host { display: inline-block; }
  svg { display: block; overflow: visible; }
  text { font: 9px sans-serif; fill: currentColor; }
  .pin { font-size: 6px; stroke: none; }
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
