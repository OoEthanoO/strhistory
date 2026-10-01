/**
 * Where to put a polity's label. Polities arrive from vector tiles in pieces
 * (each tile clips its own copy), may include water (OHM's modern countries
 * include territorial waters, Canada also Hudson Bay) and may be partly hidden
 * by smaller polities drawn over them. So each group of nearby pieces is drawn
 * onto a grid, the water and the covered ground are removed, and every
 * separate area that remains gets a point: the one furthest from the area's
 * edges, nudged towards its middle (a pole of inaccessibility).
 */
export type Ring = number[][];
export type Polygon = Ring[];
export type Box = [number, number, number, number];

export interface LabelArea {
  point: [number, number];
  /** Square degrees scaled for latitude, like ringArea(). */
  area: number;
  /** Share of this area that lies inside `polygons`, 0–1. */
  share(polygons: Polygon[]): number;
}

interface Grid { w: number; s: number; dx: number; dy: number; cols: number; rows: number }

/** Cells along the longer side of each group of pieces. */
const RESOLUTION = 48;
/** A label may sit this much closer to the edge than the best point if that brings it nearer the middle. */
const CENTRE_SLACK = 0.8;

export function boxOf(ring: Ring): Box {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const [x, y] of ring) { w = Math.min(w, x); s = Math.min(s, y); e = Math.max(e, x); n = Math.max(n, y); }
  return [w, s, e, n];
}

const overlaps = (a: Box, b: Box) => a[0] <= b[2] && b[0] <= a[2] && a[1] <= b[3] && b[1] <= a[3];
const union = (a: Box, b: Box): Box => [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];

/** Pieces whose boxes touch, grouped, so a far-off island gets its own fine grid. */
function groups(polygons: Polygon[]): { polygons: Polygon[]; box: Box }[] {
  const out: { polygons: Polygon[]; box: Box }[] = [];
  for (const polygon of polygons) {
    if (!polygon[0] || polygon[0].length < 4) continue;
    let group = { polygons: [polygon], box: boxOf(polygon[0]) };
    for (let i = out.length - 1; i >= 0; i--) {
      if (!overlaps(out[i].box, group.box)) continue;
      group = { polygons: [...out[i].polygons, ...group.polygons], box: union(out[i].box, group.box) };
      out.splice(i, 1);
    }
    out.push(group);
  }
  return out;
}

function gridFor([w, s, e, n]: Box, resolution: number): Grid {
  const k = Math.max(0.05, Math.cos((((s + n) / 2) * Math.PI) / 180));
  const cell = Math.max(((e - w) * k) / resolution, (n - s) / resolution, 1e-6);
  const dx = cell / k, dy = cell;
  return { w, s, dx, dy, cols: Math.max(1, Math.ceil((e - w) / dx)), rows: Math.max(1, Math.ceil((n - s) / dy)) };
}

/**
 * Sets the cells whose centres fall inside any of `polygons` (even–odd within
 * each polygon). Each edge is visited once and adds a crossing to every row
 * whose centre line it spans, so long coastlines stay cheap.
 */
function paint(mask: Uint8Array, g: Grid, polygons: Polygon[], value: 0 | 1) {
  const rows: number[][] = Array.from({ length: g.rows }, () => []);
  for (const polygon of polygons) {
    let touched = false;
    for (const ring of polygon) for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [x1, y1] = ring[j], [x2, y2] = ring[i];
      if (y1 === y2) continue;
      // Rows whose centre y lies in [min, max) of this edge.
      const r0 = Math.max(0, Math.ceil((Math.min(y1, y2) - g.s) / g.dy - 0.5));
      const r1 = Math.min(g.rows - 1, Math.ceil((Math.max(y1, y2) - g.s) / g.dy - 0.5) - 1);
      for (let r = r0; r <= r1; r++) {
        const y = g.s + (r + 0.5) * g.dy;
        rows[r].push(x1 + ((y - y1) * (x2 - x1)) / (y2 - y1));
        touched = true;
      }
    }
    if (!touched) continue;
    for (let r = 0; r < g.rows; r++) {
      const xs = rows[r];
      if (!xs.length) continue;
      xs.sort((a, b) => a - b);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const c0 = Math.max(0, Math.ceil((xs[i] - g.w) / g.dx - 0.5));
        const c1 = Math.min(g.cols - 1, Math.floor((xs[i + 1] - g.w) / g.dx - 0.5));
        for (let c = c0; c <= c1; c++) mask[r * g.cols + c] = value;
      }
      xs.length = 0;
    }
  }
}

/** Distance (in cells) from each set cell to the nearest unset cell or the grid's edge. */
function distances(mask: Uint8Array, g: Grid): Float32Array {
  const { cols, rows } = g;
  const d = new Float32Array(cols * rows);
  for (let i = 0; i < d.length; i++) d[i] = mask[i] ? Infinity : 0;
  const at = (c: number, r: number) => (c < 0 || r < 0 || c >= cols || r >= rows ? 0 : d[r * cols + c]);
  const D = Math.SQRT2;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    const i = r * cols + c;
    if (d[i]) d[i] = Math.min(d[i], at(c - 1, r) + 1, at(c, r - 1) + 1, at(c - 1, r - 1) + D, at(c + 1, r - 1) + D);
  }
  for (let r = rows - 1; r >= 0; r--) for (let c = cols - 1; c >= 0; c--) {
    const i = r * cols + c;
    if (d[i]) d[i] = Math.min(d[i], at(c + 1, r) + 1, at(c, r + 1) + 1, at(c + 1, r + 1) + D, at(c - 1, r + 1) + D);
  }
  return d;
}

/** Separate areas of set cells (touching corners count as joined). */
function components(mask: Uint8Array, g: Grid): number[][] {
  const seen = new Uint8Array(mask.length);
  const out: number[][] = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || seen[start]) continue;
    const cells: number[] = [];
    const stack = [start];
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      cells.push(i);
      const c = i % g.cols, r = (i - c) / g.cols;
      for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
        const cc = c + dc, rr = r + dr;
        if (cc < 0 || rr < 0 || cc >= g.cols || rr >= g.rows) continue;
        const j = rr * g.cols + cc;
        if (mask[j] && !seen[j]) { seen[j] = 1; stack.push(j); }
      }
    }
    out.push(cells);
  }
  return out;
}

/**
 * The separate visible areas of a polity, largest first. `hidden(box)` returns
 * what is drawn over it near `box`: the sea and smaller polities. Where the
 * sea data has no land at all (a speck of an island), the polity's own outline
 * stands in for it.
 */
export function labelAreas(polygons: Polygon[], hidden: (box: Box) => { water: Polygon[]; above: Polygon[] }, resolution = RESOLUTION): LabelArea[] {
  const areas: LabelArea[] = [];
  for (const group of groups(polygons)) {
    const g = gridFor(group.box, resolution);
    const mask = new Uint8Array(g.cols * g.rows);
    paint(mask, g, group.polygons, 1);
    const { water, above } = hidden(group.box);
    const own = mask.slice();
    paint(mask, g, water, 0);
    if (!mask.some(Boolean)) mask.set(own);
    paint(mask, g, above, 0);
    const d = distances(mask, g);
    const cellArea = g.dx * g.dy * Math.cos(((group.box[1] + group.box[3]) / 2) * (Math.PI / 180));
    for (const cells of components(mask, g)) {
      let best = 0, cx = 0, cy = 0;
      for (const i of cells) { best = Math.max(best, d[i]); cx += i % g.cols; cy += Math.floor(i / g.cols); }
      cx /= cells.length; cy /= cells.length;
      let pick = cells[0], nearest = Infinity;
      for (const i of cells) {
        if (d[i] < best * CENTRE_SLACK) continue;
        const dist = Math.hypot((i % g.cols) - cx, Math.floor(i / g.cols) - cy);
        if (dist < nearest) { nearest = dist; pick = i; }
      }
      const c = pick % g.cols, r = Math.floor(pick / g.cols);
      areas.push({
        point: [g.w + (c + 0.5) * g.dx, g.s + (r + 0.5) * g.dy],
        area: cells.length * cellArea,
        share(units) {
          const inside = new Uint8Array(mask.length);
          paint(inside, g, units, 1);
          return cells.filter((i) => inside[i]).length / cells.length;
        },
      });
    }
  }
  return areas.sort((a, b) => b.area - a.area);
}
