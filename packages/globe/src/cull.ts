// View culling for the border sources. MapLibre re-tiles every feature of a GeoJSON
// source on setData — the whole world even when the camera shows one sea — so the
// layers hand it only the polygon parts and line parts that can be on screen.
//
// The region is a spherical cap (centre + angular radius) rather than a lon/lat box:
// what a globe shows is a cap around the view centre, and a box around a view at high
// latitude spans most longitudes (MapLibre's getBounds() over Europe at zoom 3.6:
// −77°…101°). Parts are tested by their lon/lat bounding box against the cap, so a
// kept part is drawn whole. Pure functions; the map supplies the view.
import type { Feature, Position } from '@alexs-atlas/borders';

/** [west, south, east, north] of a ring or line, in degrees (the data never crosses ±180°). */
export type Box = [number, number, number, number];

/** A spherical cap: centre (degrees) and angular radius (degrees). r ≥ 180 is the whole sphere. */
export interface Cap {
  lon: number;
  lat: number;
  r: number;
}

export const WHOLE: Cap = { lon: 0, lat: 0, r: 180 };

const RAD = Math.PI / 180;

/** True when the cap covers the whole sphere (culling would drop nothing). */
export const isWhole = (c: Cap): boolean => c.r >= 180;

/** Great-circle distance between two points, in degrees. */
export function angularDistance(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const p1 = lat1 * RAD;
  const p2 = lat2 * RAD;
  const a = Math.sin((p2 - p1) / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(((lon2 - lon1) * RAD) / 2) ** 2;
  return (2 * Math.asin(Math.min(1, Math.sqrt(a)))) / RAD;
}

/** lon − from, wrapped into [−180, 180). */
const wrap = (lon: number, from: number): number => ((((lon - from) % 360) + 540) % 360) - 180;

/**
 * Smallest great-circle distance (degrees) from a point to a lon/lat box. Inside the
 * box's longitudes the nearest point is on the point's own meridian; otherwise it is on
 * the nearer edge meridian, at the latitude that maximises cos(distance) there
 * (atan2(sin φ, cos φ · cos Δλ)), clamped into the box.
 */
export function distanceToBox(lon: number, lat: number, box: Box): number {
  const [w, s, e, n] = box;
  const east = (((lon - w) % 360) + 360) % 360; // degrees east of the west edge, [0, 360)
  if (e - w >= 360 || east <= e - w) {
    return lat < s ? s - lat : lat > n ? lat - n : 0;
  }
  const phi = lat * RAD;
  let best = Infinity;
  for (const edge of [w, e]) {
    const dl = wrap(edge, lon) * RAD;
    const star = Math.atan2(Math.sin(phi), Math.cos(phi) * Math.cos(dl)) / RAD;
    const at = Math.min(n, Math.max(s, star));
    best = Math.min(best, angularDistance(lon, lat, edge, at));
  }
  return best;
}

/** True when any point of the box lies within the cap. */
export const capMeetsBox = (cap: Cap, box: Box): boolean => isWhole(cap) || distanceToBox(cap.lon, cap.lat, box) <= cap.r;

/** True when `inner` lies inside `outer`. */
export const capContains = (outer: Cap, inner: Cap): boolean =>
  isWhole(outer) || angularDistance(outer.lon, outer.lat, inner.lon, inner.lat) + inner.r <= outer.r;

/** The cap grown by `margin` × its radius (≥ 180° is the whole sphere). */
export const growCap = (c: Cap, margin: number): Cap => {
  const r = c.r * (1 + margin);
  return r >= 180 ? WHOLE : { lon: c.lon, lat: c.lat, r };
};

/**
 * Bounding boxes of position arrays (rings, lines), cached by array identity: decoded
 * frames are memoised by the borders client and coast lines are shared between frames
 * (decodeLines), so re-culling after a pan or the next year costs little.
 */
const boxCache = new WeakMap<Position[], Box>();

export function lineBox(points: Position[]): Box {
  let box = boxCache.get(points);
  if (box) return box;
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of points) {
    const x = p[0] as number;
    const y = p[1] as number;
    if (x < w) w = x;
    if (x > e) e = x;
    if (y < s) s = y;
    if (y > n) n = y;
  }
  box = [w, s, e, n];
  boxCache.set(points, box);
  return box;
}

/** Keeps the items whose box meets the cap; returns the input array itself when all do. */
function keep<T>(items: T[], cap: Cap, boxOf: (item: T) => Box): T[] {
  let out: T[] | null = null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i] as T;
    const inside = capMeetsBox(cap, boxOf(item));
    if (!inside && out === null) out = items.slice(0, i);
    else if (inside && out !== null) out.push(item);
  }
  return out ?? items;
}

/**
 * The feature restricted to the parts that meet the cap: Polygon (by its outer ring),
 * MultiPolygon (whole polygons), LineString and MultiLineString (whole lines). Returns
 * the feature itself when nothing is dropped, a shallow copy with fewer parts, or null
 * when no part meets the cap. Points and other geometries are kept as they are.
 */
export function cullFeature<F extends Feature>(f: F, cap: Cap): F | null {
  const g = f.geometry as { type: string; coordinates: unknown } | null;
  if (!g || isWhole(cap)) return f;
  switch (g.type) {
    case 'Polygon': {
      const outer = (g.coordinates as Position[][])[0];
      return outer && capMeetsBox(cap, lineBox(outer)) ? f : null;
    }
    case 'LineString':
      return capMeetsBox(cap, lineBox(g.coordinates as Position[])) ? f : null;
    case 'MultiPolygon':
    case 'MultiLineString': {
      const parts = g.coordinates as unknown[];
      const boxOf =
        g.type === 'MultiPolygon'
          ? (part: unknown) => lineBox(((part as Position[][])[0] ?? []) as Position[])
          : (part: unknown) => lineBox(part as Position[]);
      const kept = keep(parts, cap, boxOf);
      if (kept === parts) return f;
      if (kept.length === 0) return null;
      return { ...f, geometry: { type: g.type, coordinates: kept } } as F;
    }
    default:
      return f;
  }
}

/**
 * One Polygon feature per part of every multi-part MultiPolygon, each with the same `id`
 * and `properties` object (so feature-state and picking still treat the parts as one
 * polity); other features are kept as they are. The input array itself when nothing is
 * split.
 *
 * Why: MapLibre classifies a feature's rings per tile by their winding relative to the
 * first ring in the tile (classifyRings), and @maplibre/geojson-vt rewinds each ring
 * before rounding it to integer tile coordinates. A sliver island (Santa Rosa Island
 * off Pensacola, under a kilometre wide, at tile zoom 2) can flip its winding in that
 * rounding; inside a multi-part feature it then sets the "outer" winding for the tile
 * and the polity's mainland becomes a hole, so the mainland is not filled and the ocean
 * shows through (the USA from 1946 at map zoom 2–3). As separate features, a flipped
 * sliver only affects itself.
 */
export function splitParts<F extends Feature>(features: F[]): F[] {
  let out: F[] | null = null;
  for (let i = 0; i < features.length; i++) {
    const f = features[i] as F;
    const g = f.geometry as { type: string; coordinates: unknown } | null;
    if (g?.type === 'MultiPolygon' && (g.coordinates as unknown[]).length > 1) {
      out ??= features.slice(0, i);
      for (const part of g.coordinates as Position[][][]) out.push({ ...f, geometry: { type: 'Polygon', coordinates: part } } as F);
    } else if (out) out.push(f);
  }
  return out ?? features;
}

/** Every feature culled to the cap (see cullFeature); the input array itself when nothing changes. */
export function cullFeatures<F extends Feature>(features: F[], cap: Cap): F[] {
  if (isWhole(cap)) return features;
  let changed = false;
  const out: F[] = [];
  for (const f of features) {
    const c = cullFeature(f, cap);
    if (c !== f) changed = true;
    if (c) out.push(c);
  }
  return changed ? out : features;
}
