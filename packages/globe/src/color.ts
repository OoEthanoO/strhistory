// Small, dependency-free colour helpers used to pre-blend polity fills and to
// normalise theme colours. Only sRGB is modelled; that is all MapLibre paints.

/** An sRGB colour with channels 0..255 and alpha 0..1. */
export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

const HEX_RE = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const FUNC_RE = /^(rgba?|hsla?)\(\s*([^)]*)\)$/i;

/** CSS named colours that are plausible in a theme. Anything else is resolved by the browser. */
const NAMED: Record<string, string> = {
  black: '#000000',
  white: '#ffffff',
  transparent: '#00000000',
  red: '#ff0000',
  green: '#008000',
  blue: '#0000ff',
  gray: '#808080',
  grey: '#808080',
  silver: '#c0c0c0',
  navy: '#000080',
};

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

function parseChannel(token: string, max: number): number {
  const t = token.trim();
  if (t.endsWith('%')) return (parseFloat(t) / 100) * max;
  return parseFloat(t);
}

function parseAlpha(token: string | undefined): number {
  if (token === undefined || token.trim() === '') return 1;
  const t = token.trim();
  return clamp(t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t), 0, 1);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  // h in degrees, s and l in 0..1 (CSS Color 4 algorithm).
  const f = (n: number): number => {
    const k = (n + h / 30) % 12;
    const a = s * Math.min(l, 1 - l);
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  return [f(0) * 255, f(8) * 255, f(4) * 255];
}

/**
 * Parses `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`, `rgb()/rgba()` and `hsl()/hsla()`
 * (comma or space syntax) and a few named colours. Returns `null` for anything else
 * (callers may then ask the browser via {@link resolveCssColor}).
 */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  const named = NAMED[s];
  if (named) return parseColor(named);
  if (HEX_RE.test(s)) {
    let h = s.slice(1);
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    const n = (i: number): number => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  const m = FUNC_RE.exec(s);
  if (!m) return null;
  const fn = m[1] ?? '';
  // Accept "1, 2, 3, 0.5" and "1 2 3 / 0.5".
  const [colorPart = '', alphaPart] = (m[2] ?? '').split('/');
  const parts = colorPart.split(/[\s,]+/).filter(Boolean);
  let alphaToken = alphaPart;
  if (parts.length === 4 && alphaToken === undefined) alphaToken = parts.pop();
  if (parts.length !== 3) return null;
  const [p0 = '', p1 = '', p2 = ''] = parts;
  let rgb: [number, number, number];
  if (fn.startsWith('rgb')) {
    rgb = [parseChannel(p0, 255), parseChannel(p1, 255), parseChannel(p2, 255)];
  } else {
    const h = parseFloat(p0);
    rgb = hslToRgb(((h % 360) + 360) % 360, parseChannel(p1, 1), parseChannel(p2, 1));
  }
  if (rgb.some((v) => !Number.isFinite(v))) return null;
  return { r: clamp(rgb[0], 0, 255), g: clamp(rgb[1], 0, 255), b: clamp(rgb[2], 0, 255), a: parseAlpha(alphaToken) };
}

/**
 * Like {@link parseColor} but falls back to the browser for any other CSS colour
 * syntax (named colours, `oklch()`, `color-mix()` …) by letting a canvas
 * normalise it. Throws a descriptive error when the value is not a colour.
 */
export function toRgba(input: string): Rgba {
  const parsed = parseColor(input);
  if (parsed) return parsed;
  const resolved = resolveCssColor(input);
  const again = resolved ? parseColor(resolved) : null;
  if (again) return again;
  throw new Error(`@alexs-atlas/globe: "${input}" is not a colour this module can read (use hex, rgb() or hsl())`);
}

/** Asks the browser to serialise a CSS colour as hex/rgba. Returns null outside a browser. */
export function resolveCssColor(input: string): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) return null;
    ctx.fillStyle = '#010203';
    ctx.fillStyle = input;
    const out = String(ctx.fillStyle);
    // An invalid value leaves the sentinel in place.
    return out === '#010203' && input.trim().toLowerCase() !== '#010203' ? null : out;
  } catch {
    return null;
  }
}

const hex2 = (v: number): string => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0');

/** `#rrggbb` (alpha dropped) — the format used for opaque fills. */
export function toHex(c: Rgba): string {
  return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
}

/** `rgba(r, g, b, a)` keeping alpha — accepted by MapLibre and CSS. */
export function toRgbaString(c: Rgba): string {
  const a = Math.round(clamp(c.a, 0, 1) * 1000) / 1000;
  return `rgba(${Math.round(c.r)}, ${Math.round(c.g)}, ${Math.round(c.b)}, ${a})`;
}

/** Normalises any accepted colour string to a form MapLibre always understands. */
export function normalizeColor(input: string): string {
  const c = toRgba(input);
  return c.a >= 1 ? toHex(c) : toRgbaString(c);
}

/**
 * Opaque result of painting `fg` with opacity `alpha` over the opaque `bg`
 * (straight sRGB compositing, the same thing a translucent fill would show).
 * The fg colour's own alpha multiplies `alpha`.
 */
export function blendOver(fg: string, bg: string, alpha: number): string {
  const f = toRgba(fg);
  const b = toRgba(bg);
  const a = clamp(alpha, 0, 1) * f.a;
  return toHex({ r: f.r * a + b.r * (1 - a), g: f.g * a + b.g * (1 - a), b: f.b * a + b.b * (1 - a), a: 1 });
}

/** Mixes `c` towards `toward` by `amount` (0 = c, 1 = toward), opaque. */
export function mix(c: string, toward: string, amount: number): string {
  return blendOver(toward, c, amount);
}

/** WCAG relative luminance of an sRGB colour (alpha ignored). */
export function luminance(c: string): number {
  const { r, g, b } = toRgba(c);
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colours (alpha ignored). */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Whether a colour is fully transparent (a layer drawn in it can be skipped). */
export function isTransparent(input: string): boolean {
  return toRgba(input).a === 0;
}

const toLinear = (v: number): number => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLinear = (v: number): number => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/**
 * A deeper shade of `c`: its OKLab lightness lowered by `darken` (0..1), hue and chroma
 * kept (clipped to sRGB), the way pigment pools at the edge of a watercolour wash.
 * Opaque.
 */
export function shade(c: string, darken: number): string {
  const { r, g, b } = toRgba(c);
  const [lr, lg, lb] = [r, g, b].map((v) => toLinear(v / 255)) as [number, number, number];
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = Math.max(0, 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s - clamp(darken, 0, 1));
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const l2 = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m2 = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s2 = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  const out = [
    4.0767416621 * l2 - 3.3077115913 * m2 + 0.2309699292 * s2,
    -1.2684380046 * l2 + 2.6097574011 * m2 - 0.3413193965 * s2,
    -0.0041960863 * l2 - 0.7034186147 * m2 + 1.707614701 * s2,
  ].map((v) => Math.round(fromLinear(clamp(v, 0, 1)) * 255)) as [number, number, number];
  return toHex({ r: out[0], g: out[1], b: out[2], a: 1 });
}
