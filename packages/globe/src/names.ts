// Country names painted onto the globe, in the manner of Victoria 3's map: each polity's
// name in widely spaced capitals along the arc of its main body (name-arcs.ts), sized to
// fit the polity and fixed to the ground. A name is as much a part of the map as a
// border: zoom in to twice the scale and it is twice as large. Each letter is placed on
// the sphere once, then drawn every frame through the globe's own camera, with an affine
// approximation of the projection at the letter, so names curve with their arcs,
// foreshorten towards the rim and set behind the horizon like the land under them.
// Pure maths (no DOM, no MapLibre); map-names.ts paints the result.
import type { LandWater, NameArc } from './name-arcs.js';

export type Vec3 = [number, number, number];

/** Mean radius of the Earth (km). */
export const EARTH_KM = 6371.0088;

/** Typography and visibility of map names. */
export const NAME_TYPE = {
  /** Share of its arc's length a name may span. */
  span: 0.8,
  /** Letter height (the em) at most this share of the polity's width across the arc. */
  heightShare: 0.4,
  /** Letter spacing (em), at least and at most: wide names spread out to span their polity. */
  minSpacing: 0.12,
  maxSpacing: 1,
  /** Names fade in while their letters grow from `minPx` to `fullPx` (em, px on screen). */
  minPx: 7,
  fullPx: 10,
  /**
   * Zoomed in close, names fade out while their letters grow from `fadeOutFrom` to
   * `fadeOutTo` × the view's smaller side (as in Victoria 3; a name that size no longer
   * fits the view).
   */
  fadeOutFrom: 0.2,
  fadeOutTo: 0.32,
  /** Letters fade out towards the globe's rim: hidden where the surface faces the viewer less than `rimHide`, whole from `rimFull`. */
  rimHide: 0.1,
  rimFull: 0.32,
  /** A new name fades in over this many ms. */
  fadeMs: 250,
  /** Names of tier-1 overlays (indigenous nations, disputed areas) rank below tier-0 names of the same size. */
  overlayRank: 0.75,
  /** Two names whose letters come closer than this (em, beyond their own size) overlap: the larger one is drawn. */
  clearance: 0.15,
  /** Names within this many degrees of vertical read upward (cartographic convention), whichever end their arc starts from. */
  uprightBias: 15,
} as const;

/** What layout needs from the font. */
export interface NameMetrics {
  /** Advance width of a character (em). */
  advance(ch: string): number;
  /** Height of the capitals (em): letters are centred on the arc. */
  capHeight: number;
}

/** One letter of a name, placed on the unit sphere. */
export interface NameGlyph {
  ch: string;
  /** The letter's centre (unit vector), its reading direction and its up (unit, tangent to the sphere). */
  p: Vec3;
  t: Vec3;
  u: Vec3;
  /** Half the letter's advance (em). */
  half: number;
  /** Most of the letter lies over water (sea or lake): drawn in the sea ink. */
  sea: boolean;
  /**
   * A letter across a shore: the land around it (rings of unit vectors, even-odd), so it
   * is drawn in the land ink on land and the sea ink on water, split at the shore.
   */
  shore?: Vec3[][];
}

/** A name set along its arc: fixed to the ground at every zoom. */
export interface PlacedName {
  /** The record it names (rid; with `#n` for its n-th territory after the first). */
  key: string;
  /** Names of one polity that replace each other across years (same text and territory): they do not fade in again. */
  group: string;
  text: string;
  tier: number;
  /** Letter size (em) in radians of the sphere. */
  em: number;
  /** The letters reading along the arc (west to east), and turned round (east to west), for when the first would read upside down. */
  glyphs: NameGlyph[];
  turned: NameGlyph[];
  /** The middle of the name and the angular radius (rad) of a cap holding all of it. */
  mid: Vec3;
  radius: number;
  /** Larger names first; overlapping names give way to larger ones. */
  rank: number;
}

// ---- vectors ------------------------------------------------------------------------

const RAD = Math.PI / 180;

/** Unit vector of a lon/lat (degrees): x towards 0°E on the equator, y towards 90°E, z north. */
export function toVec(lon: number, lat: number): Vec3 {
  const l = lon * RAD;
  const f = lat * RAD;
  const c = Math.cos(f);
  return [c * Math.cos(l), c * Math.sin(l), Math.sin(f)];
}

export function toLonLat(p: Vec3): [number, number] {
  return [Math.atan2(p[1], p[0]) / RAD, Math.asin(Math.max(-1, Math.min(1, p[2]))) / RAD];
}

export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
function normalize(a: Vec3): Vec3 {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
}
/** The point a step `h` (radians, small) from `p` in direction `d` (unit, tangent at p). */
export function step(p: Vec3, d: Vec3, h: number): Vec3 {
  return normalize([p[0] + h * d[0], p[1] + h * d[1], p[2] + h * d[2]]);
}
/** Angle between two unit vectors (radians), precise for small angles. */
export function angle(a: Vec3, b: Vec3): number {
  return 2 * Math.asin(Math.min(1, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) / 2));
}

// ---- layout -------------------------------------------------------------------------

/** Positions along a lon/lat polyline on the sphere, by distance (km) from its first point. */
function along(coords: readonly [number, number][]): { length: number; at(s: number): Vec3 } {
  const pts = coords.map(([lon, lat]) => toVec(lon, lat));
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + EARTH_KM * angle(pts[i - 1]!, pts[i]!));
  const length = cum[cum.length - 1]!;
  const lerp = (i: number, s: number): Vec3 => {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const d = cum[i + 1]! - cum[i]!;
    const f = d > 0 ? (s - cum[i]!) / d : 0;
    return normalize([a[0] + f * (b[0] - a[0]), a[1] + f * (b[1] - a[1]), a[2] + f * (b[2] - a[2])]);
  };
  return {
    length,
    at(s) {
      const last = pts.length - 2;
      if (s <= 0) return lerp(0, s); // beyond the ends: straight on along the end segment
      if (s >= length) return lerp(last, s);
      let i = 0;
      while (i < last && cum[i + 1]! < s) i++;
      return lerp(i, s);
    },
  };
}

/**
 * Sets `text` (in capitals) along `arc`: the largest letters that fit `span` of the arc
 * (with at least `minSpacing` between them) and `heightShare` of the polity's width,
 * spread out to span the arc (up to `maxSpacing`) and centred on it. `water` says where
 * the sea and lakes are, from nine points across each letter: a letter over water takes
 * the sea ink, and one across a shore keeps the shore around it (with a `LandWater`) to
 * be split there, else takes the ink of most of its points. Null when nothing fits.
 */
export function layoutName(
  key: string,
  text: string,
  tier: number,
  arc: Pick<NameArc, 'coords' | 'lengthKm' | 'widthKm'>,
  metrics: NameMetrics,
  water?: LandWater | ((lon: number, lat: number) => boolean),
): PlacedName | null {
  const isWater = typeof water === 'function' ? water : water ? water.water : null;
  const shores = typeof water === 'object' ? water : null;
  const T = NAME_TYPE;
  const letters = [...text.trim().toLocaleUpperCase('en-GB')];
  if (!letters.some((ch) => ch.trim()) || arc.coords.length < 2) return null;
  const path = along(arc.coords);
  if (!(path.length > 0)) return null;
  const adv = letters.map((ch) => Math.max(0, metrics.advance(ch)));
  const total = adv.reduce((a, b) => a + b, 0);
  const gaps = letters.length - 1;
  const spanKm = T.span * Math.min(arc.lengthKm, path.length);
  const sizeKm = Math.min(T.heightShare * arc.widthKm, spanKm / (total + gaps * T.minSpacing));
  if (!(sizeKm > 0) || !Number.isFinite(sizeKm)) return null;
  const spacing = gaps > 0 ? Math.min(T.maxSpacing, Math.max(T.minSpacing, (spanKm / sizeKm - total) / gaps)) : 0;
  const lengthKm = (total + gaps * spacing) * sizeKm;
  const start = (path.length - lengthKm) / 2;
  const em = sizeKm / EARTH_KM;
  const tangentAt = (p: Vec3, s: number, h: number): Vec3 => {
    const a = path.at(s - h);
    const b = path.at(s + h);
    const d: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const k = dot(d, p);
    return normalize([d[0] - k * p[0], d[1] - k * p[1], d[2] - k * p[2]]);
  };
  const glyphs: NameGlyph[] = [];
  const turned: NameGlyph[] = [];
  let x = 0;
  for (let i = 0; i < letters.length; i++) {
    const ch = letters[i]!;
    const a = adv[i]!;
    const centre = start + (x + a / 2) * sizeKm;
    x += a + spacing;
    if (!ch.trim()) continue;
    // The tangent over the letter's own width, so each letter leans with the curve under it.
    const h = Math.max(0.5 * a * sizeKm, 1e-3);
    const glyph = (q: Vec3, tq: Vec3, uq: Vec3): NameGlyph => {
      const g: NameGlyph = { ch, p: q, t: tq, u: uq, half: a / 2, sea: false };
      if (!isWater) return g;
      const along = 0.4 * a * em;
      const across = 0.4 * metrics.capHeight * em;
      let wet = 0;
      for (const x of [-along, 0, along]) {
        for (const y of [-across, 0, across]) wet += isWater(...toLonLat(step(step(q, tq, x), uq, y))) ? 1 : 0;
      }
      g.sea = wet >= 5;
      if (wet > 0 && wet < 9 && shores) {
        // The box reaches ±0.75 em around the capitals' middle: accents and tails included.
        const shore = shoreAround(shores, q, tq, uq, a * em, em);
        if (shore) g.shore = shore;
      }
      return g;
    };
    const p = path.at(centre);
    const t = tangentAt(p, centre, h);
    glyphs.push(glyph(p, t, cross(p, t)));
    // Turned round: the same letters read from the arc's east end.
    const q = path.at(path.length - centre);
    const tq = tangentAt(q, path.length - centre, h);
    const back: Vec3 = [-tq[0], -tq[1], -tq[2]];
    turned.push(glyph(q, back, cross(q, back)));
  }
  const mid = path.at(path.length / 2);
  let radius = 0;
  for (const g of glyphs) radius = Math.max(radius, angle(mid, g.p) + em * Math.max(g.half, metrics.capHeight));
  return { key, group: key, text, tier, em, glyphs, turned, mid, radius, rank: em * (tier > 0 ? T.overlayRank : 1) };
}

/**
 * The shore around a letter (`width` × `height` radians, centred at `p`, reading along
 * `t`, up `u`): land and lake rings clipped to a lon/lat box holding the letter with a
 * margin, as unit vectors. Null across the antimeridian or with nothing in the box.
 */
function shoreAround(shores: LandWater, p: Vec3, t: Vec3, u: Vec3, width: number, height: number): Vec3[][] | null {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const x of [-0.75, 0.75]) {
    for (const y of [-0.75, 0.75]) {
      const [lon, lat] = toLonLat(step(step(p, t, x * width), u, y * height));
      w = Math.min(w, lon);
      e = Math.max(e, lon);
      s = Math.min(s, lat);
      n = Math.max(n, lat);
    }
  }
  if (!(e - w < 90)) return null;
  const rings = shores.shores(w, s, e, n);
  return rings.length ? rings.map((ring) => ring.map(([lon, lat]) => toVec(lon, lat))) : null;
}

/** Names in rank order (largest first): `a` before `b`. */
export function byRank(a: PlacedName, b: PlacedName): number {
  return b.rank - a.rank || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

/**
 * For names in rank order, the earlier (larger) names each one overlaps: letters closer
 * than their own half sizes plus `clearance`. Names are fixed to the ground, so this
 * holds at every zoom; a name is drawn only as far as the names it overlaps are not.
 */
export function nameBlockers(names: readonly PlacedName[], capHeight: number): number[][] {
  const pad = NAME_TYPE.clearance;
  const reach = (n: PlacedName, g: NameGlyph): number => n.em * (Math.max(g.half, capHeight / 2) + pad);
  return names.map((a, i) => {
    const out: number[] = [];
    for (let j = 0; j < i; j++) {
      const b = names[j]!;
      if (angle(a.mid, b.mid) > a.radius + b.radius + (a.em + b.em) * pad) continue;
      const hit = a.glyphs.some((ga) => b.glyphs.some((gb) => angle(ga.p, gb.p) < reach(a, ga) + reach(b, gb)));
      if (hit) out.push(j);
    }
    return out;
  });
}

// ---- the globe's camera -------------------------------------------------------------

/**
 * MapLibre's globe camera (MapLibre 6.11 VerticalPerspectiveTransform, unpitched and
 * north-up as the globe always is): a pinhole camera `d` px above the view centre on a
 * globe of radius `R` px, looking at the globe's centre, with its principal point at
 * (`cx`, `cy`). `c`, `e`, `n`: the view centre and the local east and north there.
 */
export interface GlobeCamera {
  cx: number;
  cy: number;
  R: number;
  d: number;
  c: Vec3;
  e: Vec3;
  n: Vec3;
}

export interface CameraView {
  lon: number;
  lat: number;
  zoom: number;
  /** Vertical field of view (degrees), `map.getVerticalFieldOfView()`. */
  fovY: number;
  /** Canvas size (CSS px). */
  width: number;
  height: number;
  padding?: { left?: number; right?: number; top?: number; bottom?: number };
}

/**
 * The camera of a view: R = 512·2^zoom / (2π·cos(centre latitude)) (MapLibre grows the
 * globe with the centre's latitude, so its scale there matches Web Mercator's), d =
 * (height / 2) / tan(fovY / 2) (`cameraToCenterDistance`), the principal point the canvas
 * centre moved by the map's padding.
 */
export function globeCamera(v: CameraView): GlobeCamera {
  const p = v.padding ?? {};
  const l = v.lon * RAD;
  const f = v.lat * RAD;
  return {
    cx: (v.width + (p.left ?? 0) - (p.right ?? 0)) / 2,
    cy: (v.height + (p.top ?? 0) - (p.bottom ?? 0)) / 2,
    R: (512 * 2 ** v.zoom) / (2 * Math.PI * Math.cos(f)),
    d: v.height / 2 / Math.tan((v.fovY * RAD) / 2),
    c: toVec(v.lon, v.lat),
    e: [-Math.sin(l), Math.cos(l), 0],
    n: [-Math.sin(f) * Math.cos(l), -Math.sin(f) * Math.sin(l), Math.cos(f)],
  };
}

/** Screen position (CSS px) of a point of the sphere, into `out[o]`, `out[o + 1]`. */
export function projectPoint(cam: GlobeCamera, p: Vec3, out: number[] | Float64Array, o = 0): void {
  const k = (cam.d * cam.R) / (cam.R + cam.d - cam.R * dot(p, cam.c));
  out[o] = cam.cx + k * dot(p, cam.e);
  out[o + 1] = cam.cy - k * dot(p, cam.n);
}

/**
 * How squarely the surface at `p` faces the camera: the cosine between its normal and the
 * line of sight (1 at the view centre, 0 at the horizon, negative behind it).
 */
export function facing(cam: GlobeCamera, p: Vec3): number {
  const D = cam.R + cam.d;
  const cos = dot(p, cam.c);
  return (D * cos - cam.R) / Math.sqrt(cam.R * cam.R + D * D - 2 * cam.R * D * cos);
}

/** Screen px per radian of the sphere at `p`, across the line of sight (before foreshortening). */
export function pxPerRadian(cam: GlobeCamera, p: Vec3): number {
  return (cam.d * cam.R) / (cam.R + cam.d - cam.R * dot(p, cam.c));
}

/** The angle (radians) from the view centre to the horizon. */
export function horizonAngle(cam: GlobeCamera): number {
  return Math.acos(cam.R / (cam.R + cam.d));
}

// ---- visibility ---------------------------------------------------------------------

export function smoothstep(a: number, b: number, x: number): number {
  if (x <= a) return 0;
  if (x >= b) return 1;
  const t = (x - a) / (b - a);
  return t * t * (3 - 2 * t);
}

/** Opacity of a name whose letters are `emPx` px on screen, in a view whose smaller side is `viewMin` px. */
export function sizeAlpha(emPx: number, viewMin: number): number {
  const T = NAME_TYPE;
  return smoothstep(T.minPx, T.fullPx, emPx) * (1 - smoothstep(T.fadeOutFrom * viewMin, T.fadeOutTo * viewMin, emPx));
}

/** Opacity of a letter where the surface faces the viewer by `f` (`facing`). */
export function rimAlpha(f: number): number {
  return smoothstep(NAME_TYPE.rimHide, NAME_TYPE.rimFull, f);
}

/**
 * Whether a name reading from screen point `a` towards `b` (along its arc, where it faces
 * the viewer most squarely) reads the wrong way round (right to left, or downward): then
 * it is drawn turned. A nearly vertical name reads upward; `wasTurned` adds a little
 * hysteresis so a name on the edge does not flicker.
 */
export function readsTurned(ax: number, ay: number, bx: number, by: number, wasTurned = false): boolean {
  const dx = bx - ax;
  const dy = ay - by; // screen y grows downward
  const len = Math.hypot(dx, dy);
  if (!(len > 0)) return wasTurned;
  const bias = NAME_TYPE.uprightBias * RAD;
  const lean = (dx * Math.cos(bias) + dy * Math.sin(bias)) / len;
  return wasTurned ? lean < 0.05 : lean < -0.05;
}
