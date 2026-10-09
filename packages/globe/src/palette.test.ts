import { describe, expect, it } from 'vitest';
import { blendOver, contrastRatio, isTransparent, mix, normalizeColor, parseColor, shade, toHex } from './color.js';
import { DEFAULT_PALETTE, blendPalette, edgePalette, hoverPalette, overlayLinePalette, slotColorExpression } from './palette.js';
import { DEFAULT_THEME } from './theme.js';

// OKLab ΔE×100 (Björn Ottosson's matrices), to check the palette stays distinct.
function oklab(hex: string): [number, number, number] {
  const c = parseColor(hex)!;
  const lin = (v: number): number => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = [lin(c.r), lin(c.g), lin(c.b)];
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
const deltaE = (a: string, b: string): number => {
  const [l1, a1, b1] = oklab(a);
  const [l2, a2, b2] = oklab(b);
  return 100 * Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

describe('colour parsing', () => {
  it('parses hex, rgb(), rgba() (comma and space syntax) and hsl()', () => {
    expect(parseColor('#abc')).toEqual({ r: 0xaa, g: 0xbb, b: 0xcc, a: 1 });
    expect(parseColor('#11223380')).toMatchObject({ r: 0x11, g: 0x22, b: 0x33 });
    expect(parseColor('#11223380')!.a).toBeCloseTo(128 / 255, 6);
    expect(parseColor('rgba(10, 20, 30, 0.5)')).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor('rgb(10 20 30 / 25%)')).toEqual({ r: 10, g: 20, b: 30, a: 0.25 });
    const hsl = parseColor('hsl(120, 100%, 25%)')!;
    expect(toHex(hsl)).toBe('#008000');
    expect(parseColor('white')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('not-a-colour')).toBeNull();
  });

  it('normalises to hex when opaque and rgba() otherwise', () => {
    expect(normalizeColor('#ABCDEF')).toBe('#abcdef');
    expect(normalizeColor('rgba(1,2,3,0.5)')).toBe('rgba(1, 2, 3, 0.5)');
    expect(() => normalizeColor('definitely not a colour')).toThrow(/not a colour/);
  });

  it('blends like a translucent fill over an opaque background', () => {
    expect(blendOver('#ffffff', '#000000', 0.5)).toBe('#808080');
    expect(blendOver('#ff0000', '#0000ff', 1)).toBe('#ff0000');
    expect(blendOver('#ff0000', '#0000ff', 0)).toBe('#0000ff');
    expect(blendOver('rgba(255,255,255,0.5)', '#000000', 1)).toBe('#808080');
    expect(mix('#000000', '#ffffff', 0.25)).toBe('#404040');
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 6);
  });
});

describe('DEFAULT_PALETTE', () => {
  const fills = blendPalette(DEFAULT_PALETTE, DEFAULT_THEME);

  it('has 12 slots (manifest.palette.size) of opaque hex colours', () => {
    expect(DEFAULT_PALETTE).toHaveLength(12);
    expect(Object.isFrozen(DEFAULT_PALETTE)).toBe(true);
    for (const c of [...DEFAULT_PALETTE, ...fills]) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('pre-blends over the land colour (opaque, never translucent)', () => {
    expect(fills[0]).toBe(blendOver(DEFAULT_PALETTE[0]!, DEFAULT_THEME.land, DEFAULT_THEME.fillBlend));
    // Blending pulls each colour towards the land colour.
    for (let i = 0; i < 12; i++) expect(deltaE(fills[i]!, DEFAULT_THEME.land)).toBeLessThan(deltaE(DEFAULT_PALETTE[i]!, DEFAULT_THEME.land));
  });

  it('keeps every pair of drawn fills distinguishable (documented ΔE thresholds)', () => {
    let worst = Infinity;
    let worst6 = Infinity;
    for (let i = 0; i < 12; i++)
      for (let j = i + 1; j < 12; j++) {
        const d = deltaE(fills[i]!, fills[j]!);
        worst = Math.min(worst, d);
        if (i < 6 && j < 6) worst6 = Math.min(worst6, d);
      }
    expect(worst).toBeGreaterThanOrEqual(7);
    expect(worst6).toBeGreaterThanOrEqual(10.5);
  });

  it('stays muted and readable on the dark theme', () => {
    for (const f of fills) {
      const L = oklab(f)[0];
      expect(L).toBeGreaterThan(0.45);
      expect(L).toBeLessThan(0.72);
      const [, a, b] = oklab(f);
      expect(Math.hypot(a, b)).toBeLessThan(0.1); // muted chroma
    }
  });

  it('keeps unclaimed land distinct from the ocean and from every polity fill', () => {
    // Unclaimed land must never read as water (it did at #232a24: contrast 1.18).
    expect(contrastRatio(DEFAULT_THEME.land, DEFAULT_THEME.ocean)).toBeGreaterThan(1.4);
    expect(deltaE(DEFAULT_THEME.land, DEFAULT_THEME.ocean)).toBeGreaterThan(8);
    for (const f of fills) expect(deltaE(f, DEFAULT_THEME.land)).toBeGreaterThan(20);
  });

  it('derives hover and outline variants', () => {
    const hovers = hoverPalette(fills, DEFAULT_THEME);
    for (let i = 0; i < 12; i++) expect(oklab(hovers[i]!)[0]).toBeGreaterThan(oklab(fills[i]!)[0]);
    expect(overlayLinePalette(DEFAULT_PALETTE)).toHaveLength(12);
  });
});

describe('slotColorExpression', () => {
  it('matches the colour slot modulo the palette size, with a fallback', () => {
    const expr = slotColorExpression(['#111111', '#222222'], '#000000');
    expect(expr).toEqual(['match', ['%', ['to-number', ['get', 'c'], -1], 2], 0, '#111111', 1, '#222222', '#000000']);
    expect(slotColorExpression([], '#123456')).toEqual(['to-color', '#123456']);
  });
});

describe('shade and edgePalette (own outlines)', () => {
  it('lowers OKLab lightness by the amount and keeps the hue', () => {
    for (const c of ['#e1878a', '#7698d6', '#98cb8d', '#eed780', '#9399a2']) {
      const d = shade(c, 0.2);
      const [l1, a1, b1] = oklab(c);
      const [l2, a2, b2] = oklab(d);
      expect(l1 - l2).toBeGreaterThan(0.17);
      expect(l1 - l2).toBeLessThan(0.23);
      if (Math.hypot(a1, b1) > 0.03) expect(Math.abs(Math.atan2(b2, a2) - Math.atan2(b1, a1))).toBeLessThan(0.12);
    }
    expect(shade('#808080', 0)).toBe('#808080');
    expect(shade('#101010', 0.5)).toBe('#000000');
  });

  it('shades every opaque fill', () => {
    const fills = blendPalette(DEFAULT_PALETTE, DEFAULT_THEME);
    const edges = edgePalette(fills, { edge: 0.2 });
    expect(edges).toHaveLength(fills.length);
    edges.forEach((e, i) => expect(oklab(e)[0]).toBeLessThan(oklab(fills[i]!)[0]));
  });

  it('tells fully transparent colours apart', () => {
    expect(isTransparent('rgba(0, 0, 0, 0)')).toBe(true);
    expect(isTransparent('transparent')).toBe(true);
    expect(isTransparent('#00000000')).toBe(true);
    expect(isTransparent('rgba(0, 0, 0, 0.01)')).toBe(false);
    expect(isTransparent('#fff')).toBe(false);
  });
});
