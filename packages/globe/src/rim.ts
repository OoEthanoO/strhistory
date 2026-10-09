// The globe's outline on screen (its rim): pure geometry from the map's projection.

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
 * (zoomed in so the globe covers the canvas, or not a globe projection). Used by picking
 * (nothing is under a point in space) and by the star field.
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
