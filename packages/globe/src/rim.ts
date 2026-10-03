// Label fade at the globe's rim. MapLibre hides a screen-aligned label only when its
// anchor is behind the globe, so a label anchored just inside the horizon is drawn
// sticking out into space (e.g. a colonial empire labelled at its largest colony on the
// far side). BorderLayers estimates each label's box and fades out labels that hang
// out of the globe's outline (feature-state `edge`, multiplied into text-opacity).
// Pure functions: the screen geometry comes from the map.
import { LABEL_TYPE } from './style.js';

export interface Disc {
  x: number;
  y: number;
  r: number;
}

/** What `globeDisc` needs from a MapLibre map. */
export interface DiscMap {
  getProjection?(): { type?: unknown } | undefined;
  getCanvas(): { clientWidth: number; clientHeight: number };
  getCenter(): { lng: number; lat: number };
  project(lngLat: { lng: number; lat: number } | [number, number]): { x: number; y: number };
  unproject(point: [number, number]): { lng: number; lat: number };
}

/**
 * The globe's outline on screen (centre and radius, px), or null when no rim is in view
 * (zoomed in so the globe covers the canvas, or not a globe projection). Used by the
 * label fade, by picking (nothing is under a point in space) and by the star field.
 */
export function globeDisc(map: DiscMap): Disc | null {
  try {
    if (map.getProjection?.()?.type !== 'globe') return null;
    const canvas = map.getCanvas();
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const c = map.project(map.getCenter());
    // MapLibre unprojects a point beyond the globe to the nearest point of the horizon.
    const far = { x: c.x + 4 * Math.max(w, h, 1), y: c.y };
    const edge = map.project(map.unproject([far.x, far.y]));
    if (Math.abs(edge.x - far.x) < 1) return null;
    const r = Math.hypot(edge.x - c.x, edge.y - c.y);
    const corners: [number, number][] = [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ];
    if (!(r > 0) || corners.every(([x, y]) => Math.hypot(x - c.x, y - c.y) < r)) return null;
    return { x: c.x, y: c.y, r };
  } catch {
    return null;
  }
}

/** Half width and half height of a label's box, in px. */
export interface Extent {
  hw: number;
  hh: number;
}

/** Piecewise-linear interpolation through [x, y] stops, clamped at both ends (as MapLibre's "interpolate"). */
function interpolate(x: number, stops: readonly (readonly [number, number])[]): number {
  const first = stops[0];
  const last = stops[stops.length - 1];
  if (!first || !last) return 0;
  if (x <= first[0]) return first[1];
  if (x >= last[0]) return last[1];
  for (let i = 1; i < stops.length; i++) {
    const [x1, y1] = stops[i] as readonly [number, number];
    const [x0, y0] = stops[i - 1] as readonly [number, number];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return last[1];
}

/** The label text size (px) the style uses for an area (km²) at a zoom. */
export function labelSize(areaKm2: number, zoom: number): number {
  const logA = Math.log10(Math.max(areaKm2, 1));
  const atZoom = LABEL_TYPE.size.map(([z, stops]) => [z, interpolate(logA, stops)] as const);
  return interpolate(zoom, atZoom);
}

/** Inter's average advance per character in em, mixed and upper case (measured roughly). */
const ADVANCE_EM = { mixed: 0.56, upper: 0.68 };
const LINE_HEIGHT_EM = 1.2;
/** Halo width plus a little air, px. */
const HALO_PX = 2;

/**
 * Estimated box of a label: the style's size, case, letter spacing and greedy word wrap
 * at text-max-width. Good to a few px, which is all the fade needs.
 */
export function labelExtent(name: string, areaKm2: number, zoom: number): Extent {
  const size = labelSize(areaKm2, zoom);
  const upper = areaKm2 >= LABEL_TYPE.uppercaseKm2;
  const spacing = interpolate(Math.log10(Math.max(areaKm2, 1)), LABEL_TYPE.letterSpacing);
  const advance = (upper ? ADVANCE_EM.upper : ADVANCE_EM.mixed) + spacing;
  const perLine = Math.max(1, Math.floor(LABEL_TYPE.maxWidthEm / advance));
  let lines = 0;
  let widest = 0;
  let current = 0;
  for (const word of name.split(/\s+/).filter(Boolean)) {
    const next = current === 0 ? word.length : current + 1 + word.length;
    if (current > 0 && next > perLine) {
      lines += 1;
      widest = Math.max(widest, current);
      current = word.length;
    } else {
      current = next;
    }
  }
  if (current > 0) {
    lines += 1;
    widest = Math.max(widest, current);
  }
  return {
    hw: (widest * advance * size) / 2 + HALO_PX,
    hh: (Math.max(1, lines) * LINE_HEIGHT_EM * size) / 2 + HALO_PX,
  };
}

/** Share of a label's box beyond the rim up to which it stays fully visible. */
export const RIM_KEEP = 0.25;
/** Share of a label's box beyond the rim from which it is hidden. */
export const RIM_HIDE = 0.5;

/**
 * Opacity factor for a label anchored at screen point `p`, from the share of its box that
 * lies outside the globe's disc or outside the canvas (`size`, when given), sampled on a
 * 9 × 3 grid: 1 up to RIM_KEEP, 0 from RIM_HIDE, quarter steps in between (few
 * feature-state changes while the globe turns). A label grazing the rim stays; one
 * hanging out into space or cut by the screen edge next to the rim goes.
 */
export function rimFade(p: { x: number; y: number }, disc: Disc, extent: Extent, size?: { w: number; h: number }): number {
  const cols = 9;
  const rows = 3;
  let outside = 0;
  for (let i = 0; i < cols; i++) {
    const x = p.x - extent.hw + ((i + 0.5) * 2 * extent.hw) / cols;
    for (let j = 0; j < rows; j++) {
      const y = p.y - extent.hh + ((j + 0.5) * 2 * extent.hh) / rows;
      const offCanvas = size !== undefined && (x < 0 || y < 0 || x > size.w || y > size.h);
      if (offCanvas || Math.hypot(x - disc.x, y - disc.y) > disc.r) outside += 1;
    }
  }
  const share = outside / (cols * rows);
  if (share <= RIM_KEEP) return 1;
  if (share >= RIM_HIDE) return 0;
  return Math.round(((RIM_HIDE - share) / (RIM_HIDE - RIM_KEEP)) * 4) / 4;
}
