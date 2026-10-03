import { describe, expect, it } from 'vitest';
import { labelExtent, labelSize, rimFade } from './rim.js';

describe('labelSize', () => {
  it('follows the style stops by area and zoom', () => {
    expect(labelSize(1e5, 0)).toBe(9); // log10 = 5 → 9 px at z0
    expect(labelSize(1e7, 0)).toBe(14);
    expect(labelSize(1e6, 3)).toBe(14.5);
    expect(labelSize(1e6, 1.5)).toBeCloseTo((11 + 14.5) / 2, 9); // halfway between z0 and z3
    expect(labelSize(1, 10)).toBe(11); // clamped at the last zoom and the first area stop
  });
});

describe('labelExtent', () => {
  it('wraps long names and grows with the text', () => {
    const one = labelExtent('Persia', 1.6e6, 1.5);
    const long = labelExtent('Great Socialist People’s Libyan Arab Jamahiriya', 1.7e6, 1.5);
    expect(long.hh).toBeGreaterThan(one.hh * 2); // several lines
    expect(long.hw).toBeGreaterThan(one.hw);
    expect(one.hw).toBeGreaterThan(10);
    expect(one.hw).toBeLessThan(60);
  });

  it('accounts for upper case on empires', () => {
    const mixed = labelExtent('Russian Empire', 2.4e6, 1.5);
    const upper = labelExtent('Russian Empire', 2.6e6, 1.5);
    expect(upper.hw).toBeGreaterThan(mixed.hw);
  });
});

describe('rimFade', () => {
  const disc = { x: 500, y: 400, r: 300 };
  const ext = { hw: 40, hh: 10 };

  it('is 1 inside the globe and for labels grazing the rim', () => {
    expect(rimFade({ x: 500, y: 400 }, disc, ext)).toBe(1);
    expect(rimFade({ x: 500 + 300 - 40, y: 400 }, disc, ext)).toBe(1); // box touches the rim
    expect(rimFade({ x: 500 + 300 - 34, y: 400 }, disc, ext)).toBe(1); // ~7 % outside
  });

  it('dims a label partly out of the globe and hides one hanging out into space', () => {
    const partly = rimFade({ x: 500 + 300 - 12, y: 400 }, disc, ext); // ~35 % of the box outside
    expect(partly).toBeGreaterThan(0);
    expect(partly).toBeLessThan(1);
    expect(rimFade({ x: 500 + 300, y: 400 }, disc, ext)).toBe(0); // half outside
    expect(rimFade({ x: 500 + 330, y: 400 }, disc, ext)).toBe(0);
    expect(rimFade({ x: 500, y: 400 - 312 }, disc, ext)).toBe(0); // above the north rim
  });

  it('counts the part of the box beyond the canvas edge as outside', () => {
    const p = { x: 230, y: 400 }; // inside the globe, but the canvas starts at x = 240
    expect(rimFade(p, disc, ext)).toBe(1);
    expect(rimFade({ x: p.x - 240, y: p.y }, { ...disc, x: disc.x - 240 }, ext, { w: 600, h: 800 })).toBe(0);
  });

  it('fades in quarter steps in between', () => {
    const values = new Set<number>();
    for (let x = 760; x <= 800; x += 2) values.add(rimFade({ x: 500 + (x - 500), y: 400 }, disc, ext));
    expect([...values].every((v) => [0, 0.25, 0.5, 0.75, 1].includes(v))).toBe(true);
    expect(values.size).toBeGreaterThan(2);
  });
});
