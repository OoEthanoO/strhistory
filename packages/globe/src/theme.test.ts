// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { hatchImage } from './hatch.js';
import { DEFAULT_THEME, cssVarName, readCssTheme, resolveTheme } from './theme.js';

describe('theme', () => {
  it('maps keys to --ca-* custom properties', () => {
    expect(cssVarName('ocean')).toBe('--ca-ocean');
    expect(cssVarName('lakeShore')).toBe('--ca-lake-shore');
    expect(cssVarName('fillBlend')).toBe('--ca-fill-blend');
  });

  it('defaults follow the visual identity (navy-black space, brass selection)', () => {
    expect(DEFAULT_THEME.space).toBe('#070b14');
    expect(DEFAULT_THEME.selection).toBe('#e9b45f');
    expect(DEFAULT_THEME.atmosphere).toBeLessThanOrEqual(0.6);
  });

  it('layers defaults < CSS < options and normalises colours', () => {
    const t = resolveTheme({ ocean: 'rgb(1, 2, 3)', land: '#444' }, { land: 'hsl(0, 0%, 50%)', fillBlend: 2 });
    expect(t.ocean).toBe('#010203');
    expect(t.land).toBe('#808080');
    expect(t.fillBlend).toBe(1); // clamped
    expect(t.coast).toBe(DEFAULT_THEME.coast);
    expect(resolveTheme({ atmosphere: Number.NaN }).atmosphere).toBe(DEFAULT_THEME.atmosphere);
  });

  it('reads --ca-* custom properties from an element', () => {
    const el = document.createElement('div');
    el.style.setProperty('--ca-ocean', '#102030');
    el.style.setProperty('--ca-lake-shore', 'rgba(0, 0, 0, 0.5)');
    el.style.setProperty('--ca-fill-blend', '0.7');
    el.style.setProperty('--ca-stars', 'off');
    document.body.appendChild(el);
    const css = readCssTheme(el);
    expect(css).toMatchObject({ ocean: '#102030', lakeShore: 'rgba(0, 0, 0, 0.5)', fillBlend: 0.7, stars: false });
    expect(css.land).toBeUndefined();
    const t = resolveTheme(css, { ocean: '#000000' });
    expect(t.ocean).toBe('#000000');
    expect(t.lakeShore).toBe('rgba(0, 0, 0, 0.5)');
  });
});

describe('hatchImage', () => {
  it('is a square tile of the stripe spacing at the pixel ratio', () => {
    const img = hatchImage({ color: '#ffffff', spacing: 6, pixelRatio: 2 });
    expect(img.width).toBe(12);
    expect(img.height).toBe(12);
    expect(img.data).toHaveLength(12 * 12 * 4);
    expect(img.pixelRatio).toBe(2);
  });

  it('draws diagonal stripes in the requested colour, transparent between them', () => {
    const img = hatchImage({ color: 'rgba(200, 100, 50, 0.5)', spacing: 8, width: 1.5, pixelRatio: 1 });
    const alpha = (x: number, y: number): number => img.data[(y * img.width + x) * 4 + 3]!;
    // On the stripe line x + y + 1 ≡ 0 (mod 8): opaque-ish; halfway between stripes: clear.
    expect(alpha(7, 0)).toBeGreaterThan(100);
    expect(alpha(3, 0)).toBe(0);
    expect(alpha(3, 4)).toBeGreaterThan(100); // 3 + 4 + 1 = 8
    expect(Math.max(...Array.from({ length: 64 }, (_, i) => alpha(i % 8, Math.floor(i / 8))))).toBeLessThanOrEqual(128); // alpha 0.5
    expect([img.data[(0 * 8 + 7) * 4], img.data[(0 * 8 + 7) * 4 + 1], img.data[(0 * 8 + 7) * 4 + 2]]).toEqual([200, 100, 50]);
  });

  it('tiles seamlessly (stripes continue across tile edges)', () => {
    const img = hatchImage({ color: '#fff', spacing: 6, pixelRatio: 2 });
    const n = img.width;
    const a = (x: number, y: number): number => img.data[(((y + n) % n) * n + ((x + n) % n)) * 4 + 3]!;
    // Alpha only depends on (x + y) mod n, so moving one pixel right and one up is invariant, wrapping included.
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) expect(a(x + 1, y - 1)).toBe(a(x, y));
  });
});
