// The star field: stars at infinity, fixed in space, drawn on a canvas under MapLibre's
// transparent canvas with the camera's own orientation and field of view. Turning the
// globe moves MapLibre's camera around the Earth, so the stars move as in a 3D scene:
// they stay put in space and slide across the screen as the camera orbits (the opposite
// way to the globe's surface). Faint stars far outnumber bright ones, and stars fade out
// towards the globe's rim. Pure maths + a small canvas painter; the map supplies the view.
import type { Disc } from './rim.js';

/** A star catalogue: unit vectors (x, y, z), brightness (0..1), radius (px) and tint index. */
export interface StarCatalog {
  count: number;
  dir: Float32Array; // 3 per star
  alpha: Float32Array;
  radius: Float32Array;
  tint: Uint8Array;
}

/** Star colours: white, a cool blue-white and a warm white. */
export const STAR_TINTS = ['255, 255, 255', '206, 222, 255', '255, 238, 214'] as const;

/** Small, fast, seeded PRNG (mulberry32): the same sky on every visit. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * `count` stars spread evenly over the sky. Brightness follows a steep power law, so most
 * stars are faint and a few brighter: alpha 0.14–0.62, radius 0.5–1.4 px (a quiet sky:
 * the faintest still show on a near-black page, none glare).
 */
export function makeStars(count = 26000, seed = 1947): StarCatalog {
  const rnd = prng(seed);
  const dir = new Float32Array(count * 3);
  const alpha = new Float32Array(count);
  const radius = new Float32Array(count);
  const tint = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    // Uniform on the sphere: z uniform in [-1, 1], longitude uniform.
    const z = 2 * rnd() - 1;
    const t = 2 * Math.PI * rnd();
    const s = Math.sqrt(Math.max(0, 1 - z * z));
    dir[3 * i] = s * Math.cos(t);
    dir[3 * i + 1] = s * Math.sin(t);
    dir[3 * i + 2] = z;
    const b = rnd() ** 5; // mostly near 0: faint
    alpha[i] = 0.14 + 0.48 * b ** 0.8;
    radius[i] = 0.5 + 0.9 * b;
    const c = rnd();
    tint[i] = c < 0.72 ? 0 : c < 0.88 ? 1 : 2;
  }
  return { count, dir, alpha, radius, tint };
}

/** The camera: what the stars' projection needs from the map. */
export interface SkyView {
  /** Map centre (degrees): the camera sits above it, looking at the Earth's centre. */
  lon: number;
  lat: number;
  /** Vertical field of view (degrees), MapLibre's `getVerticalFieldOfView()`. */
  fovY: number;
  /** Canvas size (CSS px) and the principal point (the centre, moved by map padding). */
  width: number;
  height: number;
  cx: number;
  cy: number;
}

/** 0 at the globe's rim, rising smoothly to 1 at `fadeTo` × its radius. */
export function rimFadeFactor(px: number, py: number, disc: Disc | null, fadeTo = 1.75): number {
  if (!disc) return 1;
  const d = Math.hypot(px - disc.x, py - disc.y) / disc.r;
  if (d <= 1) return 0;
  if (d >= fadeTo) return 1;
  const t = (d - 1) / (fadeTo - 1);
  return t * t * (3 - 2 * t);
}

/** A star on screen. */
export interface ProjectedStar {
  x: number;
  y: number;
  alpha: number;
  radius: number;
  tint: number;
}

/**
 * Projects the catalogue into the view: the camera looks along −u (u = the unit vector
 * of the map centre), screen right = local east, screen up = local north (the globe is
 * always north-up). Stars behind the camera or outside the canvas are dropped; `disc`
 * (the globe's outline) fades the ones near the rim. Calls `emit` for each visible star.
 */
export function projectStars(cat: StarCatalog, v: SkyView, disc: Disc | null, emit: (s: ProjectedStar) => void): void {
  const lam = (v.lon * Math.PI) / 180;
  const phi = (v.lat * Math.PI) / 180;
  const cl = Math.cos(lam), sl = Math.sin(lam), cp = Math.cos(phi), sp = Math.sin(phi);
  // forward = −u, east, north
  const fx = -cp * cl, fy = -cp * sl, fz = -sp;
  const ex = -sl, ey = cl;
  const nx = -sp * cl, ny = -sp * sl, nz = cp;
  const f = v.height / 2 / Math.tan(((v.fovY * Math.PI) / 180) / 2);
  const margin = 3;
  const d = cat.dir;
  for (let i = 0; i < cat.count; i++) {
    const x = d[3 * i]!, y = d[3 * i + 1]!, z = d[3 * i + 2]!;
    const depth = x * fx + y * fy + z * fz;
    if (depth < 0.05) continue;
    const sx = v.cx + (f * (x * ex + y * ey)) / depth;
    const sy = v.cy - (f * (x * nx + y * ny + z * nz)) / depth;
    if (sx < -margin || sy < -margin || sx > v.width + margin || sy > v.height + margin) continue;
    const a = cat.alpha[i]! * rimFadeFactor(sx, sy, disc);
    if (a < 0.02) continue;
    emit({ x: sx, y: sy, alpha: a, radius: cat.radius[i]!, tint: cat.tint[i]! });
  }
}

/** Alpha levels the painter batches stars into (one fill per level and tint). */
const LEVELS = 12;

/**
 * Paints the visible stars on a 2D canvas sized `v.width` × `v.height` CSS px at `dpr`.
 * Stars are batched by tint and alpha level, so a frame is a few dozen fills.
 */
export function paintStars(ctx: CanvasRenderingContext2D, cat: StarCatalog, v: SkyView, disc: Disc | null, dpr: number): number {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, v.width, v.height);
  const buckets: ProjectedStar[][] = Array.from({ length: STAR_TINTS.length * LEVELS }, () => []);
  let n = 0;
  projectStars(cat, v, disc, (s) => {
    const level = Math.min(LEVELS - 1, Math.floor(s.alpha * LEVELS));
    buckets[s.tint * LEVELS + level]!.push(s);
    n++;
  });
  for (let b = 0; b < buckets.length; b++) {
    const list = buckets[b]!;
    if (!list.length) continue;
    const tint = STAR_TINTS[Math.floor(b / LEVELS)]!;
    const alpha = ((b % LEVELS) + 0.5) / LEVELS;
    ctx.fillStyle = `rgba(${tint}, ${alpha.toFixed(3)})`;
    ctx.beginPath();
    for (const s of list) {
      ctx.moveTo(s.x + s.radius, s.y);
      ctx.arc(s.x, s.y, s.radius, 0, Math.PI * 2);
    }
    ctx.fill();
  }
  return n;
}
