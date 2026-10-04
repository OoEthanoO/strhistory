// Runs in the default node environment (no DOM): root AGENTS.md §5.4 requires that
// importing @alexs-atlas/globe touches no DOM, so the timeline module must import
// cleanly during server-side rendering and only need a document when constructed.
import { describe, expect, it, vi } from 'vitest';

// Same fallback as timeline.test.ts: the built package when it resolves, else its sources.
vi.mock('@alexs-atlas/borders', async (importOriginal) => {
  try {
    return await importOriginal();
  } catch {
    const sources = '../../../borders/src/index.js';
    return (await import(/* @vite-ignore */ sources)) as Record<string, unknown>;
  }
});

describe('timeline module', () => {
  it('imports without a DOM and exposes the public API', async () => {
    expect(typeof globalThis.document).toBe('undefined');
    const mod = await import('./index.js');
    expect(Object.keys(mod).sort()).toEqual([
      'DEFAULT_ERAS',
      'DEFAULT_PRESENT_YEAR',
      'DEFAULT_STOPS',
      'DEFAULT_TIMELINE_LABELS',
      'Timeline',
      'createTimeScale',
      'defaultStops',
    ]);
    expect(mod.DEFAULT_STOPS.at(-1)).toEqual([mod.DEFAULT_PRESENT_YEAR, 1]);
    const scale = mod.createTimeScale(mod.DEFAULT_STOPS);
    expect(scale.toYear(scale.toT(-500))).toBe(-500);
  });

  it('needs a container element only when constructed', async () => {
    const { Timeline } = await import('./index.js');
    expect(() => new Timeline(null as unknown as HTMLElement, { min: -3400, max: 2026, value: 1453 })).toThrow(TypeError);
  });
});
