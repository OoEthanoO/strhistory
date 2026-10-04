// Curved labels in the manner of grand-strategy maps: each polity's name follows a gentle
// arc through the middle of its largest part, along its long axis, and is spread out to
// span it. Pure functions (no MapLibre): `labelLine` finds the arc, `labelSizing` the
// type size and letter spacing per zoom. BorderLayers turns them into line-placed labels.
import type { MultiPolygon, Polygon, Position } from '@alexs-atlas/borders';

/** Kilometres per degree of latitude (and of longitude at the equator). */
const KM_PER_DEG = 111.32;
/** Scan lines across the long axis. */
const STATIONS = 32;
/** Points of the returned arc. */
const SAMPLES = 24;

export interface LabelLine {
  /** lon/lat along the arc, west end first (the label reads from it). */
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

/** Parts within this share of the largest part's size (√area) of the label body join it, … */
const BODY_GAP_SHARE = 0.25;
/** … and always those within this distance (km). */
const BODY_GAP_MIN_KM = 100;
/** Parts smaller than this share of the largest part are left out of the label body (islets, exclaves). */
const BODY_MIN_SHARE = 0.02;
/** Vertices compared per part when measuring the distance between two parts. */
const GAP_VERTICES = 400;
/** Weak scan lines (under 18 % of the seed's land) an arc may cross in a row. */
const MAX_DIP = 3;
/** Seeds (widest scan lines) tried when choosing the band an arc follows. */
const SEEDS = 4;
/** A gap inside one part is bridged when at most this share of the land on either side (a bay). */
const BAY_SHARE = 0.5;
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

/**
 * The label arc of a polity, as a quadratic curve along the principal axis of its main
 * body (so it bends with the shape, never wiggles). The body is the largest part plus the
 * parts near it (`BODY_*`, by single linkage over the real distance between parts: the
 * Eastern Roman Empire's coasts around the Mediterranean, Japan's main islands). On each
 * scan line across the axis the body's land comes in bands; a gap between two bands is
 * bridged unless `isOther` says it is land of another polity or unclaimed land, and only
 * between two parts (a sea, a strait) or, inside one part, when it is at most half as wide
 * as the land on either side (a bay, China's Bohai Gulf). The arc follows one band from the
 * widest scan lines outward (the one overlapping the previous most; of `SEEDS` starts, the
 * chain with the most land wins) while it keeps at least 18 % of that land, crossing at
 * most `MAX_DIP` weak or empty scan lines in a row; where it ends it may hop across open
 * sea to the next island, never across other land (a horseshoe-shaped polity is labelled
 * along one arm).
 * `onBody` marks which points of the arc lie on the body. Null when the body is too small
 * or degenerate; a body whose arc would cross the antimeridian falls back to its largest
 * part.
 */
export function labelLine(geometry: Polygon | MultiPolygon, isOther?: OtherLandTest): LabelLine | null {
  const parts: Position[][][] = (geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates).filter((p) => p[0] && p[0].length >= 4);
  // The largest part (outer ring minus holes, in its own local plane) anchors one local
  // plane (km) for the whole body and seeds it.
  let ref = -1;
  let refArea = 0;
  let lon0 = 0;
  let lat0 = 0;
  parts.forEach((part, i) => {
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
    const own = (ring: Position[]): [number, number][] => ring.map((q) => [(((q[0]! - cLon + 540) % 360) - 180) * k, (q[1]! - cLat) * KM_PER_DEG]);
    const area = Math.abs(ringArea(own(outer))) - part.slice(1).reduce((sum, h) => sum + Math.abs(ringArea(own(h))), 0);
    if (area > refArea) {
      refArea = area;
      ref = i;
      lon0 = cLon;
      lat0 = cLat;
    }
  });
  if (ref < 0) return null;
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
  if (!seed) return null;
  // Parts that, unwrapped around the seed, lie beyond ±180° (across the antimeridian from
  // it) would put the arc out of range: kept out.
  const others = parts
    .filter((_, i) => i !== ref)
    .map(toPart)
    .filter((q): q is BodyPart => !!q && q.area >= BODY_MIN_SHARE * seed.area && lon0 + q.box[0] / k0 >= -180 && lon0 + q.box[2] / k0 <= 180);
  const gap = Math.max(BODY_GAP_MIN_KM, BODY_GAP_SHARE * Math.sqrt(seed.area));
  const boxGap = (a: BodyPart['box'], b: BodyPart['box']): number => Math.hypot(Math.max(0, a[0] - b[2], b[0] - a[2]), Math.max(0, a[1] - b[3], b[1] - a[3]));
  const body: BodyPart[] = [seed];
  let rest = others;
  for (let grew = true; grew; ) {
    grew = false;
    rest = rest.filter((q) => {
      if (!body.some((m) => boxGap(q.box, m.box) <= gap && partGap(q, m) <= gap)) return true;
      body.push(q);
      grew = true;
      return false;
    });
  }
  return arcOfBody(body, lon0, lat0, k0, gap, isOther) ?? (body.length > 1 ? arcOfBody([seed], lon0, lat0, k0, gap, isOther) : null);
}

function arcOfBody(body: BodyPart[], lon0: number, lat0: number, k0: number, gapKm: number, isOther?: OtherLandTest): LabelLine | null {
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
  const bands: Band[][] = crossings.map((byPart, k) => {
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
      const bridge =
        prev && last && gapT > 0 &&
        (last.pi !== v.pi || gapT <= BAY_SHARE * Math.min(last.t1 - last.t0, v.t1 - v.t0)) &&
        !(isOther && [0.25, 0.5, 0.75].some((f) => isOther(...toLonLat(stations[k]!, last.t1 + f * gapT))));
      if (prev && (bridge || v.t0 <= prev.t1)) {
        prev.t1 = Math.max(prev.t1, v.t1);
        prev.land += v.t1 - v.t0;
      } else out.push({ t0: v.t0, t1: v.t1, land: v.t1 - v.t0 });
    }
    return out;
  });
  const widest = (list: Band[]): Band | null => list.reduce<Band | null>((b, x) => (!b || x.land > b.land ? x : b), null);
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
  // never across other land, so a horseshoe-shaped polity is labelled along one arm.
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
  let bestLine: (LabelLine & { score: number }) | null = null;
  for (const x of seeds) {
    const { chosen, a, b } = follow(x.k);
    if (b - a < 2) continue;
    const line = fitBands(chosen, a, b);
    if (line && (!bestLine || line.score > bestLine.score)) bestLine = line;
  }
  if (!bestLine) return null;
  const { score: _score, ...line } = bestLine;
  return line;

  function fitBands(chosen: (Band | null)[], a: number, b: number): (LabelLine & { score: number }) | null {
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

  // Sample 94 % of the span; back to lon/lat, noting which samples lie on the body.
    const local: [number, number][] = [];
    const onBody: boolean[] = [];
    for (let i = 0; i < SAMPLES; i++) {
      const x = -0.94 + (1.88 * i) / (SAMPLES - 1);
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
    // Reads west to east (MapLibre keeps line labels upright on its own).
    if (coords[0]![0] > coords[coords.length - 1]![0]) {
      coords = coords.reverse();
      onBody.reverse();
    }
    const widths = pts.map((q) => q.w).sort((x, y) => x - y);
    const widthKm = widths[Math.floor(widths.length / 2)]!;
    return { coords, lengthKm, widthKm, onBody, score: lengthKm * (onBody.filter(Boolean).length / onBody.length) };
  }
}

/**
 * The arc with straight lead-ins along its end tangents, `extra` × its length at each end
 * (or `[head, tail]` shares: unequal lead-ins move the line's middle, where MapLibre
 * centres the name, along the arc; null where they would leave lon/lat range). MapLibre checks that a name fits its line
 * at the whole tile zoom, where the line is up to 2× shorter than on screen, but draws it
 * centred along the line as projected on screen: the lead-ins pass that check for any
 * name that fits the arc on screen and are never drawn under it. Lengths are measured in
 * Web Mercator, as MapLibre measures lines in tile units, so both lead-ins are equally
 * long there and the line's middle (where the name is centred) stays the arc's middle.
 */
export function extendLine(coords: readonly [number, number][], extra: number | readonly [head: number, tail: number]): [number, number][] | null {
  const [headExtra, tailExtra] = typeof extra === 'number' ? [extra, extra] : extra;
  if (coords.length < 2 || !(headExtra > 0 || tailExtra > 0)) return coords.slice();
  const toY = (lat: number): number => (Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360)) * 180) / Math.PI;
  const toLat = (y: number): number => ((2 * Math.atan(Math.exp((y * Math.PI) / 180)) - Math.PI / 2) * 180) / Math.PI;
  const m = coords.map(([lon, lat]) => [lon, toY(lat)] as [number, number]);
  let length = 0;
  for (let i = 1; i < m.length; i++) length += Math.hypot(m[i]![0] - m[i - 1]![0], m[i]![1] - m[i - 1]![1]);
  const lead = (end: [number, number], inner: [number, number], share: number): [number, number] | null => {
    const dx = end[0] - inner[0];
    const dy = end[1] - inner[1];
    const d = Math.hypot(dx, dy);
    if (!(d > 0)) return null;
    const lon = end[0] + (dx / d) * share * length;
    const lat = toLat(end[1] + (dy / d) * share * length);
    return lon >= -180 && lon <= 180 && lat >= -85 && lat <= 85 ? [lon, lat] : null;
  };
  const n = m.length;
  const head = headExtra > 0 ? lead(m[0]!, m[1]!, headExtra) : undefined;
  const tail = tailExtra > 0 ? lead(m[n - 1]!, m[n - 2]!, tailExtra) : undefined;
  if (head === null || tail === null) return null;
  return [...(head ? [head] : []), ...coords, ...(tail ? [tail] : [])];
}

/** One polygon part of a frame feature, for {@link otherLand}. */
interface IndexedPart { id: number; rings: Position[][]; box: [number, number, number, number] }

/**
 * An index of a frame's tier-0 land (polities and unclaimed land) for `labelLine`'s
 * `isOther`: `otherLand(features)(id)` says whether a point lies on land of any feature
 * but `id`. A 2° grid of part bounding boxes keeps each query to a few point-in-polygon
 * tests.
 */
export function otherLand(features: readonly { id: number; tier: number; geometry: Polygon | MultiPolygon }[]): (id: number) => OtherLandTest {
  const CELL = 2;
  const grid = new Map<number, IndexedPart[]>();
  const cellKey = (cx: number, cy: number): number => cy * 1000 + cx;
  for (const f of features) {
    if (f.tier !== 0) continue;
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
      for (let cy = Math.floor((box[1] + 90) / CELL); cy <= Math.floor((box[3] + 90) / CELL); cy++) {
        for (let cx = Math.floor((box[0] + 180) / CELL); cx <= Math.floor((box[2] + 180) / CELL); cx++) {
          const list = grid.get(cellKey(cx, cy));
          if (list) list.push(part);
          else grid.set(cellKey(cx, cy), [part]);
        }
      }
    }
  }
  const inside = (part: IndexedPart, x: number, y: number): boolean => {
    if (x < part.box[0] || x > part.box[2] || y < part.box[1] || y > part.box[3]) return false;
    let hit = false;
    for (const ring of part.rings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i]![0]!, yi = ring[i]![1]!, xj = ring[j]![0]!, yj = ring[j]![1]!;
        if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) hit = !hit;
      }
    }
    return hit;
  };
  return (id) => (lon, lat) => {
    const x = ((((lon + 180) % 360) + 360) % 360) - 180;
    const list = grid.get(cellKey(Math.floor((x + 180) / CELL), Math.floor((lat + 90) / CELL)));
    return !!list && list.some((part) => part.id !== id && inside(part, x, lat));
  };
}

/** Pixels per km at the globe's centre at zoom 0 (MapLibre: 512 px around the equator). */
export const PX_PER_KM_Z0 = 512 / 40075;

/** Curved-label typography: zoom growth, size limits and how far the name spans. */
export const CURVED_LABELS = {
  /**
   * Up to `fitZoom` (about the whole-globe view) a name spans its polity; beyond it labels
   * grow 2^(growth·Δzoom) while the map grows 2^Δzoom, so they get smaller relative to the
   * polity as you zoom in.
   */
  fitZoom: 2,
  growth: 0.6,
  /** Labels shrink with the map down to this size (px), then keep it. */
  minPx: 9,
  /** The short form of a name (`shortLabelName`) is used once it reads this many times larger. */
  shortGain: 1.5,
  /** A name held at minPx may run up to this many times its arc's length (beyond it, over its neighbours, it is left out). */
  maxOverflow: 1.5,
  /** Letter spacing reaches maxSpacing from this size (px); smaller type is spread less (0.15× at minPx), so its letters still read as a word. */
  spacingFullPx: 14,
  /** A name held at minPx is left out within this many degrees of the horizon (near the rim it would only smear) … */
  heldRimMargin: 25,
  /** … or when less than this share of its text lies over its own land (it would spill over the sea and its neighbours). */
  heldOnLand: 0.6,
  /** Names slide along their arcs onto the part of the globe this many degrees inside the view's edge or the horizon. */
  viewMargin: 10,
  /** A name slides along its arc only when that puts at least this much more of it over its own land. */
  slideGain: 0.1,
  /** No labels while the globe is shown smaller than this × the view's smaller side (zoomed out). */
  hideBelowScale: 0.5,
  /** Lead-ins added at each end of an arc for MapLibre's layout (× the arc's length; extendLine). */
  leadIn: 0.5,
  maxPx: 30,
  /** Share of the arc the name spans, and its height at most this share of the polity's width. */
  span: 0.8,
  heightShare: 0.42,
  /** Average advance of an upper-case letter (em; generous, so names fit their arcs) and the widest letter spacing (em). */
  capAdvance: 0.74,
  maxSpacing: 2,
} as const;

export interface LabelSizing {
  /** Type size (km on the ground) at which the name spans the arc. */
  sizeKm: number;
  /** First integer zoom at which the label reaches `minPx`. */
  minZoom: number;
}

/** Type size for `name` on `line` (null: the name has no letters to place). */
export function labelSizing(name: string, line: Pick<LabelLine, 'lengthKm' | 'widthKm'>): LabelSizing | null {
  const n = [...name.trim()].length;
  if (!n || !(line.lengthKm > 0)) return null;
  const T = CURVED_LABELS;
  const sizeKm = Math.min(T.heightShare * line.widthKm, (T.span * line.lengthKm) / (n * T.capAdvance));
  if (!(sizeKm > 0)) return null;
  // The first integer zoom at which labelPx(sizeKm, z) ≥ minPx.
  let minZoom = 0;
  while (minZoom < 24 && labelPx(sizeKm, minZoom) < T.minPx) minZoom++;
  return { sizeKm, minZoom };
}

/** Pixels per km of a label at zoom `z`: the map's scale up to fitZoom, slower growth beyond. */
export function labelScale(z: number): number {
  const T = CURVED_LABELS;
  return PX_PER_KM_Z0 * (z <= T.fitZoom ? 2 ** z : 2 ** T.fitZoom * 2 ** (T.growth * (z - T.fitZoom)));
}

/** Text size (px) of a label of `sizeKm` at zoom `z` (capped at maxPx). */
export function labelPx(sizeKm: number, z: number): number {
  return Math.min(CURVED_LABELS.maxPx, sizeKm * labelScale(z));
}

/**
 * Letter spacing (em) that spreads `n` letters at `px` over `spanPx` (clamped to 0..maxSpacing,
 * less for small type: see `spacingFullPx`).
 */
export function labelSpacing(n: number, px: number, spanPx: number): number {
  if (n < 2 || !(px > 0)) return 0;
  const T = CURVED_LABELS;
  const s = (spanPx / px - n * T.capAdvance) / (n - 1);
  const share = Math.min(1, Math.max(0.15, (px - T.minPx) / (T.spacingFullPx - T.minPx)));
  return Math.min(T.maxSpacing * share, Math.max(0, s));
}

/** Leading titles a map label may drop when the full name does not fit (as on game maps). */
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
 * A shorter form of a polity's name for its map label, or null: a common map name for
 * some long official names ("German Empire" → "Germany", "United States of America" →
 * "United States"), else a leading title dropped ("Kingdom of Spain" → "Spain", "Bourbon
 * Kingdom of France" → "France", "Empire of Japan" → "Japan"), and "United Kingdom of …"
 * becomes "United Kingdom". Only used when the full name does not fit; hover, search and
 * lists keep the full name.
 */
export function shortLabelName(name: string): string | null {
  // A trailing parenthetical is a note for hover and search, not part of the map name:
  // "Crimea (annexed by Russia; claimed by Ukraine)" → "Crimea".
  const bare = name.replace(/\s*\([^()]*\)\s*$/, '').trim();
  if (bare && bare !== name.trim()) return shortLabelName(bare) ?? bare;
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
