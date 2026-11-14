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
// Pixels per mm, at the 96 dpi that diagrams use.
const MM = 96 / 25.4;
// Header pin pitch.
const PITCH = 2.54;
// Header pin pitch in the espboards.dev drawings, in their SVG units.
const ART_PITCH = 25.986;

/**
 * Returns a devkit board with two pin headers, drawn with a board
 * illustration from espboards.dev (CC BY-NC 4.0).
 *
 * Sizes and pin positions are in mm and come from the board.json files in
 * github.com/wokwi/wokwi-boards, so that diagrams made in Wokwi keep their
 * wires.
 *
 * @param {{width: number, height: number, left: !Array, right: !Array,
 *     art: {file: string, width: number, height: number,
 *     center: !Array<number>}}} spec Each header is [x, y, ...names], with
 *     y of the first pin. art gives the SVG size and the center of its pin
 *     grid, in SVG units.
 * @return {!Object} A PARTS entry.
 */
function board({width, height, left, right, art}) {
  const px = (mm) => +(mm * MM).toFixed(2);
  const pins = [];
  for (const [x, y, ...names] of [left, right]) {
    names.forEach((name, i) => pins.push([name, px(x), px(y + i * PITCH)]));
  }
  // The drawings have the USB port at the top. Turn them 180 degrees, so
  // that they match Wokwi, and put their pin grid on Wokwi's pin grid.
  const xs = pins.map(([, x]) => x);
  const ys = pins.map(([, , y]) => y);
  const gx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const gy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const k = (PITCH * MM) / ART_PITCH;
  const round = (n) => +n.toFixed(2);
  const [w, h] = [round(art.width * k), round(art.height * k)];
  const x = round(gx - w + art.center[0] * k);
  const y = round(gy - h + art.center[1] * k);
  const href = new URL(`boards/${art.file}`, import.meta.url).href;
  return {
    // Whole pixels, because the renderer reads the size with offsetWidth and
    // rotates around the center.
    width: Math.round(width * MM),
    height: Math.round(height * MM),
    pins,
    svg: `<image href="${href}" x="${x}" y="${y}" width="${w}" height="${h}"
        transform="rotate(180 ${x + w / 2} ${y + h / 2})"/>`,
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
  'board-esp32-devkit-c-v4': board({
    art: {file: 'esp32-devkitc.svg', width: 310, height: 589.649,
      center: [154.935, 268.82]},
    width: 27.9,
    height: 56.628,
    left: [1.22, 7.62, '3V3', 'EN', 'VP', 'VN', '34', '35', '32', '33', '25',
      '26', '27', '14', '12', 'GND.1', '13', 'D2', 'D3', 'CMD', '5V'],
    right: [26.66, 7.62, 'GND.2', '23', '22', 'TX', 'RX', '21', 'GND.3', '19',
      '18', '5', '17', '16', '4', '0', '2', '15', 'D1', 'D0', 'CLK'],
  }),
  'board-esp32-s3-devkitc-1': board({
    art: {file: 'esp32-s3-devkitc-1.svg', width: 284, height: 758.854,
      center: [141.94, 394.37]},
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
    art: {file: 'esp32-c3-devkitm-1.svg', width: 284, height: 481.964,
      center: [141.94, 219.96]},
    width: 25.4,
    height: 42.91,
    left: [1, 5.16, 'GND.1', '3V3.1', '3V3.2', '2', '3', 'GND.2', 'RST',
      'GND.3', '0', '1', '10', 'GND.4', '5V.1', '5V.2', 'GND.5'],
    right: [24.2, 5.16, 'GND.10', 'TX', 'RX', 'GND.9', '9', '8', 'GND.8', '7',
      '6', '5', '4', 'GND.7', '18', '19', 'GND.6'],
  }),
  'board-esp32-c6-devkitc-1': board({
    art: {file: 'esp32-c6-devkitc-1.svg', width: 284, height: 620.259,
      center: [141.94, 336.345]},
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
      // Board drawings load from a file. Wait for them before a capture.
      const image = this.shadowRoot.querySelector('image');
      if (image) {
        this.updateComplete = new Promise((resolve) => {
          image.onload = () => resolve(true);
          image.onerror = () => {
            console.warn(`Cannot load ${image.getAttribute('href')}`);
            resolve(false);
          };
        });
      }
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

// wokwi-led-bar-graph draws a segment fully lit for any value above 0. The
// sim gives a brightness, so mix each dim segment toward its off color, as
// wokwi-led dims its glow. The segment selector matches the markup of
// @wokwi/elements 1.9.2; the capture test checks it.
customElements.whenDefined('wokwi-led-bar-graph').then((BarGraph) => {
  const updated = BarGraph.prototype.updated;
  BarGraph.prototype.updated = function(changed) {
    updated?.call(this, changed);
    const segments = this.shadowRoot.querySelectorAll('rect[height="1.74"]');
    segments.forEach((rect, i) => {
      const value = Number(this.values[i]);
      const percent = Math.round((0.3 + 0.7 * value) * 100);
      rect.style.fill = value > 0 && value < 1 ?
        `color-mix(in srgb, ${rect.getAttribute('fill')} ${percent}%, ` +
          `${this.offColor})` :
        '';
    });
  };
});
