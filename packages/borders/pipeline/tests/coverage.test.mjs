// Time coverage and geometry guarantees of the built dataset (root AGENTS.md §5.1–5.2).
import { describe, expect, it } from 'vitest';
import * as topojson from 'topojson-client';
import { hasData, readDataJson, years } from './helpers.mjs';
import { planarRingArea } from '../steps/lib/geo.mjs';

describe.skipIf(!hasData)('chunk year coverage', () => {
  const m = hasData ? readDataJson('manifest.json') : null;

  it('maps every year from the first to the present to exactly one chunk', () => {
    for (const y of years(m.years.from, m.years.present)) {
      const hits = m.chunks.filter((c) => c.from <= y && y <= c.to);
      expect(hits.length, `year ${y}`).toBe(1);
    }
    expect(m.chunks.some((c) => c.from <= 0 && 0 <= c.to && c.from === 0)).toBe(false);
  });

  it('starts every chunk at a frame and respects maxYears and the cut-over', async () => {
    const { CONFIG } = await import('./helpers.mjs');
    const frames = new Set(m.frames);
    for (const c of m.chunks) {
      expect(frames.has(c.from), c.id).toBe(true);
      const span = c.to - c.from + 1 - (c.from < 0 && c.to > 0 ? 1 : 0);
      expect(span, c.id).toBeLessThanOrEqual(CONFIG.chunks.maxYears);
      expect(c.from < m.years.cutover && c.to >= m.years.cutover, `${c.id} crosses the cut-over`).toBe(false);
    }
  });

  // Unclaimed pieces that collapse completely on a coarse LOD's grid are left out of that file
  // (no stand-in: unclaimed land has no identity and base/land draws it); the packaging step
  // reports them per chunk and LOD in qa-report.json → packaging.alignment.chunks.
  const collapsed = new Map();
  try {
    for (const r of readDataJson('qa-report.json').packaging?.alignment?.chunks ?? []) collapsed.set(`${r.chunk} ${r.lod}`, r.collapsedUnclaimed ?? 0);
  } catch {
    /* no QA report: nothing collapsed */
  }

  it('holds exactly the records overlapping each chunk, with unique ids', () => {
    for (const c of m.chunks) {
      const t = readDataJson(c.files[m.lods[0].id]);
      const geoms = t.objects.polities.geometries;
      expect(geoms.length, c.id).toBe(c.records - (collapsed.get(`${c.id} ${m.lods[0].id}`) ?? 0));
      const ids = geoms.map((g) => g.id);
      expect(new Set(ids).size, `${c.id} ids unique`).toBe(ids.length);
      for (const g of geoms) {
        expect(g.properties.from <= c.to && g.properties.to >= c.from, `${c.id}: ${g.properties.rid}`).toBe(true);
      }
    }
  });

  it('keeps record ids and properties identical across LODs (only collapsed unclaimed pieces may be missing)', () => {
    for (const c of [m.chunks[0], m.chunks[Math.floor(m.chunks.length / 2)], m.chunks.at(-1)]) {
      const byLod = m.lods.map((l) => new Map(readDataJson(c.files[l.id]).objects.polities.geometries.map((g) => [g.id, g.properties])));
      const all = new Map(byLod.flatMap((x) => [...x]));
      m.lods.forEach((l, i) => {
        const missing = [...all.keys()].filter((id) => !byLod[i].has(id));
        expect(missing.every((id) => all.get(id).kind === 'unclaimed'), `${c.id} ${l.id}: only unclaimed pieces may collapse`).toBe(true);
        expect(missing.length, `${c.id} ${l.id}`).toBeLessThanOrEqual(c.records - byLod[i].size);
        expect(byLod[i].size, `${c.id} ${l.id}`).toBe(c.records - (collapsed.get(`${c.id} ${l.id}`) ?? 0));
        for (const [id, p] of byLod[i]) expect(p, `${c.id} ${l.id} ${p.rid}`).toEqual(all.get(id));
      });
    }
  });

  it('decodes to RFC 7946 polygons (exterior rings counter-clockwise, lon/lat in range)', () => {
    const c = m.chunks.at(-1);
    const t = readDataJson(c.files[m.lods[1].id]);
    const fc = topojson.feature(t, t.objects.polities);
    let rings = 0;
    for (const f of fc.features) {
      expect(f.geometry, f.properties.rid).toBeTruthy();
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
      expect(polys.length).toBeGreaterThan(0);
      for (const p of polys) {
        // tiny rings can be numerically flat after quantization; check the ones with area
        const a = planarRingArea(p[0]);
        if (Math.abs(a) > 1e-6) {
          expect(a, `${f.properties.rid} exterior`).toBeGreaterThan(0);
          rings++;
        }
        for (const [x, y] of p.flat()) {
          expect(x).toBeGreaterThanOrEqual(-180.000001);
          expect(x).toBeLessThanOrEqual(180.000001);
          expect(y).toBeGreaterThanOrEqual(-90.000001);
          expect(y).toBeLessThanOrEqual(90.000001);
        }
      }
    }
    expect(rings).toBeGreaterThan(0);
  });
});
