// Camera math independent of MapLibre (so it is unit-testable).
//
// MapLibre's globe at zoom z has a radius of 512·2^z / (2π) CSS px at the
// equator, so its diameter equals min(width, height) when
//   2^z = min(w, h)·π / 512   ⇒   fitZoom = log2(min(w, h)·π / 512).
// A view stores `scale = 2^(zoom − fitZoom)`: the same view looks the same in
// a phone-sized card and on a 4K screen, and survives container resizes.
import type { GlobeView } from './types.js';

/** MapLibre's tile size in CSS px (its "world size" at zoom 0). */
export const TILE_SIZE = 512;

/** Default camera: Afro-Eurasia facing the viewer, whole globe visible. */
export const DEFAULT_VIEW: Readonly<GlobeView> = Object.freeze({ center: [20, 30] as [number, number], scale: 1 });

/** Zoom at which the globe's diameter equals the container's smaller side. */
export function fitZoom(width: number, height: number): number {
  const side = Math.max(1, Math.min(width, height));
  return Math.log2((side * Math.PI) / TILE_SIZE);
}

export function scaleToZoom(scale: number, fit: number): number {
  return fit + Math.log2(Math.max(1e-6, scale));
}

export function zoomToScale(zoom: number, fit: number): number {
  return 2 ** (zoom - fit);
}

/** Wraps a longitude into [−180, 180). */
export function wrapLon(lon: number): number {
  const w = ((((lon + 180) % 360) + 360) % 360) - 180;
  return w === 180 ? -180 : w;
}

/** Latitude MapLibre can centre on (Web Mercator limit). */
export const MAX_LAT = 85.051129;

export function clampLat(lat: number): number {
  return Math.max(-MAX_LAT, Math.min(MAX_LAT, lat));
}

/** A finite, wrapped, clamped copy of a view (garbage in → default view). */
export function normalizeView(v: Partial<GlobeView> | undefined, fallback: GlobeView = DEFAULT_VIEW): GlobeView {
  const c = v?.center;
  const lon = c && Number.isFinite(c[0]) ? wrapLon(c[0]) : fallback.center[0];
  const lat = c && Number.isFinite(c[1]) ? clampLat(c[1]) : fallback.center[1];
  const s = v?.scale;
  const scale = typeof s === 'number' && Number.isFinite(s) && s > 0 ? s : fallback.scale;
  return { center: [lon, lat], scale };
}

/** Rounded copy for URLs/logs: centre to 4 decimals (~10 m), scale to 3 significant digits. */
export function roundView(v: GlobeView): GlobeView {
  const r4 = (n: number): number => Math.round(n * 1e4) / 1e4;
  return { center: [r4(v.center[0]), r4(v.center[1])], scale: Number(v.scale.toPrecision(3)) };
}

/** Bounding box [west, south, east, north]; west > east means it crosses the antimeridian. */
export type BBox = [number, number, number, number];

/**
 * Bounding box of GeoJSON coordinates that takes the antimeridian into account:
 * the longitude interval is the complement of the largest empty gap around the
 * circle, so Russia or Fiji get a tight box with west > east instead of
 * spanning the whole world.
 */
export function bboxOfCoordinates(coords: Iterable<readonly number[]>): BBox | null {
  const lons: number[] = [];
  let s = Infinity;
  let n = -Infinity;
  for (const p of coords) {
    const lon = p[0];
    const lat = p[1];
    if (lon === undefined || lat === undefined || !Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    lons.push(wrapLon(lon));
    if (lat < s) s = lat;
    if (lat > n) n = lat;
  }
  if (lons.length === 0) return null;
  lons.sort((a, b) => a - b);
  // Largest gap between consecutive longitudes, including the wrap-around gap.
  const first = lons[0] as number;
  const last = lons[lons.length - 1] as number;
  let gap = first + 360 - last;
  let w = first;
  let e = last;
  for (let i = 1; i < lons.length; i++) {
    const a = lons[i - 1] as number;
    const b = lons[i] as number;
    if (b - a > gap) {
      gap = b - a;
      w = b;
      e = a;
    }
  }
  return [w, s, e, n];
}

/** Iterates every position of a (Multi)Polygon / (Multi)LineString / Point geometry. */
export function* positionsOf(geometry: { type: string; coordinates?: unknown } | null | undefined): Generator<readonly number[]> {
  if (!geometry || !('coordinates' in geometry)) return;
  const walk = function* (c: unknown): Generator<readonly number[]> {
    if (!Array.isArray(c)) return;
    if (typeof c[0] === 'number') {
      yield c as number[];
      return;
    }
    for (const x of c) yield* walk(x);
  };
  yield* walk(geometry.coordinates);
}

/** Union of boxes on the circle of longitudes (keeps the smaller wrap-aware interval). */
export function unionBBoxes(boxes: readonly BBox[]): BBox | null {
  if (boxes.length === 0) return null;
  // Feed the corner longitudes (and, for wide boxes, intermediate meridians)
  // through the same gap logic so the union stays tight across the antimeridian.
  const pts: number[][] = [];
  for (const [w, s, e, n] of boxes) {
    const width = (((e - w) % 360) + 360) % 360;
    const steps = Math.max(1, Math.ceil(width / 90));
    for (let i = 0; i <= steps; i++) pts.push([w + (width * i) / steps, s], [w + (width * i) / steps, n]);
  }
  return bboxOfCoordinates(pts);
}

/** Longitude width of a box in degrees (handles west > east). */
export function bboxWidth(b: BBox): number {
  const width = b[2] - b[0];
  return width >= 0 ? width : width + 360;
}

/** Centre [lon, lat] of a box (handles west > east). */
export function bboxCenter(b: BBox): [number, number] {
  return [wrapLon(b[0] + bboxWidth(b) / 2), (b[1] + b[3]) / 2];
}

/** `[[w, s], [e', n]]` with e' ≥ w (e + 360 when crossing the antimeridian), as MapLibre's fitBounds expects. */
export function bboxToLngLatBounds(b: BBox): [[number, number], [number, number]] {
  return [
    [b[0], b[1]],
    [b[0] + bboxWidth(b), b[3]],
  ];
}

/** Normalises a padding option to MapLibre's {top, right, bottom, left}. */
export function normalizePadding(
  p: number | { top?: number; right?: number; bottom?: number; left?: number } | undefined,
  fallback = 40,
): { top: number; right: number; bottom: number; left: number } {
  if (typeof p === 'number') return { top: p, right: p, bottom: p, left: p };
  return { top: p?.top ?? fallback, right: p?.right ?? fallback, bottom: p?.bottom ?? fallback, left: p?.left ?? fallback };
}

type Padding = { top: number; right: number; bottom: number; left: number };

/**
 * `cameraForBounds` options that fit a box inside `padding` *and* the map's own padding
 * (`map.getPadding()`, set by a host with `map.setPadding`). MapLibre 6.11.2's globe
 * camera fits the zoom to the whole canvas minus the call's padding only, while the
 * camera still centres in the map's padded area, so flights overshot the free area by
 * up to the smaller map padding of each axis. The map padding is added to the call's
 * padding, and `offset` cancels the centre shift that this adds on top of the map's own.
 * Null when the map has no padding (nothing to compensate), or when the map padding
 * takes about half of `size` on an axis: MapLibre's first (Mercator) pass subtracts the
 * map padding as well, so it would refuse the fit ("Map cannot fit within canvas").
 */
export function fitInsideMapPadding(
  padding: Padding,
  mapPadding: Partial<Padding> | null | undefined,
  size?: { width: number; height: number },
): { padding: Padding; offset: [number, number] } | null {
  const m = {
    top: Math.max(0, mapPadding?.top ?? 0),
    right: Math.max(0, mapPadding?.right ?? 0),
    bottom: Math.max(0, mapPadding?.bottom ?? 0),
    left: Math.max(0, mapPadding?.left ?? 0),
  };
  if (!m.top && !m.right && !m.bottom && !m.left) return null;
  if (
    size &&
    (size.width - 2 * (m.left + m.right) - padding.left - padding.right <= 0 ||
      size.height - 2 * (m.top + m.bottom) - padding.top - padding.bottom <= 0)
  ) {
    return null;
  }
  return {
    padding: { top: padding.top + m.top, right: padding.right + m.right, bottom: padding.bottom + m.bottom, left: padding.left + m.left },
    offset: [(m.right - m.left) / 2, (m.bottom - m.top) / 2],
  };
}
