// Contract tests for the built dataset's manifest and files (root AGENTS.md §5.2).
// Run after `npm run data:build` (or the --dev build); skipped when no dataset exists.
import { describe, expect, it } from 'vitest';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DATA, CONFIG, hasData, readData, readDataJson } from './helpers.mjs';

const PROP_KEYS = ['id', 'rid', 'pid', 'name', 'from', 'to', 'kind', 'tier', 'power', 'partof', 'subjecto', 'disputed', 'precision', 'c', 'a', 'lx', 'ly', 'src'];
const KINDS = ['state', 'dependency', 'indigenous', 'disputed', 'other', 'unclaimed'];

describe.skipIf(!hasData)('manifest.json', () => {
  const m = hasData ? readDataJson('manifest.json') : null;

  it('has the contract shape', () => {
    expect(m.schema).toBe('alexs-atlas.borders/1');
    expect(m.dataset).toMatch(/^alexs-atlas-borders(-dev)?$/);
    expect(typeof m.version).toBe('string');
    expect(new Date(m.built).toISOString()).toBe(m.built);
    expect(m.years).toEqual({ convention: 'historical-no-zero', from: CONFIG.years.first, to: CONFIG.years.present, present: CONFIG.years.present, cutover: CONFIG.years.cutover });
    expect(m.lods).toEqual(CONFIG.lods.map(({ id, toleranceM, minZoom }) => ({ id, toleranceM, minZoom })));
    expect(m.palette).toEqual({ size: CONFIG.palette.size });
    expect(typeof m.polities).toBe('string');
    expect(Object.keys(m.base.land).sort()).toEqual(m.lods.map((l) => l.id).sort());
    expect(Object.keys(m.base.lakes).sort()).toEqual(m.lods.map((l) => l.id).sort());
    for (const c of m.chunks) {
      expect(Object.keys(c).sort()).toEqual(['bytes', 'files', 'from', 'id', 'records', 'to']);
      expect(c.id).toMatch(/^[a-z0-9._-]+$/);
      expect(Object.keys(c.files).sort()).toEqual(m.lods.map((l) => l.id).sort());
      expect(c.records).toBeGreaterThan(0);
    }
  });

  it('frames are sorted change years starting at the first year, without year 0', () => {
    expect(m.frames[0]).toBe(m.years.from);
    expect(m.frames).not.toContain(0);
    for (let i = 1; i < m.frames.length; i++) expect(m.frames[i]).toBeGreaterThan(m.frames[i - 1]);
    expect(m.frames.at(-1)).toBeLessThanOrEqual(m.years.present);
    expect(m.frames).toContain(m.years.cutover);
  });

  it('lists sources with the attribution of root AGENTS.md §6', () => {
    const ids = m.sources.map((s) => s.id);
    expect(ids).toContain('cliopatria');
    expect(ids).toContain('naturalearth');
    for (const s of m.sources) for (const k of ['id', 'name', 'version', 'url', 'license', 'spdx', 'attribution']) expect(typeof s[k], `${s.id}.${k}`).toBe('string');
    const clio = m.sources.find((s) => s.id === 'cliopatria');
    expect(clio.attribution).toMatch(/^Historical borders: Cliopatria \(Seshat Global History Databank\), Bennett et al\., Scientific Data 12, 247 \(2025\), doi:10\.1038\/s41597-025-04516-9, CC BY 4\.0 — modified \(/);
    if (m.dataset === 'alexs-atlas-borders') {
      expect(clio.attribution).toContain('modified (leaf polities only, clipped to Natural Earth land, islands assigned, corrected by Alex’s Atlas overrides).');
      expect(ids).toContain('override');
    }
    expect(m.sources.find((s) => s.id === 'naturalearth').attribution).toBe('Made with Natural Earth.');
    expect(m.attribution.text).toContain('Made with Natural Earth.');
    expect(m.attribution.html).toContain('<i>Scientific Data</i>');
    expect(m.attribution.html).not.toMatch(/<script|on\w+=/i);
  });

  it('references only existing, lower-case, content-hashed files', () => {
    const files = [m.polities, ...Object.values(m.base.land), ...Object.values(m.base.lakes), ...m.chunks.flatMap((c) => Object.values(c.files))];
    for (const f of files) {
      expect(f).toMatch(/^[a-z0-9._/-]+\.json$/);
      expect(existsSync(join(DATA, f)), f).toBe(true);
      const hash = f.match(/\.([0-9a-f]{8})\.(topo\.)?json$/)?.[1];
      expect(hash, `${f} carries a content hash`).toBeTruthy();
      expect(createHash('sha256').update(readData(f)).digest('hex').slice(0, 8), f).toBe(hash);
    }
    for (const f of ['ATTRIBUTION.md', 'LICENSE.md', 'sources.json', 'qa-report.json']) expect(existsSync(join(DATA, f)), f).toBe(true);
  });

  it('chunk features carry exactly the PolityProps of the contract', () => {
    const t = readDataJson(m.chunks.at(-1).files[m.lods[0].id]);
    expect(Object.keys(t.objects)).toEqual(['polities']);
    for (const g of t.objects.polities.geometries) {
      expect(['Polygon', 'MultiPolygon']).toContain(g.type);
      expect(Object.keys(g.properties)).toEqual(PROP_KEYS);
      const p = g.properties;
      expect(g.id).toBe(p.id);
      expect(Number.isInteger(p.id) && p.id > 0).toBe(true);
      expect(KINDS).toContain(p.kind);
      expect([0, 1]).toContain(p.tier);
      expect(p.c).toBeGreaterThanOrEqual(0);
      expect(p.c).toBeLessThan(m.palette.size);
      expect(p.from).not.toBe(0);
      expect(p.to).not.toBe(0);
      if (p.kind === 'unclaimed') {
        expect(p.pid).toBe('none');
        expect(p.name).toBe('');
      }
    }
  });

  it('polity index entries have name, kind, spans, bbox and src', () => {
    const index = readDataJson(m.polities);
    const entries = Object.entries(index);
    expect(entries.length).toBeGreaterThan(0);
    for (const [pid, e] of entries) {
      expect(pid).toMatch(/^(clio|ne|ovr):[a-z0-9][a-z0-9-]*$/);
      expect(typeof e.name).toBe('string');
      expect(KINDS).toContain(e.kind);
      expect(Array.isArray(e.spans) && e.spans.length > 0).toBe(true);
      for (const [a, b] of e.spans) expect(a).toBeLessThanOrEqual(b);
      expect(e.bbox).toHaveLength(4);
      expect(typeof e.src).toBe('string');
    }
  });
});
