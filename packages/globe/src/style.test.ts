import { describe, expect, it } from 'vitest';
import { DEFAULT_PALETTE } from './palette.js';
import { FILTERS, borderIds, borderLayers, borderSources, buildBaseStyle, externalUrls, fontStack, layerOrder, skySpec, type LayerSpec } from './style.js';
import { DEFAULT_THEME } from './theme.js';

const ids = borderIds('ca-');
const ctx = { ids, theme: { ...DEFAULT_THEME }, palette: DEFAULT_PALETTE, fontFamily: 'Inter Variable, sans-serif' };

describe('layer order (AGENTS.md §5.5)', () => {
  const layers = borderLayers(ctx);

  it('emits the layers in contract order', () => {
    expect(layers.map((l) => l.id)).toEqual(layerOrder(ids));
    const pos = (id: string): number => layers.findIndex((l) => l.id === id);
    // ocean background (base style) → base land → tier-0 fills → borders → tier-1 → lakes → coast → labels → highlight
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
    expect(pos(ids.coast)).toBeLessThan(pos(ids.labels));
    expect(pos(ids.labels)).toBeLessThan(pos(ids.hoverLine));
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
    // Big polities first, small on top; labels sorted by −area.
    expect(byId[ids.fill]!.layout!['fill-sort-key']).toEqual(['-', 0, ['to-number', ['get', 'a'], 0]]);
    expect(byId[ids.labels]!.layout!['symbol-sort-key']).toEqual(['-', 0, ['to-number', ['get', 'a'], 0]]);
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

  it('labels use the host font family (no glyph server) and hide tiny polities at low zoom', () => {
    const labels = borderLayers(ctx).find((l) => l.id === ids.labels)!;
    expect(labels.layout!['text-font']).toEqual(['Inter Variable', 'sans-serif']);
    const filter = JSON.stringify(labels.filter);
    expect(filter).toContain('"zoom"');
    expect(filter).toContain('"unclaimed"');
    expect(fontStack(undefined)).toEqual(['sans-serif']);
    expect(fontStack(`"Inter Variable", system-ui`)).toEqual(['Inter Variable', 'system-ui']);
  });

  it('can hide labels, base land and lakes', () => {
    const l = borderLayers({ ...ctx, labels: false, baseLand: false, lakes: false });
    const vis = (id: string): unknown => l.find((x) => x.id === id)!.layout!.visibility;
    expect(vis(ids.labels)).toBe('none');
    expect(vis(ids.baseLand)).toBe('none');
    expect(vis(ids.lakes)).toBe('none');
    expect(vis(ids.lakeShore)).toBe('none');
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

  it('has no glyphs or sprite by default (labels are drawn locally)', () => {
    expect(style).not.toHaveProperty('glyphs');
    expect(style).not.toHaveProperty('sprite');
    expect(buildBaseStyle({ theme: { ...DEFAULT_THEME }, glyphs: '/glyphs/{fontstack}/{range}.pbf' }).glyphs).toBe('/glyphs/{fontstack}/{range}.pbf');
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

describe("curved labels (labelMode 'curved')", () => {
  const layers = borderLayers({ ...ctx, labelMode: 'curved' });
  const label = layers.find((l) => l.id === ids.labels)!;
  const sources = borderSources({ ids });

  it('draws names along arcs from their own coarse source, in capitals', () => {
    expect(label.source).toBe(ids.labelArcsSrc);
    expect(label.filter).toEqual(FILTERS.labelArcs);
    expect(label.layout!['symbol-placement']).toBe('line-center');
    expect(label.layout!['text-transform']).toBe('uppercase');
    // Size, spacing and colour per arc (computed for the current zoom), never by zoom in the style:
    // MapLibre tests whether a line label fits with its size at zoom 18.
    expect(JSON.stringify(label.layout!['text-size'])).toContain('_px');
    expect(JSON.stringify(label.layout!['text-size'])).not.toContain('zoom');
    expect(JSON.stringify(label.layout!['text-letter-spacing'])).toContain('_ls');
    expect(JSON.stringify(label.paint!['text-color'])).toContain('_ink');
    const arcs = sources[ids.labelArcsSrc]!;
    expect(arcs).toMatchObject({ maxzoom: 2, buffer: 512, tolerance: 0, promoteId: 'id' });
  });

  it('draws no halo when the halo colour is fully transparent', () => {
    expect(label.paint!['text-halo-width']).toBeGreaterThan(0);
    for (const labelMode of ['curved', 'point'] as const) {
      const bare = borderLayers({ ...ctx, labelMode, theme: { ...ctx.theme, labelHalo: 'rgba(0, 0, 0, 0)' } }).find((l) => l.id === ids.labels)!;
      expect(bare.paint!['text-halo-width']).toBe(0);
    }
  });

  it('takes halo width and blur from the theme, capped to the type size, else the label mode defaults', () => {
    expect(label.paint!['text-halo-blur']).toBe(0);
    const glow = borderLayers({ ...ctx, labelMode: 'curved', theme: { ...ctx.theme, labelHaloWidth: 2, labelHaloBlur: 2 } }).find((l) => l.id === ids.labels)!;
    // ['min', 2, ['*', share, ['to-number', ['get', '_px'], 10]]]: never wider than the glyphs' distance field.
    for (const key of ['text-halo-width', 'text-halo-blur']) {
      const e = glow.paint![key] as unknown[];
      expect(e[0]).toBe('min');
      expect(e[1]).toBe(2);
      expect(JSON.stringify(e[2])).toContain('_px');
    }
  });

  it('keeps point labels by default', () => {
    const point = borderLayers(ctx).find((l) => l.id === ids.labels)!;
    expect(point.source).toBe(ids.frameSrc);
    expect(point.layout!['symbol-placement']).toBeUndefined();
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
