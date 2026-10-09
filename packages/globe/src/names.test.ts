import { describe, expect, it } from 'vitest';
import { landWater, type NameArc } from './name-arcs.js';
import {
  EARTH_KM,
  NAME_TYPE,
  angle,
  byRank,
  dot,
  facing,
  globeCamera,
  horizonAngle,
  layoutName,
  nameBlockers,
  projectPoint,
  pxPerRadian,
  readsTurned,
  rimAlpha,
  sizeAlpha,
  smoothstep,
  step,
  toLonLat,
  toVec,
  type CameraView,
  type NameMetrics,
  type PlacedName,
  type Vec3,
} from './names.js';

const RAD = Math.PI / 180;
/** Every letter 0.7 em wide, capitals 0.7 em tall. */
const M: NameMetrics = { advance: () => 0.7, capHeight: 0.7 };

type Arc = Pick<NameArc, 'coords' | 'lengthKm' | 'widthKm'>;

/** An arc along a parallel from lon0 to lon1 (degrees), `n` points, with the given polity width. */
function parallel(lon0: number, lon1: number, lat: number, widthKm: number, n = 24): Arc {
  const coords: [number, number][] = [];
  for (let i = 0; i < n; i++) coords.push([lon0 + ((lon1 - lon0) * i) / (n - 1), lat]);
  let lengthKm = 0;
  for (let i = 1; i < n; i++) lengthKm += EARTH_KM * angle(toVec(...coords[i - 1]!), toVec(...coords[i]!));
  return { coords, lengthKm, widthKm };
}

const close = (a: Vec3, b: Vec3, digits = 9): void => {
  for (let i = 0; i < 3; i++) expect(a[i]!).toBeCloseTo(b[i]!, digits);
};
const neg = (a: Vec3): Vec3 => [-a[0], -a[1], -a[2]];
const lonOf = (p: Vec3): number => toLonLat(p)[0];
/** Letter spacing (em) between two neighbouring glyphs of a name set with `M`. */
const spacingOf = (n: PlacedName, i = 0): number => angle(n.glyphs[i]!.p, n.glyphs[i + 1]!.p) / n.em - 0.7;

describe('vectors', () => {
  it('round-trips lon/lat through unit vectors', () => {
    for (const [lon, lat] of [[0, 0], [10, 20], [-75.5, 45.25], [179.9, -89.5], [-179.9, 89.5], [120, -33.3]] as const) {
      const p = toVec(lon, lat);
      expect(Math.hypot(...p)).toBeCloseTo(1, 12);
      const [lon2, lat2] = toLonLat(p);
      expect(lon2).toBeCloseTo(lon, 9);
      expect(lat2).toBeCloseTo(lat, 9);
    }
    close(toVec(0, 0), [1, 0, 0]);
    close(toVec(90, 0), [0, 1, 0]);
    close(toVec(0, 90), [0, 0, 1]);
  });

  it('steps along the sphere by about the given angle', () => {
    const p = toVec(10, 20);
    const east: Vec3 = [-Math.sin(10 * RAD), Math.cos(10 * RAD), 0];
    const q = step(p, east, 0.01);
    expect(Math.hypot(...q)).toBeCloseTo(1, 12);
    expect(angle(p, q)).toBeCloseTo(0.01, 6);
    expect(lonOf(q)).toBeGreaterThan(10);
    expect(angle(toVec(0, 0), toVec(1e-6, 0))).toBeCloseTo(1e-6 * RAD, 15); // precise for tiny angles
  });
});

describe('layoutName', () => {
  const arc = parallel(0, 20, 0, 2000); // a wide polity along the equator
  const name = layoutName('fr', 'France', 0, arc, M)!;

  it('sets the name in capitals, one glyph per letter, spaces left out', () => {
    expect(name).not.toBeNull();
    expect(name.key).toBe('fr');
    expect(name.text).toBe('France');
    expect(name.glyphs.map((g) => g.ch).join('')).toBe('FRANCE');
    const us = layoutName('us', 'United States', 0, parallel(-120, -75, 40, 2500), { advance: (ch) => (ch === ' ' ? 0.3 : 0.7), capHeight: 0.7 })!;
    expect(us.glyphs.map((g) => g.ch).join('')).toBe('UNITEDSTATES');
    // The space keeps its advance: the gap across it is wider than between two letters.
    expect(angle(us.glyphs[5]!.p, us.glyphs[6]!.p)).toBeGreaterThan(angle(us.glyphs[4]!.p, us.glyphs[5]!.p) * 1.1);
  });

  it('centres the name on its arc, reading west to east', () => {
    const first = name.glyphs[0]!;
    const last = name.glyphs[name.glyphs.length - 1]!;
    expect(lonOf(first.p)).toBeLessThan(lonOf(last.p));
    expect((lonOf(first.p) + lonOf(last.p)) / 2).toBeCloseTo(10, 6);
    close(name.mid, toVec(10, 0), 9);
    for (const g of name.glyphs) expect(Math.abs(toLonLat(g.p)[1])).toBeLessThan(1e-9); // on the arc
    // West to east, letter by letter.
    for (let i = 1; i < name.glyphs.length; i++) expect(lonOf(name.glyphs[i]!.p)).toBeGreaterThan(lonOf(name.glyphs[i - 1]!.p));
  });

  it('keeps every letter inside the share of the arc a name may span', () => {
    const thinArc = parallel(0, 30, 0, 150);
    for (const [n, a] of [[name, arc], [layoutName('thin', 'Chile', 0, thinArc, M)!, thinArc]] as const) {
      const halfSpan = (NAME_TYPE.span * a.lengthKm) / 2 / EARTH_KM;
      for (const g of n.glyphs) expect(angle(n.mid, g.p) + g.half * n.em).toBeLessThanOrEqual(halfSpan + 1e-6); // within metres
      // The cap around the name holds all of it.
      for (const g of n.glyphs) expect(angle(n.mid, g.p)).toBeLessThan(n.radius);
    }
  });

  it('gives each letter a unit reading direction and up, tangent to the sphere (up = north on an eastward arc)', () => {
    for (const g of name.glyphs) {
      expect(Math.hypot(...g.t)).toBeCloseTo(1, 9);
      expect(Math.hypot(...g.u)).toBeCloseTo(1, 9);
      expect(dot(g.p, g.t)).toBeCloseTo(0, 9);
      expect(dot(g.p, g.u)).toBeCloseTo(0, 9);
      expect(dot(g.t, g.u)).toBeCloseTo(0, 9);
      const l = lonOf(g.p) * RAD;
      expect(dot(g.t, [-Math.sin(l), Math.cos(l), 0])).toBeCloseTo(1, 6); // east
      close(g.u, [0, 0, 1], 6); // north
      expect(g.half).toBeCloseTo(0.35, 12);
    }
  });

  it('lets each letter lean with a curved arc', () => {
    // Along the 45th parallel (a small circle): each letter reads along the local east.
    const n = layoutName('p', 'Parallel', 0, parallel(0, 60, 45, 3000, 61), M)!;
    for (const g of n.glyphs) {
      const l = lonOf(g.p) * RAD;
      expect(dot(g.t, [-Math.sin(l), Math.cos(l), 0])).toBeGreaterThan(0.9999);
    }
    expect(dot(n.glyphs[0]!.t, n.glyphs[n.glyphs.length - 1]!.t)).toBeLessThan(0.95); // they differ along the curve
  });

  it('sizes letters to fill the span with the least spacing when the polity is wide enough', () => {
    const spanKm = NAME_TYPE.span * arc.lengthKm;
    const sizeKm = spanKm / (6 * 0.7 + 5 * NAME_TYPE.minSpacing);
    expect(sizeKm).toBeLessThan(NAME_TYPE.heightShare * arc.widthKm);
    expect(name.em * EARTH_KM).toBeCloseTo(sizeKm, 6);
    expect(spacingOf(name)).toBeCloseTo(NAME_TYPE.minSpacing, 4);
    // The name spans exactly its share of the arc.
    const g = name.glyphs;
    expect((angle(g[0]!.p, g[g.length - 1]!.p) + 0.7 * name.em) * EARTH_KM).toBeCloseTo(spanKm, 2);
  });

  it('limits letters to a share of the polity width, spreading them up to the widest spacing', () => {
    const thin = layoutName('cl', 'Chile', 0, parallel(0, 20, 0, 300), M)!;
    expect(thin.em * EARTH_KM).toBeCloseTo(NAME_TYPE.heightShare * 300, 6);
    expect(spacingOf(thin)).toBeCloseTo(NAME_TYPE.maxSpacing, 4); // would be wider: clamped
    // In between: spread to span the arc exactly.
    const mid = layoutName('m', 'France', 0, parallel(0, 20, 0, 700), M)!;
    const spanKm = NAME_TYPE.span * parallel(0, 20, 0, 700).lengthKm;
    const sizeKm = NAME_TYPE.heightShare * 700;
    expect(mid.em * EARTH_KM).toBeCloseTo(sizeKm, 6);
    const expected = (spanKm / sizeKm - 6 * 0.7) / 5;
    expect(expected).toBeGreaterThan(NAME_TYPE.minSpacing);
    expect(expected).toBeLessThan(NAME_TYPE.maxSpacing);
    for (let i = 0; i < 5; i++) expect(spacingOf(mid, i)).toBeCloseTo(expected, 4);
  });

  it('uses the shorter of the arc and its stated length for the span', () => {
    const short = layoutName('s', 'France', 0, { ...arc, lengthKm: arc.lengthKm / 2 }, M)!;
    expect(short.em * EARTH_KM).toBeCloseTo((NAME_TYPE.span * arc.lengthKm) / 2 / (6 * 0.7 + 5 * NAME_TYPE.minSpacing), 6);
    close(short.mid, toVec(10, 0), 9); // still centred on the arc
  });

  it('sets a one-letter name without spacing', () => {
    const one = layoutName('x', 'x', 0, arc, M)!;
    expect(one.glyphs.map((g) => g.ch)).toEqual(['X']);
    close(one.glyphs[0]!.p, toVec(10, 0), 9);
  });

  it('turns a name round: the same letters read from the east end, reading direction and up reversed', () => {
    const n = name.glyphs.length;
    expect(name.turned.map((g) => g.ch)).toEqual(name.glyphs.map((g) => g.ch));
    for (let i = 0; i < n; i++) {
      const t = name.turned[i]!;
      const g = name.glyphs[n - 1 - i]!; // where letter i lands when the name is turned round
      close(t.p, g.p, 9);
      close(t.t, neg(g.t), 9);
      close(t.u, neg(g.u), 9);
      expect(t.half).toBe(name.glyphs[i]!.half);
    }
    expect(lonOf(name.turned[0]!.p)).toBeGreaterThan(lonOf(name.turned[n - 1]!.p)); // F at the east end
  });

  it('mirrors letters of different widths about the middle when turned', () => {
    const wide: NameMetrics = { advance: (ch) => (ch === 'W' ? 1.2 : 0.5), capHeight: 0.7 };
    const n = layoutName('w', 'Wia', 0, arc, wide)!;
    for (let i = 0; i < 3; i++) {
      // Letter i turned is as far east of the middle as letter i was west of it.
      expect(lonOf(n.turned[i]!.p) - 10).toBeCloseTo(10 - lonOf(n.glyphs[i]!.p), 6);
    }
  });

  it('inks a letter for the sea when most of the nine points across it are water', () => {
    expect(name.glyphs.every((g) => !g.sea)).toBe(true); // no test given: all land
    const all = layoutName('a', 'France', 0, arc, M, () => true)!;
    expect(all.glyphs.every((g) => g.sea) && all.turned.every((g) => g.sea)).toBe(true);
    // The probes: a 3 × 3 grid across the letter, its middle row on the equator.
    const onLine = (_lon: number, lat: number): boolean => Math.abs(lat) < 1e-6; // 3 of 9
    const offLine = (_lon: number, lat: number): boolean => Math.abs(lat) >= 1e-6; // 6 of 9
    const north = (_lon: number, lat: number): boolean => lat > 1e-6; // 3 of 9 (a lake above the letters)
    const notSouth = (_lon: number, lat: number): boolean => lat > -1e-6; // 6 of 9
    expect(layoutName('a', 'France', 0, arc, M, onLine)!.glyphs.some((g) => g.sea)).toBe(false);
    expect(layoutName('a', 'France', 0, arc, M, offLine)!.glyphs.every((g) => g.sea)).toBe(true);
    expect(layoutName('a', 'France', 0, arc, M, north)!.glyphs.some((g) => g.sea)).toBe(false);
    expect(layoutName('a', 'France', 0, arc, M, notSouth)!.glyphs.every((g) => g.sea)).toBe(true);
    // Half the name over the sea: its eastern letters.
    const east = layoutName('a', 'France', 0, arc, M, (lon) => lon > 10)!;
    expect(east.glyphs.map((g) => g.sea)).toEqual([false, false, false, true, true, true]);
    expect(east.turned.map((g) => g.sea)).toEqual([true, true, true, false, false, false]);
    // A plain test keeps no shore to split letters at.
    expect(east.glyphs.some((g) => g.shore)).toBe(false);
  });

  it('keeps the shore around a letter across it, to split its ink there', () => {
    // Land west of the middle of the second letter (an R), sea east of it (the coast a
    // hair west of the letter's middle, so its middle column of probes is clearly wet).
    const coast = toLonLat(name.glyphs[1]!.p)[0] - 1e-3;
    const water = landWater([{ id: 1, tier: 0, geometry: { type: 'Polygon', coordinates: [[[-60, -40], [coast, -40], [coast, 40], [-60, 40], [-60, -40]]] } }]);
    const split = layoutName('a', 'France', 0, arc, M, water)!;
    expect(split.glyphs.map((g) => !!g.shore)).toEqual([false, true, false, false, false, false]);
    expect(split.glyphs.map((g) => g.sea)).toEqual([false, true, true, true, true, true]); // R: its middle and east columns, 6 of 9
    // The shore: the land clipped to a box around the letter, as unit vectors west of the coast.
    const ring = split.glyphs[1]!.shore![0]!;
    expect(ring.length).toBeGreaterThanOrEqual(4);
    for (const v of ring) expect(toLonLat(v)[0]).toBeLessThanOrEqual(coast + 1e-9);
    // Lakes count as water.
    const lake = landWater(
      [{ id: 1, tier: 0, geometry: { type: 'Polygon', coordinates: [[[-60, -40], [60, -40], [60, 40], [-60, 40], [-60, -40]]] } }],
      [{ geometry: { type: 'Polygon', coordinates: [[[coast, -10], [60, -10], [60, 10], [coast, 10], [coast, -10]]] } }],
    );
    expect(layoutName('a', 'France', 0, arc, M, lake)!.glyphs.map((g) => g.sea)).toEqual([false, true, true, true, true, true]);
  });

  it('ranks names by size, tier-1 overlays below tier-0 names of the same size', () => {
    const overlay = layoutName('o', 'France', 1, arc, M)!;
    expect(name.rank).toBe(name.em);
    expect(overlay.em).toBe(name.em);
    expect(overlay.rank).toBeCloseTo(name.em * NAME_TYPE.overlayRank, 12);
  });

  it('returns null when nothing can be set', () => {
    expect(layoutName('e', '', 0, arc, M)).toBeNull();
    expect(layoutName('e', '   ', 0, arc, M)).toBeNull();
    expect(layoutName('e', 'France', 0, { ...arc, coords: [[0, 0]] }, M)).toBeNull();
    expect(layoutName('e', 'France', 0, { ...arc, coords: [[0, 0], [0, 0]] }, M)).toBeNull(); // no length
    expect(layoutName('e', 'France', 0, { ...arc, widthKm: 0 }, M)).toBeNull();
  });
});

describe("the globe's camera", () => {
  const view = (over: Partial<CameraView> = {}): CameraView => ({ lon: 10, lat: 0, zoom: 3, fovY: 36.87, width: 1200, height: 800, ...over });
  const screen = (v: CameraView, p: Vec3): [number, number] => {
    const out = [0, 0];
    projectPoint(globeCamera(v), p, out);
    return [out[0]!, out[1]!];
  };
  const dist = (v: CameraView, a: Vec3, b: Vec3): number => {
    const [ax, ay] = screen(v, a);
    const [bx, by] = screen(v, b);
    return Math.hypot(bx - ax, by - ay);
  };

  it('puts the view centre at the principal point, east to the right and north up', () => {
    const v = view();
    const [x, y] = screen(v, toVec(10, 0));
    expect(x).toBeCloseTo(600, 9);
    expect(y).toBeCloseTo(400, 9);
    expect(screen(v, toVec(12, 0))[0]).toBeGreaterThan(600);
    expect(screen(v, toVec(10, 2))[1]).toBeLessThan(400);
    // Padding moves the principal point to the middle of the free area.
    const [px, py] = screen(view({ padding: { left: 200, top: 100 } }), toVec(10, 0));
    expect(px).toBeCloseTo(700, 9);
    expect(py).toBeCloseTo(450, 9);
    const out = new Float64Array(4);
    projectPoint(globeCamera(v), toVec(10, 0), out, 2); // writes at an offset
    expect([out[0], out[1], out[2], out[3]]).toEqual([0, 0, expect.closeTo(600, 9), expect.closeTo(400, 9)]);
  });

  it("has MapLibre's globe radius and camera distance", () => {
    const cam = globeCamera(view({ lat: 60 }));
    expect(cam.R).toBeCloseTo((512 * 8) / (2 * Math.PI * 0.5), 9);
    expect(cam.d).toBeCloseTo(400 / Math.tan((36.87 / 2) * RAD), 9);
    expect(pxPerRadian(cam, cam.c)).toBeCloseTo(cam.R, 9); // the scale at the view centre
    expect(dot(cam.e, cam.n)).toBeCloseTo(0, 12);
    expect(dot(cam.c, cam.e)).toBeCloseTo(0, 12);
    expect(dot(cam.c, cam.n)).toBeCloseTo(0, 12);
  });

  it('faces the viewer squarely at the view centre and edge-on at the horizon', () => {
    const cam = globeCamera(view({ lon: -30, lat: 40 }));
    expect(facing(cam, cam.c)).toBeCloseTo(1, 12);
    const h = horizonAngle(cam);
    expect(h).toBeGreaterThan(0);
    expect(h).toBeLessThan(Math.PI / 2);
    for (const dir of [cam.e, cam.n, neg(cam.e)]) {
      const at = (a: number): Vec3 => [0, 1, 2].map((i) => cam.c[i]! * Math.cos(a) + dir[i]! * Math.sin(a)) as Vec3;
      expect(facing(cam, at(h))).toBeCloseTo(0, 9);
      expect(facing(cam, at(h * 0.5))).toBeGreaterThan(0);
      expect(facing(cam, at(h * 1.1))).toBeLessThan(0);
      expect(facing(cam, at(h * 0.5))).toBeLessThan(1);
    }
    expect(facing(cam, neg(cam.c))).toBeLessThan(0);
    // Zoomed in, the horizon comes closer to the view centre.
    expect(horizonAngle(globeCamera(view({ zoom: 6 })))).toBeLessThan(horizonAngle(globeCamera(view({ zoom: 2 }))));
  });

  describe('names scale with the map', () => {
    // A 6-letter name along the equator, 10° long, at the view centre.
    const arc = parallel(5, 15, 0, 2000);
    const n = layoutName('fr', 'France', 0, arc, M)!;
    const ends = (): [Vec3, Vec3] => [n.glyphs[0]!.p, n.glyphs[n.glyphs.length - 1]!.p];
    const nameLength = (zoom: number, lat = 0): number => dist(view({ zoom, lat }), ...ends());

    it('doubles in length on screen when the zoom grows by one (twice the scale)', () => {
      for (const z of [1, 2, 3, 4, 5, 6]) {
        const ratio = nameLength(z + 1) / nameLength(z);
        expect(ratio).toBeGreaterThan(2 * 0.98);
        expect(ratio).toBeLessThan(2 * 1.02);
      }
      // A name about 500 px long at one zoom is about 1000 px long at the next.
      const z500 = Math.log2(500 / nameLength(0));
      expect(nameLength(z500)).toBeGreaterThan(490);
      expect(nameLength(z500)).toBeLessThan(510);
      expect(nameLength(z500 + 1) / nameLength(z500)).toBeCloseTo(2, 1);
      expect(nameLength(z500 + 1)).toBeGreaterThan(980);
      expect(nameLength(z500 + 1)).toBeLessThan(1020);
    });

    it('doubles its letter size exactly at the view centre', () => {
      for (const z of [0.5, 2, 4.25, 7]) {
        const em = (zoom: number): number => n.em * pxPerRadian(globeCamera(view({ zoom })), n.mid);
        expect(em(z + 1) / em(z)).toBeCloseTo(2, 12);
      }
    });

    it('stays a fixed share of the map under it at every zoom', () => {
      // Two fixed ground points under the name: the name stays the same share of the
      // distance between them (up to the globe's perspective, under 1 %).
      const a = toVec(7, 0);
      const b = toVec(13, 0);
      const share = (z: number): number => nameLength(z) / dist(view({ zoom: z }), a, b);
      const s0 = share(1);
      expect(s0).toBeGreaterThan(1); // the name reaches beyond them (8.4° vs 6°)
      for (const z of [2, 3, 4, 5, 6]) expect(share(z) / s0).toBeCloseTo(1, 2);
    });

    it('scales the same way away from the equator', () => {
      const north = layoutName('n', 'Norway', 0, parallel(0, 20, 60, 600), M)!;
      const len = (zoom: number): number => {
        const v = view({ lon: 10, lat: 60, zoom });
        return dist(v, north.glyphs[0]!.p, north.glyphs[north.glyphs.length - 1]!.p);
      };
      for (const z of [2, 3, 4]) {
        expect(len(z + 1) / len(z)).toBeGreaterThan(1.96);
        expect(len(z + 1) / len(z)).toBeLessThan(2.02);
      }
    });
  });
});

describe('visibility', () => {
  it('eases between its ends', () => {
    expect(smoothstep(0, 1, -1)).toBe(0);
    expect(smoothstep(0, 1, 0.5)).toBe(0.5);
    expect(smoothstep(0, 1, 2)).toBe(1);
  });

  it('fades names in as their letters grow from minPx to fullPx', () => {
    const T = NAME_TYPE;
    expect(sizeAlpha(T.minPx - 1, 1000)).toBe(0);
    expect(sizeAlpha(T.minPx, 1000)).toBe(0);
    expect(sizeAlpha((T.minPx + T.fullPx) / 2, 1000)).toBeCloseTo(0.5, 12);
    expect(sizeAlpha(T.fullPx, 1000)).toBe(1);
    expect(sizeAlpha(100, 1000)).toBe(1);
  });

  it('fades names out when their letters grow past a share of the view', () => {
    const T = NAME_TYPE;
    const viewMin = 1000;
    expect(sizeAlpha(T.fadeOutFrom * viewMin, viewMin)).toBe(1);
    expect(sizeAlpha(((T.fadeOutFrom + T.fadeOutTo) / 2) * viewMin, viewMin)).toBeCloseTo(0.5, 12);
    expect(sizeAlpha(T.fadeOutTo * viewMin, viewMin)).toBe(0);
    expect(sizeAlpha(2000, viewMin)).toBe(0);
    // A smaller view hides them sooner.
    expect(sizeAlpha(250, 2000)).toBe(1);
    expect(sizeAlpha(250, 500)).toBe(0);
  });

  it('fades letters out towards the rim', () => {
    const T = NAME_TYPE;
    expect(rimAlpha(-0.5)).toBe(0);
    expect(rimAlpha(T.rimHide)).toBe(0);
    expect(rimAlpha((T.rimHide + T.rimFull) / 2)).toBeCloseTo(0.5, 12);
    expect(rimAlpha(T.rimFull)).toBe(1);
    expect(rimAlpha(1)).toBe(1);
  });
});

describe('readsTurned', () => {
  it('keeps names reading rightward and upward, turns those reading leftward or downward', () => {
    expect(readsTurned(0, 0, 10, 0)).toBe(false); // rightward
    expect(readsTurned(10, 0, 0, 0)).toBe(true); // leftward
    expect(readsTurned(0, 10, 0, 0)).toBe(false); // upward (screen y grows downward)
    expect(readsTurned(0, 0, 0, 10)).toBe(true); // downward
    expect(readsTurned(0, 0, 10, 10)).toBe(false); // down and to the right
    expect(readsTurned(10, 0, 0, -10)).toBe(true); // up and to the left
    expect(readsTurned(0, 0, 10, -10)).toBe(false); // up and to the right
  });

  it('turns a nearly vertical name to read upward, leaning a few degrees', () => {
    // 1° left of straight up: reads upward (the bias leans toward upward), whatever before.
    const [ux, uy] = [-Math.sin(1 * RAD), -Math.cos(1 * RAD)];
    expect(readsTurned(0, 0, ux, uy, false)).toBe(false);
    expect(readsTurned(0, 0, ux, uy, true)).toBe(false);
    // 1° right of straight down: turned round, whatever before.
    expect(readsTurned(0, 0, -ux, -uy, false)).toBe(true);
    expect(readsTurned(0, 0, -ux, -uy, true)).toBe(true);
    // 5° left of up (the edge): not turned from an upright start, although it leans left.
    expect(readsTurned(0, 0, -Math.sin(5 * RAD), -Math.cos(5 * RAD), false)).toBe(false);
  });

  it('holds its state near the edge (hysteresis)', () => {
    // A direction whose lean is exactly 0: perpendicular to the biased reading direction.
    const b = NAME_TYPE.uprightBias * RAD;
    const [dx, dy] = [10 * Math.sin(b), 10 * Math.cos(b)]; // down, slightly right
    expect(readsTurned(0, 0, dx, dy, false)).toBe(false);
    expect(readsTurned(0, 0, dx, dy, true)).toBe(true);
    // Clearly one way or the other: the state does not matter.
    expect(readsTurned(0, 0, 10, 0, true)).toBe(false);
    expect(readsTurned(10, 0, 0, 0, false)).toBe(true);
    // No direction at all: as before.
    expect(readsTurned(5, 5, 5, 5, true)).toBe(true);
    expect(readsTurned(5, 5, 5, 5, false)).toBe(false);
  });
});

describe('nameBlockers and byRank', () => {
  const big = layoutName('big', 'Empire', 0, parallel(0, 30, 0, 3000), M)!;
  const small = layoutName('small', 'Duchy', 0, parallel(5, 15, 0, 800), M)!; // under the big one
  const far = layoutName('far', 'Faraway', 0, parallel(100, 120, 0, 2000), M)!;
  const near = layoutName('near', 'Nearby', 0, parallel(0, 30, 7, 3000), M)!; // parallel, clear of `big`

  it('orders names largest first, then by key', () => {
    const list = [small, far, big].sort(byRank);
    expect(list.map((n) => n.key)).toEqual(['big', 'far', 'small']);
    const same = (key: string): PlacedName => ({ ...big, key });
    expect([same('b'), same('a'), same('c')].sort(byRank).map((n) => n.key)).toEqual(['a', 'b', 'c']);
    const overlay = layoutName('overlay', 'Empire', 1, parallel(0, 30, 0, 3000), M)!;
    expect([overlay, big].sort(byRank).map((n) => n.key)).toEqual(['big', 'overlay']);
  });

  it('blocks a name by the larger names it overlaps', () => {
    const list = [small, big].sort(byRank);
    expect(list[0]).toBe(big);
    expect(nameBlockers(list, M.capHeight)).toEqual([[], [0]]);
  });

  it('blocks nothing when names are apart', () => {
    expect(nameBlockers([big, far], M.capHeight)).toEqual([[], []]);
    expect(nameBlockers([big, near], M.capHeight)).toEqual([[], []]);
  });

  it('lists every larger name a name overlaps, and only those', () => {
    const list = [big, far, small].sort(byRank);
    expect(list.map((n) => n.key)).toEqual(['big', 'far', 'small']);
    expect(nameBlockers(list, M.capHeight)).toEqual([[], [], [0]]);
    expect(nameBlockers([], M.capHeight)).toEqual([]);
  });

  it('counts letters as overlapping within their half size plus the clearance', () => {
    // A copy of `small` moved north until its letters just clear `big`'s.
    const reach = (n: PlacedName): number => n.em * (Math.max(0.35, M.capHeight / 2) + NAME_TYPE.clearance);
    const gap = reach(big) + reach(small); // radians between letter centres at which they touch
    const at = (dLat: number): PlacedName => layoutName('moved', 'Duchy', 0, parallel(5, 15, dLat, 800), M)!;
    expect(nameBlockers([big, at((gap / RAD) * 0.9)], M.capHeight)).toEqual([[], [0]]);
    expect(nameBlockers([big, at((gap / RAD) * 1.1)], M.capHeight)).toEqual([[], []]);
  });
});
