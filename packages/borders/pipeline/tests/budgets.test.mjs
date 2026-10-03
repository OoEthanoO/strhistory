// Size budgets of the built dataset: the l0 file of every chunk stays within
// config.chunks.targetGzipBytesL0 (one-frame chunks that cannot be split are listed
// in qa-report.json → packaging.overBudget), and manifest sizes are the real ones.
import { describe, expect, it } from 'vitest';
import { gzipSync } from 'node:zlib';
import { CONFIG, hasData, readData, readDataJson } from './helpers.mjs';

describe.skipIf(!hasData)('size budgets', () => {
  const m = hasData ? readDataJson('manifest.json') : null;
  const qa = hasData ? readDataJson('qa-report.json') : null;

  it('records the real gzip size of every chunk file', () => {
    const level = qa.packaging?.gzipLevel ?? 6;
    for (const c of m.chunks) {
      for (const l of m.lods) expect(gzipSync(readData(c.files[l.id]), { level }).length, `${c.id} ${l.id}`).toBe(c.bytes[l.id]);
    }
  });

  it('keeps l0 chunks within the target unless they are a single frame', () => {
    const target = CONFIG.chunks.targetGzipBytesL0;
    const allowed = new Set(qa.packaging?.overBudget ?? []);
    for (const c of m.chunks) {
      if (allowed.has(c.id)) {
        const frames = m.frames.filter((y) => y >= c.from && y <= c.to);
        expect(frames.length, `${c.id} is over budget but has several frames`).toBe(1);
        continue;
      }
      expect(c.bytes.l0, c.id).toBeLessThanOrEqual(target);
    }
  });

  it('keeps finer LODs at least as detailed as l0', () => {
    for (const c of m.chunks) expect(c.bytes[m.lods.at(-1).id], c.id).toBeGreaterThanOrEqual(c.bytes[m.lods[0].id] * 0.95);
  });

  it('reports sizes per LOD in the manifest stats', () => {
    for (const l of m.lods) {
      const s = m.stats.gzipBytes[l.id];
      expect(s.total).toBe(m.chunks.reduce((t, c) => t + c.bytes[l.id], 0));
      expect(s.max).toBe(Math.max(...m.chunks.map((c) => c.bytes[l.id])));
    }
  });
});
