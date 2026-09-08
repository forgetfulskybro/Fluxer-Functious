function normalizeColor(input) {
  const value = input.trim().toLowerCase();
  const hexMatch = value.match(
    /^#?([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/,
  );
  if (hexMatch) return expandHex(value.startsWith("#") ? value : `#${value}`);

  const named = NAMED_COLORS[value];
  if (named) return expandHex(named);

  const rgbMatch = value.match(
    /^(?:rgba?|hsl|hsla|hsv|hsva)\(\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*[, ]\s*([\d.]+%?)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/,
  );
  if (rgbMatch) {
    const fn = value.split("(")[0];
    const [, a, b, c, alpha] = rgbMatch;

    if (fn.startsWith("rgb")) {
      return rgbToHex(
        numOrPercentRGB(a),
        numOrPercentRGB(b),
        numOrPercentRGB(c),
        alphaValue(alpha),
      );
    }

    if (fn.startsWith("hsv")) {
      return rgbToHex(
        ...hsvToRgb(
          Number(a) % 360,
          numOrPercentHSL(b),
          numOrPercentHSL(c),
        ),
        alphaValue(alpha),
      );
    }

    return rgbToHex(
      ...hslToRgb(
        Number(a) % 360,
        numOrPercentHSL(b),
        numOrPercentHSL(c),
      ),
      alphaValue(alpha),
    );
  }

  return null;
}

function numOrPercentRGB(value) {
  if (value.endsWith("%")) return (Number(value.slice(0, -1)) / 100) * 255;
  return Number(value);
}

function numOrPercentHSL(value) {
  if (value.endsWith("%")) return Number(value.slice(0, -1));
  return Number(value);
}

function alphaValue(value) {
  if (!value) return 1;
  if (value.endsWith("%")) return Number(value.slice(0, -1)) / 100;
  return Number(value);
}

function expandHex(value) {
  const raw = value.replace(/^#/, "");
  let full;
  if (raw.length === 3 || raw.length === 4) {
    full = raw
      .split("")
      .map((c) => c + c)
      .join("");
  } else {
    full = raw;
  }
  if (full.length === 8 && full.endsWith("ff")) {
    return `#${full.slice(0, 6)}`;
  }
  return `#${full}`;
}

function channel(n) {
  return Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, "0");
}

function rgbToHex(r, g, b, a = 1) {
  const hex = `#${channel(r)}${channel(g)}${channel(b)}`;
  if (a >= 1) return hex;
  return `${hex}${channel(a * 255)}`;
}

function hueToRgb(p, q, t) {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

function hslToRgb(h, s, l) {
  const sn = s / 100;
  const ln = l / 100;
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  return [
    hueToRgb(p, q, h / 360 + 1 / 3) * 255,
    hueToRgb(p, q, h / 360) * 255,
    hueToRgb(p, q, h / 360 - 1 / 3) * 255,
  ];
}

function hsvToRgb(h, s, v) {
  const sn = s / 100;
  const vn = v / 100;
  const c = vn * sn;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let rgb;
  if (hp < 1) rgb = [c, x, 0];
  else if (hp < 2) rgb = [x, c, 0];
  else if (hp < 3) rgb = [0, c, x];
  else if (hp < 4) rgb = [0, x, c];
  else if (hp < 5) rgb = [x, 0, c];
  else rgb = [c, 0, x];
  const m = vn - c;
  return [(rgb[0] + m) * 255, (rgb[1] + m) * 255, (rgb[2] + m) * 255];
}

function hexToArgb(hex) {
  let raw = String(hex).trim().replace(/^#/, "").toLowerCase();

  if (raw.length === 3 || raw.length === 4) {
    raw = raw.split("").map((c) => c + c).join("");
  }

  if (raw.length === 8) {
    raw = raw.slice(0, 6);
  }

  if (raw.length !== 6 || /[^0-9a-f]/.test(raw)) {
    throw new Error(`Invalid hex color: ${hex}`);
  }

  return parseInt(raw, 16) & 0xffffff;
}

const NAMED_COLORS = {
  aliceblue: "#f0f8ff",
  antiquewhite: "#faebd7",
  aqua: "#00ffff",
  aquamarine: "#7fffd4",
  azure: "#f0ffff",
  beige: "#f5f5dc",
  bisque: "#ffe4c4",
  black: "#000000",
  blanchedalmond: "#ffebcd",
  blue: "#0000ff",
  blueviolet: "#8a2be2",
  brown: "#a52a2a",
  burlywood: "#deb887",
  cadetblue: "#5f9ea0",
  chartreuse: "#7fff00",
  chocolate: "#d2691e",
  coral: "#ff7f50",
  cornflowerblue: "#6495ed",
  cornsilk: "#fff8dc",
  crimson: "#dc143c",
  cyan: "#00ffff",
  darkblue: "#00008b",
  darkcyan: "#008b8b",
  darkgoldenrod: "#b8860b",
  darkgray: "#a9a9a9",
  darkgreen: "#006400",
  darkgrey: "#a9a9a9",
  darkkhaki: "#bdb76b",
  darkmagenta: "#8b008b",
  darkolivegreen: "#556b2f",
  darkorange: "#ff8c00",
  darkorchid: "#9932cc",
  darkred: "#8b0000",
  darksalmon: "#e9967a",
  darkseagreen: "#8fbc8f",
  darkslateblue: "#483d8b",
  darkslategray: "#2f4f4f",
  darkslategrey: "#2f4f4f",
  darkturquoise: "#00ced1",
  darkviolet: "#9400d3",
  deeppink: "#ff1493",
  deepskyblue: "#00bfff",
  dimgray: "#696969",
  dimgrey: "#696969",
  dodgerblue: "#1e90ff",
  firebrick: "#b22222",
  floralwhite: "#fffaf0",
  forestgreen: "#228b22",
  fuchsia: "#ff00ff",
  gainsboro: "#dcdcdc",
  ghostwhite: "#f8f8ff",
  gold: "#ffd700",
  goldenrod: "#daa520",
  gray: "#808080",
  green: "#008000",
  greenyellow: "#adff2f",
  grey: "#808080",
  honeydew: "#f0fff0",
  hotpink: "#ff69b4",
  indianred: "#cd5c5c",
  indigo: "#4b0082",
  ivory: "#fffff0",
  khaki: "#f0e68c",
  lavender: "#e6e6fa",
  lavenderblush: "#fff0f5",
  lawngreen: "#7cfc00",
  lemonchiffon: "#fffacd",
  lightblue: "#add8e6",
  lightcoral: "#f08080",
  lightcyan: "#e0ffff",
  lightgoldenrodyellow: "#fafad2",
  lightgray: "#d3d3d3",
  lightgreen: "#90ee90",
  lightgrey: "#d3d3d3",
  lightpink: "#ffb6c1",
  lightsalmon: "#ffa07a",
  lightseagreen: "#20b2aa",
  lightskyblue: "#87cefa",
  lightslategray: "#778899",
  lightslategrey: "#778899",
  lightsteelblue: "#b0c4de",
  lightyellow: "#ffffe0",
  lime: "#00ff00",
  limegreen: "#32cd32",
  linen: "#faf0e6",
  magenta: "#ff00ff",
  maroon: "#800000",
  mediumaquamarine: "#66cdaa",
  mediumblue: "#0000cd",
  mediumorchid: "#ba55d3",
  mediumpurple: "#9370db",
  mediumseagreen: "#3cb371",
  mediumslateblue: "#7b68ee",
  mediumspringgreen: "#00fa9a",
  mediumturquoise: "#48d1cc",
  mediumvioletred: "#c71585",
  midnightblue: "#191970",
  mintcream: "#f5fffa",
  mistyrose: "#ffe4e1",
  moccasin: "#ffe4b5",
  navajowhite: "#ffdead",
  navy: "#000080",
  oldlace: "#fdf5e6",
  olive: "#808000",
  olivedrab: "#6b8e23",
  orange: "#ffa500",
  orangered: "#ff4500",
  orchid: "#da70d6",
  palegoldenrod: "#eee8aa",
  palegreen: "#98fb98",
  paleturquoise: "#afeeee",
  palevioletred: "#db7093",
  papayawhip: "#ffefd5",
  peachpuff: "#ffdab9",
  peru: "#cd853f",
  pink: "#ffc0cb",
  plum: "#dda0dd",
  powderblue: "#b0e0e6",
  purple: "#800080",
  rebeccapurple: "#663399",
  red: "#ff0000",
  rosybrown: "#bc8f8f",
  royalblue: "#4169e1",
  saddlebrown: "#8b4513",
  salmon: "#fa8072",
  sandybrown: "#f4a460",
  seagreen: "#2e8b57",
  seashell: "#fff5ee",
  sienna: "#a0522d",
  silver: "#c0c0c0",
  skyblue: "#87ceeb",
  slateblue: "#6a5acd",
  slategray: "#708090",
  slategrey: "#708090",
  snow: "#fffafa",
  springgreen: "#00ff7f",
  steelblue: "#4682b4",
  tan: "#d2b48c",
  teal: "#008080",
  thistle: "#d8bfd8",
  tomato: "#ff6347",
  turquoise: "#40e0d0",
  violet: "#ee82ee",
  wheat: "#f5deb3",
  white: "#ffffff",
  whitesmoke: "#f5f5f5",
  yellow: "#ffff00",
  yellowgreen: "#9acd32",
};

module.exports = {
  hexToArgb,
  NAMED_COLORS,
  normalizeColor,
};