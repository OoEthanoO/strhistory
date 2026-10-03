// Contract checks against the built dataset in packages/borders/data (skipped when it
// has not been built). These are the properties the query client relies on; the
// pipeline's own QA covers geometry quality (partition, coasts, overlaps).
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { addYears, createBorders, type Manifest, type PolityInfo, type Position } from './index.js';
import { fileFetch } from './node.js';

const MANIFEST = fileURLToPath(new URL('../data/manifest.json', import.meta.url));
const DATA = fileURLToPath(new URL('../data/', import.meta.url));
const hasData = existsSync(MANIFEST);

interface RawGeometry {
  properties: { id: number; rid: string; pid: string; from: number; to: number; tier: number; kind: string };
}

describe.skipIf(!hasData)('built dataset (packages/borders/data)', () => {
  const borders = createBorders({ manifestUrl: MANIFEST }, { fetch: fileFetch });
  const manifest = (): Promise<Manifest> => borders.ready();
  const raw = (path: string) => JSON.parse(readFileSync(DATA + path, 'utf8'));

  it('has a valid manifest whose chunks cover every year from the first frame on', async () => {
    const m = await manifest();
    expect(m.frames[0]).toBeDefined();
    const chunks = m.chunks;
    expect(chunks[0]?.from).toBeLessThanOrEqual(m.frames[0] as number);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i]?.from, `gap or overlap before chunk ${chunks[i]?.id}`).toBe(addYears(chunks[i - 1]?.to as number, 1));
    }
    expect(chunks.at(-1)?.to).toBe(m.years.to);
    for (const c of chunks) for (const lod of m.lods) expect(c.files[lod.id], `${c.id} lacks ${lod.id}`).toBeTypeOf('string');
  });

  it('changes borders only at frame years (what per-frame memoisation relies on)', async () => {
    const m = await manifest();
    const frames = new Set(m.frames);
    const bad: string[] = [];
    for (const c of m.chunks) {
      const topo = raw(c.files[m.lods[0]?.id as string] as string);
      for (const g of topo.objects.polities.geometries as RawGeometry[]) {
        const { rid, from, to } = g.properties;
        if (to < c.from || from > c.to) bad.push(`${c.id}: ${rid} (${from}..${to}) is outside the chunk`);
        if (from >= c.from && !frames.has(from)) bad.push(`${c.id}: ${rid} starts in ${from}, not a frame`);
        const after = addYears(to, 1);
        if (to <= c.to && after <= m.years.to && !frames.has(after)) bad.push(`${c.id}: ${rid} ends in ${to}, but ${after} is not a frame`);
      }
    }
    expect(bad.slice(0, 20), `${bad.length} problems`).toEqual([]);
  });

  it('answers every chunk’s first and last year with well-formed, indexed polities', async () => {
    const m = await manifest();
    const index: Record<string, PolityInfo> = await borders.polities();
    const problems: string[] = [];
    for (const c of m.chunks) {
      for (const year of new Set([c.from, c.to])) {
        const fc = await borders.bordersAt(year);
        const ids = new Set<number>();
        for (const f of fc.features) {
          const p = f.properties;
          if (!(p.from <= year && year <= p.to)) problems.push(`${year}: ${p.rid} alive ${p.from}..${p.to}`);
          if (f.id !== p.id || ids.has(p.id)) problems.push(`${year}: bad or duplicate id ${String(f.id)}`);
          ids.add(p.id);
          if (p.pid !== 'none') {
            const info = index[p.pid];
            if (!info) problems.push(`${year}: ${p.pid} missing from the polity index`);
            else if (!info.spans.some(([a, b]) => a <= year && year <= b)) problems.push(`${year}: index spans of ${p.pid} miss ${year}`);
          }
          const polys = (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates) as Position[][][];
          if (polys.length === 0) problems.push(`${year}: ${p.rid} has no polygons`);
          for (const ring of polys.flat()) {
            if (ring.length < 4) problems.push(`${year}: ${p.rid} has a ring of ${ring.length} points`);
            if (ring.some(([x, y]) => !((x as number) >= -180 && (x as number) <= 180 && (y as number) >= -90 && (y as number) <= 90))) {
              problems.push(`${year}: ${p.rid} has coordinates out of range`);
            }
          }
        }
        const labels = await borders.labelsAt(year);
        if (labels.features.some((f) => f.properties.kind === 'unclaimed')) problems.push(`${year}: unclaimed label`);
        const lines = await borders.linesAt(year);
        if (fc.features.length > 0 && !lines.features.some((f) => f.properties.kind === 'coast')) problems.push(`${year}: no coast`);
      }
    }
    expect(problems.slice(0, 20), `${problems.length} problems`).toEqual([]);
  });

  it('decodes the base layers', async () => {
    const land = await borders.base('land');
    expect(land.features.length).toBeGreaterThan(0);
    const lakes = await borders.base('lakes');
    expect(lakes.type).toBe('FeatureCollection');
  });
});
