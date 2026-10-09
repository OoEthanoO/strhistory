import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE } from './palette.js';
import { FILTERS, borderIds, borderLayers, borderSources, buildBaseStyle, externalUrls, layerOrder, skySpec, type LayerSpec } from './style.js';
import { DEFAULT_THEME } from './theme.js';

const ids = borderIds('ca-');
const ctx = { ids, theme: { ...DEFAULT_THEME }, palette: DEFAULT_PALETTE };

describe('layer order (AGENTS.md §5.5)', () => {
  const layers = borderLayers(ctx);

  it('emits the layers in contract order', () => {
    expect(layers.map((l) => l.id)).toEqual(layerOrder(ids));
    const pos = (id: string): number => layers.findIndex((l) => l.id === id);
    // ocean background (base style) → base land → tier-0 fills → borders → tier-1 → lakes → coast → highlight
    expect(pos(ids.baseLand)).toBeLessThan(pos(ids.fill));
    expect(pos(ids.fill)).toBeLessThan(pos(ids.edge));
    expect(pos(ids.edge)).toBeLessThan(pos(ids.border));
    expect(pos(ids.fill)).toBeLessThan(pos(ids.border));
    expect(pos(ids.border)).toBeLessThan(pos(ids.approx));
    expect(pos(ids.approx)).toBeLessThan(pos(ids.overlayTint));
    expect(pos(ids.overlayTint)).toBeLessThan(pos(ids.overlayHatch));
    expect(pos(ids.overlayHatch)).toBeLessThan(pos(ids.overlayLine));
    expect(pos(ids.overlayLine)).toBeLessThan(pos(ids.lakes));
    expect(pos(ids.lakes)).toBeLessThan(pos(ids.coast));
    expect(pos(ids.coast)).toBeLessThan(pos(ids.hoverLine));
    expect(pos(ids.hoverLine)).toBeLessThan(pos(ids.selectLine));
  });

  it('uses the right sources and filters', () => {
    const byId = Object.fromEntries(layers.map((l) => [l.id, l]));
    expect(byId[ids.fill]!.source).toBe(ids.frameSrc);
    expect(byId[ids.fill]!.filter).toEqual(FILTERS.tier0);
    expect(byId[ids.border]!.filter).toEqual(FILTERS.border);
    expect(byId[ids.coast]!.filter).toEqual(FILTERS.coast);
    expect(byId[ids.overlayHatch]!.filter).toEqual(FILTERS.tier1);
    expect(byId[ids.overlayHatch]!.paint!['fill-pattern']).toBe(ids.hatchImage);
    expect(byId[ids.lakes]!.source).toBe(ids.lakesSrc);
    expect(byId[ids.baseLand]!.source).toBe(ids.baseLandSrc);
    expect(byId[ids.selectLine]!.source).toBe(ids.highlightSrc);
    // Big polities first, small on top.
    expect(byId[ids.fill]!.layout!['fill-sort-key']).toEqual(['-', 0, ['to-number', ['get', 'a'], 0]]);
    // Approximate precision and tier 1 draw dashed.
    expect(byId[ids.approx]!.filter).toContainEqual(['==', ['get', 'precision'], 'approximate']);
    expect(byId[ids.approx]!.paint!['line-dasharray']).toBeDefined();
    expect(byId[ids.overlayLine]!.paint!['line-dasharray']).toBeDefined();
  });

  it('paints unclaimed land in the land colour and polities from the pre-blended palette', () => {
    const fill = borderLayers(ctx).find((l) => l.id === ids.fill)!.paint!['fill-color'] as unknown[];
    const json = JSON.stringify(fill);
    expect(json).toContain('"unclaimed"');
    expect(json).toContain(DEFAULT_THEME.land);
    expect(json).toContain('feature-state'); // hover lightening
    expect(json).not.toContain(DEFAULT_PALETTE[0]); // raw colour never painted…
  });

  it('switches to per-feature colours for palette functions', () => {
    const fill = borderLayers({ ...ctx, perFeatureColors: true }).find((l) => l.id === ids.fill)!.paint!['fill-color'];
    expect(JSON.stringify(fill)).toContain('"_fill"');
  });

  it('can hide base land and lakes', () => {
    const l = borderLayers({ ...ctx, baseLand: false, lakes: false });
    const vis = (id: string): unknown => l.find((x) => x.id === id)!.layout!.visibility;
    expect(vis(ids.baseLand)).toBe('none');
    expect(vis(ids.lakes)).toBe('none');
    expect(vis(ids.lakeShore)).toBe('none');
  });

  it('draws no text: no symbol layers', () => {
    expect(borderLayers(ctx).filter((l) => (l.type as string) === 'symbol')).toEqual([]);
  });

  it('prefixes every id', () => {
    const p = borderIds('hist-');
    for (const id of [...layerOrder(p), ...Object.keys(borderSources({ ids: p })), p.hatchImage]) expect(id.startsWith('hist-')).toBe(true);
  });
});

describe('base style', () => {
  const style = buildBaseStyle({ theme: { ...DEFAULT_THEME } });

  it('is a globe with an ocean background and an atmosphere that fades out by z7', () => {
    expect(style.projection).toEqual({ type: 'globe' });
    expect((style.layers as { id: string; type: string }[])[0]).toMatchObject({ id: 'ca-ocean', type: 'background' });
    const blend = (style.sky as Record<string, unknown>)['atmosphere-blend'] as unknown[];
    expect(blend.slice(0, 3)).toEqual(['interpolate', ['linear'], ['zoom']]);
    expect(blend.at(-2)).toBe(7);
    expect(blend.at(-1)).toBe(0);
    expect(blend[4]).toBeLessThanOrEqual(0.6); // never 1 — washes colours out
    expect(skySpec({ atmosphere: 1, ocean: '#000' })['atmosphere-blend']).toContain(0.6);
  });

  it('has no glyphs or sprite (no text is drawn on the map)', () => {
    expect(style).not.toHaveProperty('glyphs');
    expect(style).not.toHaveProperty('sprite');
  });

  it('contains no external URL anywhere (style, sources, layers)', () => {
    const everything = { style, sources: borderSources({ ids }), layers: borderLayers(ctx), perFeature: borderLayers({ ...ctx, perFeatureColors: true }) };
    expect(externalUrls(everything)).toEqual([]);
    const json = JSON.stringify(everything);
    expect(json).not.toMatch(/https?:|mapbox:|\/\/[a-z]/i);
  });

  it('externalUrls detects absolute and protocol-relative URLs', () => {
    expect(externalUrls({ a: 'https://x.test/a', b: ['//cdn.test/x'], c: 'mapbox://styles', d: '/local/ok', e: 'ca-hatch' })).toHaveLength(3);
  });
});

describe('own outlines (theme.edge) and lines in a transparent colour', () => {
  const byId = (theme: Partial<typeof DEFAULT_THEME>, perFeatureColors = false): Record<string, LayerSpec> =>
    Object.fromEntries(borderLayers({ ...ctx, theme: { ...DEFAULT_THEME, ...theme }, perFeatureColors }).map((l) => [l.id, l]));

  it('draws no own outlines by default, and the brass glow around a selection', () => {
    const l = byId({});
    expect(l[ids.edge]!.layout!.visibility).toBe('none');
    expect(l[ids.selectGlow]!.layout!.visibility).toBe('visible');
    expect(l[ids.selectLine]!.paint!['line-offset']).toBe(0);
  });

  it('insets each polity outline by half its width, in its own shade; the selection replaces it', () => {
    const l = byId({ edge: 0.2, selection: '#ffffff' });
    const edge = l[ids.edge]!;
    expect(edge.layout!.visibility).toBe('visible');
    expect(edge.filter).toEqual(FILTERS.tier0Polity); // polities only, not unclaimed land
    const w = edge.paint!['line-width'] as unknown[];
    const o = edge.paint!['line-offset'] as unknown[];
    // ['interpolate', ['linear'], ['zoom'], 0, w0, 3, w3, 7, w7]: offset = width / 2 (inset)
    for (const i of [4, 6, 8]) expect(o[i]).toBeCloseTo((w[i] as number) / 2, 9);
    expect(Array.isArray(edge.paint!['line-color'])).toBe(true); // per slot
    const sel = l[ids.selectLine]!;
    expect(sel.paint!['line-width']).toEqual(w);
    expect(sel.paint!['line-offset']).toEqual(o);
    expect(sel.paint!['line-color']).toBe('#ffffff');
    expect(l[ids.selectGlow]!.layout!.visibility).toBe('none');
  });

  it('takes per-feature outline colours from `_edge` with a palette function', () => {
    const l = byId({ edge: 0.2 }, true);
    expect(JSON.stringify(l[ids.edge]!.paint!['line-color'])).toContain('_edge');
  });

  it('skips line layers whose colour is fully transparent', () => {
    const clear = 'rgba(0, 0, 0, 0)';
    const l = byId({ coast: clear, border: clear, hover: clear, lakeShore: clear });
    for (const id of [ids.coast, ids.border, ids.hoverLine, ids.lakeShore]) expect(l[id]!.layout!.visibility).toBe('none');
    const d = byId({});
    for (const id of [ids.coast, ids.border, ids.hoverLine, ids.lakeShore]) expect(d[id]!.layout!.visibility).toBe('visible');
  });
});

describe('relief (an optional raster over the fills)', () => {
  const relief = { tiles: ['/relief/{z}/{x}/{y}.webp'], tileSize: 512, maxzoom: 4, opacity: 0.9 };
  it('adds a same-origin raster source and a layer above the outlines, below the borders', () => {
    const sources = borderSources({ ids, relief });
    expect(sources[ids.reliefSrc]).toEqual({ type: 'raster', tiles: ['/relief/{z}/{x}/{y}.webp'], tileSize: 512, minzoom: 0, maxzoom: 4 });
    const layers = borderLayers({ ...ctx, relief });
    expect(layers.map((l) => l.id)).toEqual(layerOrder(ids, { relief: true }));
    const pos = (id: string): number => layers.findIndex((l) => l.id === id);
    expect(pos(ids.edge)).toBeLessThan(pos(ids.relief));
    expect(pos(ids.relief)).toBeLessThan(pos(ids.border));
    expect(layers[pos(ids.relief)]!.paint!['raster-opacity']).toBe(0.9);
  });
  it('draws the relief first, under the land, with `under` (water only)', () => {
    const layers = borderLayers({ ...ctx, relief: { ...relief, under: true } });
    expect(layers[0]!.id).toBe(ids.relief);
    expect(layers.map((l) => l.id)).toEqual(layerOrder(ids, { relief: true, reliefUnder: true }));
  });
  it('adds neither without relief', () => {
    expect(borderSources({ ids })[ids.reliefSrc]).toBeUndefined();
    expect(borderLayers(ctx).some((l) => l.id === ids.relief)).toBe(false);
  });
});
