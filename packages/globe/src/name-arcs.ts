// Where a polity's name goes on the map, in the manner of grand-strategy maps: a gentle
// arc through the middle of its main body, along its long axis (`nameArc`), and the
// short form of its name (`shortName`). Pure functions (no MapLibre, no DOM); names.ts
// sets the type along the arc and paints it.
import type { MultiPolygon, Polygon, Position } from '@alexs-atlas/borders';

/** Kilometres per degree of latitude (and of longitude at the equator). */
const KM_PER_DEG = 111.32;
/** Scan lines across the long axis. */
const STATIONS = 32;
/** Points of the returned arc. */
const SAMPLES = 24;

export interface NameArc {
  /** lon/lat along the arc, west end first (the name reads from it). */
  coords: [number, number][];
  /** Length of the arc (km). */
  lengthKm: number;
  /** Typical width of the polity across the arc (km): the median land over the arc's span. */
  widthKm: number;
  /** Per point of `coords`: whether it lies on the polity's own land (else sea or another's land). */
  onBody: boolean[];
}

/** Area of a ring in a plane (shoelace, signed). */
function ringArea(r: readonly [number, number][]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j]![0] * r[i]![1] - r[i]![0] * r[j]![1];
  return a / 2;
}

/** Parts within this share of the largest part's size (√area) of the name's body join it, … */
const BODY_GAP_SHARE = 0.25;
/** … and always those within this distance (km). */
const BODY_GAP_MIN_KM = 100;
/** Parts smaller than this share of the largest part are left out of the name's body (islets, exclaves). */
const BODY_MIN_SHARE = 0.02;
/** Vertices compared per part when measuring the distance between two parts. */
const GAP_VERTICES = 400;
/** Weak scan lines (under 18 % of the seed's land) an arc may cross in a row. */
const MAX_DIP = 3;
/** Seeds (widest scan lines) tried when choosing the band an arc follows. */
const SEEDS = 4;
/** A gap inside one part is bridged when at most this share of the land on either side (a bay). */
const BAY_SHARE = 0.5;
/** An arc's ends are trimmed where the room around it (to the edge of its band) falls below this share of its median room. */
const TRIM_ROOM = 0.35;
/** For comparing arcs by the name they hold: letter height as a share of the width, and of the length (a name of ~10 letters). */
const NAME_HEIGHT_SHARE = 0.4;
const NAME_LENGTH_SHARE = 0.1;
/** Largest turn of an arc (°) for thick bodies (median land width ≥ 0.4 × span) and for thin ones (≤ 0.2 ×). */
const TURN_COMPACT = 6;
const TURN_LONG = 20;

/** Whether a point (lon, lat) lies on land held by another polity (or by none): never bridged. */
export type OtherLandTest = (lon: number, lat: number) => boolean;

interface BodyPart {
  rings: [number, number][][];
  area: number;
  box: [number, number, number, number];
}

/** Even-odd point-in-polygon over a part's rings (outer and holes) in the local plane. */
function inPart(part: BodyPart, x: number, y: number): boolean {
  if (x < part.box[0] || x > part.box[2] || y < part.box[1] || y > part.box[3]) return false;
  let inside = false;
  for (const ring of part.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i]!;
      const [xj, yj] = ring[j]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Smallest distance between the (sampled) vertices of two parts' outer rings, km. */
function partGap(a: BodyPart, b: BodyPart): number {
  const ra = a.rings[0]!;
  const rb = b.rings[0]!;
  const sa = Math.max(1, Math.floor(ra.length / GAP_VERTICES));
  const sb = Math.max(1, Math.floor(rb.length / GAP_VERTICES));
  let best = Infinity;
  for (let i = 0; i < ra.length; i += sa) {
    const [x, y] = ra[i]!;
    for (let j = 0; j < rb.length; j += sb) best = Math.min(best, Math.hypot(rb[j]![0] - x, rb[j]![1] - y));
  }
  return best;
}

/** Separate territories of one polity named on their own: at most this many, … */
const MAX_BODIES = 4;
/** … each seeded by a part at least this share of the largest part's area … */
const BODY_NAME_SHARE = 0.03;
/** … and at least this far (km) from the land of the territories named before it (an archipelago's other islands are not). */
const BODY_APART_KM = 2000;
/** Vertices of a ring compared when measuring how far apart two territories are. */
const APART_VERTICES = 200;

/**
 * The name arcs of a polity, one per territory it holds apart from the others, largest
 * first: up to `maxBodies` bodies, each seeded by the largest part not yet in a body, at
 * least `BODY_NAME_SHARE` of the largest part and `BODY_APART_KM` from the territories
 * named before it (so a colonial power is named at home as well as over its largest
 * colony: the United Kingdom over Britain and Aden in 1914, the Dutch Republic over the
 * Netherlands and Java in 1789; Indonesia's islands or Alaska are not named again).
 *
 * Each arc is a quadratic curve along the principal axis of its body (so it bends with
 * the shape, never wiggles). A body is its seed plus the parts near it (`BODY_*`, by
 * single linkage over the real distance between parts: the Eastern Roman Empire's coasts
 * around the Mediterranean, Japan's main islands). On each scan line across the axis the
 * body's land comes in bands; a gap between two bands is bridged unless `isOther` says it
 * is land of another polity or unclaimed land, and only between two parts (a sea, a
 * strait) or, inside one part, when it is at most half as wide as the land on either side
 * (a bay, China's Bohai Gulf). The arc follows one band from the widest scan lines
 * outward (the one overlapping the previous most; of `SEEDS` starts, the chain with the
 * most land wins) while it keeps at least 18 % of that land, crossing at most `MAX_DIP`
 * weak or empty scan lines in a row; where it ends it may hop across open sea to the next
 * island, never across other land (a horseshoe-shaped polity is named along one arm).
 * `onBody` marks which points of an arc lie on its body. A body too small or degenerate
 * has no arc; one whose arc would cross the antimeridian falls back to its seed.
 */
export function nameArcs(geometry: Polygon | MultiPolygon, isOther?: OtherLandTest, maxBodies = MAX_BODIES): NameArc[] {
  const parts: Position[][][] = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates).filter((p) => p[0] && p[0].length >= 4);
  // Each part's area (outer ring minus holes, in its own local plane) and centre.
  const own = parts.map((part) => {
    const outer = part[0]!;
    let sx = 0;
    let sy = 0;
    for (const p of outer) {
      sx += p[0]!;
      sy += p[1]!;
    }
    const cLon = sx / outer.length;
    const cLat = sy / outer.length;
    const k = Math.cos((cLat * Math.PI) / 180) * KM_PER_DEG;
    const local = (ring: Position[]): [number, number][] => ring.map((q) => [(((q[0]! - cLon + 540) % 360) - 180) * k, (q[1]! - cLat) * KM_PER_DEG]);
    const area = Math.abs(ringArea(local(outer))) - part.slice(1).reduce((sum, h) => sum + Math.abs(ringArea(local(h))), 0);
    return { cLon, cLat, area };
  });
  const order = parts.map((_, i) => i).filter((i) => own[i]!.area > 0).sort((a, b) => own[b]!.area - own[a]!.area);
  const used = new Set<number>();
  const arcs: NameArc[] = [];
  // Sampled outer-ring vertices (unit vectors) of the territories named so far.
  const named: [number, number, number][] = [];
  const sample = (part: Position[][]): [number, number, number][] => {
    const ring = part[0]!;
    const every = Math.max(1, Math.floor(ring.length / APART_VERTICES));
    const out: [number, number, number][] = [];
    for (let i = 0; i < ring.length; i += every) {
      const l = (ring[i]![0]! * Math.PI) / 180;
      const f = (ring[i]![1]! * Math.PI) / 180;
      out.push([Math.cos(f) * Math.cos(l), Math.cos(f) * Math.sin(l), Math.sin(f)]);
    }
    return out;
  };
  const apartKm = (part: Position[][]): number => {
    let best = 2;
    for (const a of sample(part)) for (const b of named) best = Math.min(best, Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    return 2 * Math.asin(Math.min(1, best / 2)) * 6371;
  };
  let bodies = 0;
  for (const ref of order) {
    if (bodies >= maxBodies || own[ref]!.area < BODY_NAME_SHARE * own[order[0]!]!.area) break;
    if (used.has(ref) || (named.length && apartKm(parts[ref]!) < BODY_APART_KM)) continue;
    bodies++;
    // The seed anchors one local plane (km) for its whole body.
    const lon0 = own[ref]!.cLon;
    const lat0 = own[ref]!.cLat;
    const k0 = Math.cos((lat0 * Math.PI) / 180) * KM_PER_DEG;
    const toPart = (part: Position[][]): BodyPart | null => {
      const rings = part.map((ring) => ring.map((q) => [(((q[0]! - lon0 + 540) % 360) - 180) * k0, (q[1]! - lat0) * KM_PER_DEG] as [number, number]));
      const area = Math.abs(ringArea(rings[0]!)) - rings.slice(1).reduce((sum, h) => sum + Math.abs(ringArea(h)), 0);
      if (!(area > 0)) return null;
      const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const [x, y] of rings[0]!) {
        box[0] = Math.min(box[0], x);
        box[1] = Math.min(box[1], y);
        box[2] = Math.max(box[2], x);
        box[3] = Math.max(box[3], y);
      }
      return { rings, area, box };
    };
    const seed = toPart(parts[ref]!);
    used.add(ref);
    if (!seed) continue;
    // Parts that, unwrapped around the seed, lie beyond ±180° (across the antimeridian from
    // it) would put the arc out of range: kept out.
    const others = parts
      .map((part, i) => ({ i, q: used.has(i) ? null : toPart(part) }))
      .filter((o): o is { i: number; q: BodyPart } => !!o.q && o.q.area >= BODY_MIN_SHARE * seed.area && lon0 + o.q.box[0] / k0 >= -180 && lon0 + o.q.box[2] / k0 <= 180);
    const gap = Math.max(BODY_GAP_MIN_KM, BODY_GAP_SHARE * Math.sqrt(seed.area));
    const boxGap = (a: BodyPart['box'], b: BodyPart['box']): number => Math.hypot(Math.max(0, a[0] - b[2], b[0] - a[2]), Math.max(0, a[1] - b[3], b[1] - a[3]));
    const body: BodyPart[] = [seed];
    let rest = others;
    for (let grew = true; grew; ) {
      grew = false;
      rest = rest.filter((o) => {
        if (!body.some((m) => boxGap(o.q.box, m.box) <= gap && partGap(o.q, m) <= gap)) return true;
        body.push(o.q);
        used.add(o.i);
        grew = true;
        return false;
      });
    }
    const arc = arcOfBody(body, lon0, lat0, k0, gap, isOther) ?? (body.length > 1 ? arcOfBody([seed], lon0, lat0, k0, gap, isOther) : null);
    if (arc) arcs.push(arc);
    if (bodies < maxBodies) for (const i of [ref, ...others.filter((o) => body.includes(o.q)).map((o) => o.i)]) named.push(...sample(parts[i]!));
  }
  return arcs;
}

/** The arc of a polity's main body (the first of `nameArcs`), or null. */
export function nameArc(geometry: Polygon | MultiPolygon, isOther?: OtherLandTest): NameArc | null {
  return nameArcs(geometry, isOther, 1)[0] ?? null;
}

function arcOfBody(body: BodyPart[], lon0: number, lat0: number, k0: number, gapKm: number, isOther?: OtherLandTest): NameArc | null {
  // Area-weighted centroid and second moments of the body (outer rings minus holes).
  let A = 0;
  let Cx = 0;
  let Cy = 0;
  let Sxx = 0;
  let Syy = 0;
  let Sxy = 0;
  for (const part of body) {
    part.rings.forEach((ring, ri) => {
      const sign = Math.sign(ringArea(ring)) * (ri === 0 ? 1 : -1) || 1;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [x0, y0] = ring[j]!;
        const [x1, y1] = ring[i]!;
        const c = (x0 * y1 - x1 * y0) * sign;
        A += c / 2;
        Cx += ((x0 + x1) * c) / 6;
        Cy += ((y0 + y1) * c) / 6;
        Sxx += ((x0 * x0 + x0 * x1 + x1 * x1) * c) / 12;
        Syy += ((y0 * y0 + y0 * y1 + y1 * y1) * c) / 12;
        Sxy += ((x0 * y1 + 2 * x0 * y0 + 2 * x1 * y1 + x1 * y0) * c) / 24;
      }
    });
  }
  if (!(A > 0)) return null;
  const cx = Cx / A;
  const cy = Cy / A;
  const ixx = Sxx / A - cx * cx;
  const iyy = Syy / A - cy * cy;
  const ixy = Sxy / A - cx * cy;
  // Principal axis; a compact body (axes within 1.6×) reads horizontally, as on game
  // maps; only clearly elongated ones (Chile, Norway, Italy) follow their long axis.
  const spread = Math.hypot(ixx - iyy, 2 * ixy);
  const major = (ixx + iyy + spread) / 2;
  const minor = (ixx + iyy - spread) / 2;
  let theta = 0.5 * Math.atan2(2 * ixy, ixx - iyy);
  if (minor > 0 && major / minor < 1.6 ** 2) theta = 0;
  const ux = Math.cos(theta);
  const uy = Math.sin(theta);
  const toLonLat = (s: number, t: number): [number, number] => [lon0 + (cx + s * ux - t * uy) / k0, lat0 + (cy + s * uy + t * ux) / KM_PER_DEG];

  // (s, t): along and across the axis, from the centroid; each ring keeps its part's index.
  const st = body.flatMap((part, pi) => part.rings.map((ring) => ({ pi, pts: ring.map(([x, y]) => [(x - cx) * ux + (y - cy) * uy, -(x - cx) * uy + (y - cy) * ux] as [number, number]) })));
  let smin = Infinity;
  let smax = -Infinity;
  for (const ring of st) {
    for (const q of ring.pts) {
      smin = Math.min(smin, q[0]);
      smax = Math.max(smax, q[0]);
    }
  }
  if (!(smax - smin > 0)) return null;
  const step = (smax - smin) / STATIONS;
  const stations = Array.from({ length: STATIONS }, (_, i) => smin + (i + 0.5) * step);
  const crossings: Map<number, number[]>[] = stations.map(() => new Map());
  for (const { pi, pts } of st) {
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
      const [s0, t0] = pts[j]!;
      const [s1, t1] = pts[i]!;
      if (s0 === s1) continue;
      const lo = Math.min(s0, s1);
      const hi = Math.max(s0, s1);
      const first = Math.max(0, Math.ceil((lo - smin) / step - 0.5));
      const last = Math.min(STATIONS - 1, Math.floor((hi - smin) / step - 0.5));
      for (let k = first; k <= last; k++) {
        const s = stations[k]!;
        if (s < lo || s >= hi) continue;
        const list = crossings[k]!.get(pi) ?? [];
        list.push(t0 + ((s - s0) / (s1 - s0)) * (t1 - t0));
        crossings[k]!.set(pi, list);
      }
    }
  }
  // Per scan line: land intervals (each part's sorted crossings pair up), then bands of
  // intervals joined across gaps that are bridged (between two parts, not other land).
  interface Band { t0: number; t1: number; land: number }
  // `inner`: also bridge any gap of water inside one part (a sea the polity surrounds:
  // the Mediterranean of the Roman Empire). `widened` tells whether that bridged any gap.
  let widened = false;
  const bandsOf = (inner: boolean): Band[][] => crossings.map((byPart, k) => {
    const iv: { t0: number; t1: number; pi: number }[] = [];
    for (const [pi, c] of byPart) {
      c.sort((x, y) => x - y);
      for (let i = 0; i + 1 < c.length; i += 2) iv.push({ t0: c[i]!, t1: c[i + 1]!, pi });
    }
    iv.sort((x, y) => x.t0 - y.t0);
    const out: Band[] = [];
    for (let i = 0; i < iv.length; i++) {
      const v = iv[i]!;
      const prev = out[out.length - 1];
      const last = i > 0 ? iv[i - 1]! : null;
      // Bridged: a gap that is not other land, between two parts (a strait, a sea between
      // coasts) or inside one part when at most half as wide as the land on either side (a
      // bay like the Bohai Gulf; not the Gulf of Thailand or the sea inside a coastline).
      const gapT = last ? v.t0 - last.t1 : 0;
      const narrow = !!last && (last.pi !== v.pi || gapT <= BAY_SHARE * Math.min(last.t1 - last.t0, v.t1 - v.t0));
      const bridge =
        prev && last && gapT > 0 &&
        (narrow || inner) &&
        !(isOther && [0.25, 0.5, 0.75].some((f) => isOther(...toLonLat(stations[k]!, last.t1 + f * gapT))));
      if (bridge && !narrow) widened = true;
      if (prev && (bridge || v.t0 <= prev.t1)) {
        prev.t1 = Math.max(prev.t1, v.t1);
        prev.land += v.t1 - v.t0;
      } else out.push({ t0: v.t0, t1: v.t1, land: v.t1 - v.t0 });
    }
    return out;
  });
  const widest = (list: Band[]): Band | null => list.reduce<Band | null>((b, x) => (!b || x.land > b.land ? x : b), null);
  // The arc along the bands as the bay rule leaves them, and, for a polity around an inner
  // sea, the arc with that sea bridged; the one holding the larger name wins (how large a
  // name it holds, a little less for each share of it over water). Otherwise a ring of
  // land like the Roman Empire was named along one arm in some years and across its sea in
  // others, as small changes of its borders tipped the choice of arm.
  const strict = bestArc(bandsOf(false));
  widened = false;
  const open = isOther ? bandsOf(true) : null;
  const wide = open && widened ? bestArc(open) : null;
  const nameScore = (l: NameArc): number =>
    Math.min(NAME_HEIGHT_SHARE * l.widthKm, NAME_LENGTH_SHARE * l.lengthKm) * (0.6 + (0.4 * l.onBody.filter(Boolean).length) / l.onBody.length);
  const best = strict && wide ? (nameScore(wide) > nameScore(strict) ? wide : strict) : (strict ?? wide);
  return best;

  function bestArc(bands: Band[][]): NameArc | null {
  // Seeds: the scan lines with the widest bands (the middle half of the axis preferred: a
  // long thin tail is not the body). Each is followed outward; the chain with the most land
  // wins (a single wide scan line on a minor lobe does not decide).
  const seeds = bands
    .map((list, k) => ({ k, land: (widest(list)?.land ?? 0) * (Math.abs(k - (STATIONS - 1) / 2) <= STATIONS / 4 ? 1 : 0.6) }))
    .filter((x) => x.land > 0)
    .sort((x, y) => y.land - x.land)
    .slice(0, SEEDS);
  if (!seeds.length) return null;
  const overlap = (x: Band, y: Band): number => Math.min(x.t1, y.t1) - Math.max(x.t0, y.t0);
  const mid = (x: Band): number => (x.t0 + x.t1) / 2;
  // Follow one band outward from a seed (the one overlapping the previous most) while it
  // keeps at least 18 % of the seed's land, crossing at most MAX_DIP weaker or empty scan
  // lines in a row (a thin coast, a strait between islands). Where the band ends it may hop
  // to a band across open sea within the body's gap (the next island of an archipelago),
  // never across other land, so a horseshoe-shaped polity is named along one arm.
  const follow = (seedK: number): { chosen: (Band | null)[]; a: number; b: number; land: number } => {
    const chosen: (Band | null)[] = bands.map(() => null);
    chosen[seedK] = widest(bands[seedK]!);
    const minLand = 0.18 * chosen[seedK]!.land;
    let a = seedK;
    let b = seedK;
    for (const dir of [-1, 1]) {
      let prev = chosen[seedK]!;
      let prevK = seedK;
      let dip = 0;
      for (let k = seedK + dir; k >= 0 && k < STATIONS; k += dir) {
        let pick: Band | null = null;
        for (const c of bands[k]!) if (overlap(c, prev) > 0 && (!pick || overlap(c, prev) > overlap(pick, prev))) pick = c;
        if (!pick && isOther) {
          const p0 = mid(prev);
          const apart = (c: Band): number => Math.max(0, c.t0 - prev.t1, prev.t0 - c.t1);
          for (const c of bands[k]!) {
            const p1 = mid(c);
            if (apart(c) > gapKm || (pick && apart(c) >= apart(pick))) continue;
            const overSea = [0.25, 0.5, 0.75].every((f) => !isOther(...toLonLat(stations[prevK]! + f * (stations[k]! - stations[prevK]!), p0 + f * (p1 - p0))));
            if (overSea) pick = c;
          }
        }
        if (!pick) {
          // No land on this scan line counts as weak; land that does not continue the band ends it.
          if (bands[k]!.length || ++dip > MAX_DIP) break;
          continue;
        }
        chosen[k] = pick;
        prev = pick;
        prevK = k;
        if (pick.land >= minLand) {
          dip = 0;
          if (dir < 0) a = k;
          else b = k;
        } else if (++dip > MAX_DIP) break;
      }
    }
    let land = 0;
    for (let k = a; k <= b; k++) land += chosen[k]?.land ?? 0;
    return { chosen, a, b, land };
  };
  // Each seed's chain is fitted; the arc with the most length over the polity's own land
  // wins (not the chain with the most land: one that switches between two bands of a
  // horseshoe would fit a curve through the sea or a neighbour between them).
  let bestLine: (NameArc & { score: number }) | null = null;
  for (const x of seeds) {
    const { chosen, a, b } = follow(x.k);
    if (b - a < 2) continue;
    const line = fitBands(chosen, a, b);
    if (line && (!bestLine || line.score > bestLine.score)) bestLine = line;
  }
  if (!bestLine) return null;
  const { score: _score, ...line } = bestLine;
  return line;
  }

  function fitBands(chosen: (Band | null)[], a: number, b: number): (NameArc & { score: number }) | null {
    // Weighted least-squares quadratic t(s) through the middles of the chosen bands.
    const pts = [];
    for (let k = a; k <= b; k++) {
      const c = chosen[k];
      if (c && c.land > 0) pts.push({ s: stations[k]!, t: (c.t0 + c.t1) / 2, w: c.land });
    }
    const sMid = (stations[a]! + stations[b]!) / 2;
    const sHalf = (stations[b]! - stations[a]!) / 2 || 1;
    // Normal equations in a normalised s (−1..1) for stability.
    let n0 = 0, n1 = 0, n2 = 0, n3 = 0, n4 = 0, r0 = 0, r1 = 0, r2 = 0;
    for (const p of pts) {
      const x = (p.s - sMid) / sHalf;
      const w = p.w;
      n0 += w;
      n1 += w * x;
      n2 += w * x * x;
      n3 += w * x * x * x;
      n4 += w * x * x * x * x;
      r0 += w * p.t;
      r1 += w * p.t * x;
      r2 += w * p.t * x * x;
    }
    const det3 = (m: number[]): number => m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
    const M = [n0, n1, n2, n1, n2, n3, n2, n3, n4];
    const D = det3(M);
    let c0 = r0 / n0;
    let c1 = 0;
    let c2 = 0;
    if (Math.abs(D) > 1e-12) {
      c0 = det3([r0, n1, n2, r1, n2, n3, r2, n3, n4]) / D;
      c1 = det3([n0, r0, n2, n1, r1, n3, n2, r2, n4]) / D;
      c2 = det3([n0, n1, r0, n1, n2, r1, n2, n3, r2]) / D;
    }
    // Keep it gentle: thick bodies (China, France: land about as wide as the span is long)
    // read along a nearly straight line, and only thin ones (Chile, Italy, Japan) bend with
    // their shape, where the bend keeps the name on land: at most TURN_COMPACT° of turn from
    // end to end at a width/length of 0.4 or more, TURN_LONG° at 0.2 or less.
    const landWidths = pts.map((q) => q.w).sort((x, y) => x - y);
    const thickness = landWidths[Math.floor(landWidths.length / 2)]! / (2 * sHalf);
    const turnDeg = TURN_COMPACT + (TURN_LONG - TURN_COMPACT) * Math.min(1, Math.max(0, (0.4 - thickness) / 0.2));
    const turn = (q: number): number => Math.abs(Math.atan((c1 + 2 * q) / sHalf) - Math.atan((c1 - 2 * q) / sHalf));
    const maxTurn = (turnDeg * Math.PI) / 180;
    if (turn(c2) > maxTurn) {
      let lo = 0;
      let hi = Math.abs(c2);
      for (let i = 0; i < 30; i++) {
        const m = (lo + hi) / 2;
        if (turn(m) > maxTurn) hi = m;
        else lo = m;
      }
      c2 = Math.sign(c2) * lo;
      // With the bend reduced below what thin bodies are allowed, refit the offset and tilt
      // (weighted least squares on what the bend leaves), so a flattened U-shaped midline
      // runs through the middle of the body, not along the bottom of the U (China's middle,
      // not its southern half). Blended by how much the thickness rule lowered the limit:
      // thin bodies keep their curve's own offset (a refit would pull a crescent into its
      // hollow, off the land: Vietnam, Japan, Italy).
      const refit = (TURN_LONG - turnDeg) / (TURN_LONG - TURN_COMPACT);
      let w0 = 0, w1 = 0, w2 = 0, v0 = 0, v1 = 0;
      for (const q of pts) {
        const x = (q.s - sMid) / sHalf;
        const r = q.t - c2 * x * x;
        w0 += q.w;
        w1 += q.w * x;
        w2 += q.w * x * x;
        v0 += q.w * r;
        v1 += q.w * r * x;
      }
      const d = w0 * w2 - w1 * w1;
      if (refit > 0 && Math.abs(d) > 1e-12) {
        c0 += refit * ((v0 * w2 - v1 * w1) / d - c0);
        c1 += refit * ((v1 * w0 - v0 * w1) / d - c1);
      }
      // The refit tilt can change the turn a little; keep the bend within the limit.
      if (turn(c2) > maxTurn) {
        let a2 = 0;
        let b2 = Math.abs(c2);
        for (let i = 0; i < 30; i++) {
          const m = (a2 + b2) / 2;
          if (turn(m) > maxTurn) b2 = m;
          else a2 = m;
        }
        c2 = Math.sign(c2) * a2;
      }
    }

    // Trim the ends where the arc leaves its band (overshooting a coast: China's east end
    // over the Yellow Sea) or runs into a thin tip (Pakistan's north): stations whose room
    // to the band's edges is under TRIM_ROOM × the median room. At most 94 % of the span.
    const xAt = (k: number): number => (stations[k]! - sMid) / sHalf;
    const room: number[] = [];
    for (let k = a; k <= b; k++) {
      const c = chosen[k];
      const x = xAt(k);
      const t = c0 + c1 * x + c2 * x * x;
      room.push(c && t >= c.t0 && t <= c.t1 ? Math.min(t - c.t0, c.t1 - t) : 0);
    }
    const rooms = room.filter((r) => r > 0).sort((x, y) => x - y);
    let xa = -0.94;
    let xb = 0.94;
    if (rooms.length) {
      const enough = TRIM_ROOM * rooms[Math.floor(rooms.length / 2)]!;
      const first = room.findIndex((r) => r >= enough);
      const last = room.length - 1 - [...room].reverse().findIndex((r) => r >= enough);
      const half = step / sHalf / 2;
      xa = Math.max(-0.94, xAt(a + first) - half);
      xb = Math.min(0.94, xAt(a + last) + half);
      if (!(xb > xa)) return null;
    }
    const kept = pts.filter((q) => {
      const x = (q.s - sMid) / sHalf;
      return x >= xa - 1e-9 && x <= xb + 1e-9;
    });

    // Sample the kept span; back to lon/lat, noting which samples lie on the body.
    const local: [number, number][] = [];
    const onBody: boolean[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const x = xa + ((xb - xa) * i) / (SAMPLES - 1);
      const s = sMid + x * sHalf;
      const t = c0 + c1 * x + c2 * x * x;
      const px = cx + s * ux - t * uy;
      const py = cy + s * uy + t * ux;
      local.push([px, py]);
      onBody.push(body.some((part) => inPart(part, px, py)));
    }
    let lengthKm = 0;
    for (let i = 1; i < local.length; i++) lengthKm += Math.hypot(local[i]![0] - local[i - 1]![0], local[i]![1] - local[i - 1]![1]);
    let coords = local.map(([x, y]) => [lon0 + x / k0, lat0 + y / KM_PER_DEG] as [number, number]);
    if (coords.some(([lon, lat]) => !(lon >= -180 && lon <= 180 && lat >= -90 && lat <= 90))) return null;
    // Reads west to east (names.ts turns a name round when it would read upside down).
    if (coords[0]![0] > coords[coords.length - 1]![0]) {
      coords = coords.reverse();
      onBody.reverse();
    }
    const widths = (kept.length ? kept : pts).map((q) => q.w).sort((x, y) => x - y);
    const widthKm = widths[Math.floor(widths.length / 2)]!;
    return { coords, lengthKm, widthKm, onBody, score: lengthKm * (onBody.filter(Boolean).length / onBody.length) };
  }
}

/** One polygon part of a feature, for the grids below. */
interface IndexedPart { id: number; rings: Position[][]; box: [number, number, number, number] }

type PolygonFeature = { id: number; geometry: Polygon | MultiPolygon };

/** A 2° grid of polygon parts by bounding box: point tests and box queries touch a few parts. */
class PartGrid {
  private static readonly CELL = 2;
  private readonly grid = new Map<number, IndexedPart[]>();

  constructor(features: readonly PolygonFeature[]) {
    const C = PartGrid.CELL;
    for (const f of features) {
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      for (const rings of polys) {
        const outer = rings[0];
        if (!outer || outer.length < 4) continue;
        const box: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const q of outer) {
          box[0] = Math.min(box[0], q[0]!);
          box[1] = Math.min(box[1], q[1]!);
          box[2] = Math.max(box[2], q[0]!);
          box[3] = Math.max(box[3], q[1]!);
        }
        const part: IndexedPart = { id: f.id, rings, box };
        for (let cy = Math.floor((box[1] + 90) / C); cy <= Math.floor((box[3] + 90) / C); cy++) {
          for (let cx = Math.floor((box[0] + 180) / C); cx <= Math.floor((box[2] + 180) / C); cx++) {
            const list = this.grid.get(cy * 1000 + cx);
            if (list) list.push(part);
            else this.grid.set(cy * 1000 + cx, [part]);
          }
        }
      }
    }
  }

  /** Whether (lon, lat) lies in a part of any feature but `except` (even-odd over its rings). */
  contains(lon: number, lat: number, except?: number): boolean {
    const C = PartGrid.CELL;
    const x = ((((lon + 180) % 360) + 360) % 360) - 180;
    const list = this.grid.get(Math.floor((lat + 90) / C) * 1000 + Math.floor((x + 180) / C));
    return !!list && list.some((part) => part.id !== except && inside(part, x, lat));
  }

  /** The parts whose bounding boxes meet a lon/lat box (w ≤ e, within −180..180). */
  near(w: number, s: number, e: number, n: number): IndexedPart[] {
    const C = PartGrid.CELL;
    const out = new Set<IndexedPart>();
    for (let cy = Math.floor((s + 90) / C); cy <= Math.floor((n + 90) / C); cy++) {
      for (let cx = Math.floor((w + 180) / C); cx <= Math.floor((e + 180) / C); cx++) {
        for (const part of this.grid.get(cy * 1000 + cx) ?? []) {
          if (part.box[0] <= e && part.box[2] >= w && part.box[1] <= n && part.box[3] >= s) out.add(part);
        }
      }
    }
    return [...out];
  }
}

function inside(part: IndexedPart, x: number, y: number): boolean {
  if (x < part.box[0] || x > part.box[2] || y < part.box[1] || y > part.box[3]) return false;
  let hit = false;
  for (const ring of part.rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const xi = ring[i]![0]!, yi = ring[i]![1]!, xj = ring[j]![0]!, yj = ring[j]![1]!;
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
    }
  }
  return hit;
}

/** A ring clipped to a lon/lat box (Sutherland–Hodgman; empty when it misses the box). */
export function clipRing(ring: readonly Position[], w: number, s: number, e: number, n: number): [number, number][] {
  let pts: [number, number][] = ring.map((q) => [q[0]!, q[1]!]);
  const edges: [(p: [number, number]) => boolean, (a: [number, number], b: [number, number]) => [number, number]][] = [
    [(p) => p[0] >= w, (a, b) => [w, a[1] + ((b[1] - a[1]) * (w - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= e, (a, b) => [e, a[1] + ((b[1] - a[1]) * (e - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= s, (a, b) => [a[0] + ((b[0] - a[0]) * (s - a[1])) / (b[1] - a[1]), s]],
    [(p) => p[1] <= n, (a, b) => [a[0] + ((b[0] - a[0]) * (n - a[1])) / (b[1] - a[1]), n]],
  ];
  for (const [keep, cut] of edges) {
    if (!pts.length) break;
    const out: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const cur = pts[i]!;
      const prev = pts[(i + pts.length - 1) % pts.length]!;
      if (keep(cur)) {
        if (!keep(prev)) out.push(cut(prev, cur));
        out.push(cur);
      } else if (keep(prev)) out.push(cut(prev, cur));
    }
    pts = out;
  }
  return pts.length >= 3 ? pts : [];
}

/**
 * An index of a frame's tier-0 land (polities and unclaimed land) for `nameArc`'s
 * `isOther`: `otherLand(features)(id)` says whether a point lies on land of any feature
 * but `id`. A 2° grid of part bounding boxes keeps each query to a few point-in-polygon
 * tests.
 */
export function otherLand(features: readonly { id: number; tier: number; geometry: Polygon | MultiPolygon }[]): (id: number) => OtherLandTest {
  const grid = new PartGrid(features.filter((f) => f.tier === 0));
  return (id) => (lon, lat) => grid.contains(lon, lat, id);
}

/** Land and water of a frame, for the ink of map names. */
export interface LandWater {
  /** Whether a point is water: on no tier-0 land, or in a lake. */
  water(lon: number, lat: number): boolean;
  /**
   * The shores within a lon/lat box (w ≤ e): every ring of tier-0 land and of the lakes
   * meeting it, clipped to it. Filled together with the even-odd rule they cover exactly
   * the land (lakes and the holes of enclaves cancel out).
   */
  shores(w: number, s: number, e: number, n: number): [number, number][][];
}

/** {@link LandWater} of a frame's tier-0 features and a set of lakes. */
export function landWater(
  features: readonly { id: number; tier: number; geometry: Polygon | MultiPolygon }[],
  lakes: readonly { geometry: Polygon | MultiPolygon | null }[] = [],
): LandWater {
  const land = new PartGrid(features.filter((f) => f.tier === 0));
  const water = new PartGrid(lakes.flatMap((f, i) => (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon' ? [{ id: i, geometry: f.geometry }] : [])));
  return {
    water: (lon, lat) => !land.contains(lon, lat) || water.contains(lon, lat),
    shores: (w, s, e, n) =>
      [...land.near(w, s, e, n), ...water.near(w, s, e, n)].flatMap((part) => part.rings.map((ring) => clipRing(ring, w, s, e, n)).filter((r) => r.length)),
  };
}

/** Map names of polities whose official names have no leading title to drop. */
const SHORT_NAMES: Readonly<Record<string, string>> = {
  'United States of America': 'United States',
  'Bosnia and Herzegovina': 'Bosnia',
  'Crown of Castile': 'Castile',
  'Vijayanagara Empire': 'Vijayanagara',
  'Ayutthaya Kingdom': 'Ayutthaya',
  'Khmer Empire': 'Khmer',
  'Union of Soviet Socialist Republics': 'Soviet Union',
  "People's Republic of China": 'China',
  'United Kingdoms of Sweden and Norway': 'Sweden–Norway',
  'Polish-Lithuanian Commonwealth': 'Poland–Lithuania',
  'United Mexican States': 'Mexico',
  'German Empire': 'Germany',
  'Weimar Republic': 'Germany',
  'Nazi Germany': 'Germany',
  'German Confederation': 'Germany',
  'French Third Republic': 'France',
  'French Fourth Republic': 'France',
  'French Second Republic': 'France',
  'Second French Empire': 'France',
  'First French Empire': 'France',
  'French First Republic': 'France',
  'Austrian Empire': 'Austria',
  'Russian Empire': 'Russia',
  'Russian Republic': 'Russia',
  'Ethiopian Empire': 'Ethiopia',
  'United Kingdom of Great Britain and Northern Ireland': 'United Kingdom',
  'United Kingdom': 'Britain',
};

const TITLES = [
  'Federated Republic of',
  'Islamic Republic of',
  "People's Republic of",
  'Socialist Republic of',
  'Arab Republic of',
  'United Republic of',
  'Oriental Republic of',
  'Bolivarian Republic of',
  'Plurinational State of',
  'Kingdom of the',
  'Kingdom of',
  'Empire of the',
  'Empire of',
  'Republic of the',
  'Republic of',
  'Federal Republic of',
  'Democratic Republic of the',
  'Grand Principality of',
  'Principality of',
  'Grand Duchy of',
  'Duchy of',
  'Archduchy of',
  'Electorate of',
  'County of',
  'Margraviate of',
  'Tsardom of',
  'Sultanate of',
  'Emirate of',
  'Khanate of',
  'Imamate of',
  'Caliphate of',
  'Shogunate of',
  'State of',
  'Commonwealth of',
  'Confederation of',
];

/**
 * A shorter form of a polity's name on the map, or null: a common map name for
 * some long official names ("German Empire" → "Germany", "United States of America" →
 * "United States"), else a leading title dropped ("Kingdom of Spain" → "Spain", "Bourbon
 * Kingdom of France" → "France", "Empire of Japan" → "Japan"), and "United Kingdom of …"
 * becomes "United Kingdom". The map shows it in place of the full name (names.ts);
 * hover, search and lists keep the full name.
 */
export function shortName(name: string): string | null {
  // A trailing parenthetical is a note for hover and search, not part of the map name:
  // "Crimea (annexed by Russia; claimed by Ukraine)" → "Crimea".
  const bare = name.replace(/\s*\([^()]*\)\s*$/, '').trim();
  if (bare && bare !== name.trim()) return shortName(bare) ?? bare;
  const n = name.trim();
  if (SHORT_NAMES[n]) return SHORT_NAMES[n]!;
  if (/^United Kingdom of /i.test(n)) return 'United Kingdom';
  for (const t of TITLES) {
    // The title at the start, or after one leading word (a dynasty: "Bourbon Kingdom of France").
    const m = new RegExp(`^(?:[A-Z][\\p{L}'-]+ )?${t} (.+)$`, 'u').exec(n);
    if (m && m[1]!.trim().length >= 2 && !/^(?:the|of|and)$/i.test(m[1]!.trim())) return m[1]!.trim();
  }
  return null;
}
