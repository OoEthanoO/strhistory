import { describe, expect, it } from 'vitest';
import { makeStars, projectStars, rimFadeFactor, type ProjectedStar, type SkyView, type StarCatalog } from './sky.js';

// 800 × 600 canvas, MapLibre's default 36.87° vertical field of view: focal length
// f = 300 / tan(18.435°) = 900 px.
const F = 900;
const view = (lon: number, lat: number): SkyView => ({ lon, lat, fovY: 36.87, width: 800, height: 600, cx: 400, cy: 300 });

/** A catalogue with one bright star in direction (x, y, z). */
function star(x: number, y: number, z: number): StarCatalog {
  const n = Math.hypot(x, y, z);
  return { count: 1, dir: new Float32Array([x / n, y / n, z / n]), alpha: new Float32Array([1]), radius: new Float32Array([1]), tint: new Uint8Array([0]) };
}

function project(cat: StarCatalog, v: SkyView, disc: { x: number; y: number; r: number } | null = null): ProjectedStar[] {
  const out: ProjectedStar[] = [];
  projectStars(cat, v, disc, (s) => out.push(s));
  return out;
}

describe('makeStars', () => {
  it('is deterministic per seed, with unit directions and the documented ranges', () => {
    const a = makeStars(500, 3);
    expect(makeStars(500, 3)).toEqual(a);
    expect(makeStars(500, 4).dir).not.toEqual(a.dir);
    for (let i = 0; i < a.count; i++) {
      expect(Math.hypot(a.dir[3 * i]!, a.dir[3 * i + 1]!, a.dir[3 * i + 2]!)).toBeCloseTo(1, 5);
      expect(a.alpha[i]).toBeGreaterThanOrEqual(0.14 - 1e-6);
      expect(a.alpha[i]).toBeLessThanOrEqual(0.62 + 1e-6);
      expect(a.radius[i]).toBeGreaterThanOrEqual(0.5 - 1e-6);
      expect(a.radius[i]).toBeLessThanOrEqual(1.4 + 1e-6);
      expect(a.tint[i]).toBeLessThan(3);
    }
  });

  it('makes mostly faint stars and a few brighter ones', () => {
    const s = makeStars(4000);
    const faint = s.alpha.filter((x) => x < 0.25).length / s.count;
    const bright = s.alpha.filter((x) => x > 0.5).length / s.count;
    expect(faint).toBeGreaterThan(0.6);
    expect(bright).toBeGreaterThan(0.005);
    expect(bright).toBeLessThan(0.1);
  });
});

describe('projectStars', () => {
  it('puts the star straight ahead (through the Earth) at the principal point', () => {
    // Centre 0°/0°: the camera is above (1, 0, 0) looking along −x.
    const [s] = project(star(-1, 0, 0), view(0, 0));
    expect(s!.x).toBeCloseTo(400, 6);
    expect(s!.y).toBeCloseTo(300, 6);
  });

  it('drops stars behind the camera and outside the canvas', () => {
    expect(project(star(1, 0, 0), view(0, 0))).toEqual([]);
    expect(project(star(-1, 2, 0), view(0, 0))).toEqual([]); // 63° to the east: x = 400 + 1800
  });

  it('maps east to screen right and north to screen up, by the pinhole projection', () => {
    const [e] = project(star(-1, 0.1, 0), view(0, 0)); // 0.1 rad-ish towards +y = east at lon 0
    expect(e!.x).toBeCloseTo(400 + F * 0.1, 3);
    expect(e!.y).toBeCloseTo(300, 6);
    const [n] = project(star(-1, 0, 0.1), view(0, 0));
    expect(n!.x).toBeCloseTo(400, 6);
    expect(n!.y).toBeCloseTo(300 - F * 0.1, 3);
  });

  it('moves the sky opposite to the surface when the camera orbits, as in a 3D scene', () => {
    // The map centre moving 10° east (the surface slides left) moves a fixed star right
    // by f·tan(10°); moving 10° north (the surface slides down) moves it up as much.
    const fixed = star(-1, 0, 0);
    const [east] = project(fixed, view(10, 0));
    expect(east!.x).toBeCloseTo(400 + F * Math.tan((10 * Math.PI) / 180), 2);
    expect(east!.y).toBeCloseTo(300, 6);
    const [north] = project(fixed, view(0, 10));
    expect(north!.x).toBeCloseTo(400, 6);
    expect(north!.y).toBeCloseTo(300 - F * Math.tan((10 * Math.PI) / 180), 2);
  });

  it('hides stars on the globe and fades them near its rim', () => {
    const disc = { x: 400, y: 300, r: 100 };
    expect(project(star(-1, 0, 0), view(0, 0), disc)).toEqual([]); // behind the globe
    const [near] = project(star(-1, 0.13, 0), view(0, 0), disc); // 1.17 R from the centre
    const [far] = project(star(-1, 0.3, 0), view(0, 0), disc); // 2.7 R
    expect(near!.alpha).toBeGreaterThan(0);
    expect(near!.alpha).toBeLessThan(0.3);
    expect(far!.alpha).toBe(1); // the test star is bright: full alpha 1 beyond the fade
  });
});

describe('rimFadeFactor', () => {
  const disc = { x: 0, y: 0, r: 100 };
  it('is 0 inside the disc, 1 from 1.75 radii and rises smoothly between', () => {
    expect(rimFadeFactor(5, 5, null)).toBe(1);
    expect(rimFadeFactor(50, 0, disc)).toBe(0);
    expect(rimFadeFactor(100, 0, disc)).toBe(0);
    expect(rimFadeFactor(175, 0, disc)).toBe(1);
    expect(rimFadeFactor(0, 400, disc)).toBe(1);
    let prev = 0;
    for (let d = 100; d <= 175; d += 5) {
      const v = rimFadeFactor(d, 0, disc);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
    expect(rimFadeFactor(137.5, 0, disc)).toBeCloseTo(0.5, 6);
  });
});
