import { describe, expect, it } from 'vitest';
import {
  bboxCenter,
  bboxOfCoordinates,
  bboxToLngLatBounds,
  bboxWidth,
  fitInsideMapPadding,
  fitZoom,
  normalizePadding,
  normalizeView,
  positionsOf,
  roundView,
  scaleToZoom,
  unionBBoxes,
  wrapLon,
  zoomToScale,
} from './view.js';

describe('fitZoom / scale', () => {
  it('fits the globe diameter to the smaller side: 2^z · 512 / π = min(w, h)', () => {
    for (const [w, h] of [
      [1280, 800],
      [390, 844],
      [3840, 2160],
    ] as const) {
      const z = fitZoom(w, h);
      expect((2 ** z * 512) / Math.PI).toBeCloseTo(Math.min(w, h), 6);
    }
    expect(fitZoom(1280, 800)).toBeCloseTo(Math.log2((800 * Math.PI) / 512), 12);
  });

  it('round-trips scale ↔ zoom and doubles per zoom level', () => {
    const fit = fitZoom(1280, 800);
    expect(scaleToZoom(1, fit)).toBeCloseTo(fit, 12);
    expect(scaleToZoom(2, fit)).toBeCloseTo(fit + 1, 12);
    for (const s of [0.6, 1, 1.7, 8, 64]) expect(zoomToScale(scaleToZoom(s, fit), fit)).toBeCloseTo(s, 10);
  });

  it('keeps the relative scale across a resize (same view, different zoom)', () => {
    const before = fitZoom(1600, 900);
    const after = fitZoom(800, 450);
    const zoom = scaleToZoom(3, before);
    const scale = zoomToScale(zoom, before);
    expect(zoomToScale(scaleToZoom(scale, after), after)).toBeCloseTo(3, 10);
    expect(scaleToZoom(scale, after)).toBeCloseTo(zoom - 1, 10); // half the size → one zoom level less
  });

  it('guards degenerate sizes and scales', () => {
    expect(Number.isFinite(fitZoom(0, 0))).toBe(true);
    expect(Number.isFinite(scaleToZoom(0, 2))).toBe(true);
  });
});

describe('normalizeView', () => {
  it('wraps longitude, clamps latitude and rejects bad scales', () => {
    expect(normalizeView({ center: [190, 95], scale: 2 })).toEqual({ center: [-170, 85.051129], scale: 2 });
    expect(normalizeView({ center: [-180, 0], scale: -1 }).scale).toBe(1);
    expect(normalizeView({ center: [Number.NaN, 10] }).center).toEqual([20, 10]);
    expect(normalizeView(undefined)).toEqual({ center: [20, 30], scale: 1 });
  });

  it('wrapLon maps to [−180, 180)', () => {
    expect(wrapLon(180)).toBe(-180);
    expect(wrapLon(-180)).toBe(-180);
    expect(wrapLon(540)).toBe(-180);
    expect(wrapLon(359)).toBe(-1);
    expect(wrapLon(-181)).toBe(179);
  });

  it('roundView keeps URLs short', () => {
    expect(roundView({ center: [12.345678, -45.678912], scale: 1.23456 })).toEqual({ center: [12.3457, -45.6789], scale: 1.23 });
  });
});

describe('bounding boxes', () => {
  it('tight box for a normal polygon', () => {
    const b = bboxOfCoordinates([
      [10, 40],
      [20, 45],
      [15, 50],
    ]);
    expect(b).toEqual([10, 40, 20, 50]);
  });

  it('crosses the antimeridian instead of spanning the world (Chukotka/Fiji)', () => {
    const b = bboxOfCoordinates([
      [170, 60],
      [179.9, 65],
      [-179.9, 66],
      [-170, 70],
    ]);
    expect(b).toEqual([170, 60, -170, 70]);
    expect(bboxWidth(b!)).toBeCloseTo(20, 9);
    expect(bboxCenter(b!)).toEqual([-180, 65]);
    expect(bboxToLngLatBounds(b!)).toEqual([
      [170, 60],
      [190, 70],
    ]);
  });

  it('iterates nested geometry positions', () => {
    const mp = {
      type: 'MultiPolygon',
      coordinates: [
        [
          [
            [0, 0],
            [1, 0],
            [1, 1],
            [0, 0],
          ],
        ],
        [
          [
            [5, 5],
            [6, 5],
            [6, 6],
            [5, 5],
          ],
        ],
      ],
    };
    expect([...positionsOf(mp)]).toHaveLength(8);
    expect(bboxOfCoordinates(positionsOf(mp))).toEqual([0, 0, 6, 6]);
    expect(bboxOfCoordinates([])).toBeNull();
  });

  it('unions boxes on the circle of longitudes', () => {
    expect(
      unionBBoxes([
        [170, 0, 175, 5],
        [-178, -5, -172, 2],
      ]),
    ).toEqual([170, -5, -172, 5]);
    const u = unionBBoxes([
      [-10, 0, 10, 10],
      [30, -20, 40, 0],
    ]);
    expect(u).toEqual([-10, -20, 40, 10]);
    expect(unionBBoxes([])).toBeNull();
  });

  it('normalises padding', () => {
    expect(normalizePadding(12)).toEqual({ top: 12, right: 12, bottom: 12, left: 12 });
    expect(normalizePadding({ right: 400 }, 30)).toEqual({ top: 30, right: 400, bottom: 30, left: 30 });
  });

  it('fits inside the map padding: adds it and cancels its extra centre shift', () => {
    const pad = { top: 20, right: 20, bottom: 20, left: 20 };
    expect(fitInsideMapPadding(pad, { top: 0, right: 0, bottom: 0, left: 0 })).toBeNull();
    expect(fitInsideMapPadding(pad, undefined)).toBeNull();
    expect(fitInsideMapPadding(pad, { top: 60, right: 380, bottom: 105, left: 0 })).toEqual({
      padding: { top: 80, right: 400, bottom: 125, left: 20 },
      offset: [190, 22.5],
    });
    // MapLibre's Mercator pass counts the map padding twice: no compensation when that fails.
    const phone = { width: 390, height: 844 };
    expect(fitInsideMapPadding(pad, { top: 60, bottom: 117 }, phone)?.padding.bottom).toBe(137);
    expect(fitInsideMapPadding(pad, { top: 60, bottom: 400 }, phone)).toBeNull();
  });
});
