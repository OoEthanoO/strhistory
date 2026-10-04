// Shared helpers for the pipeline tests: locate the built dataset and read it.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PATHS, CONFIG } from '../steps/lib/context.mjs';

export const DATA = process.env.ALEXS_ATLAS_DATA ?? PATHS.data;
export const MANIFEST = join(DATA, 'manifest.json');
export const hasData = existsSync(MANIFEST);
export const readData = (rel) => readFileSync(join(DATA, rel));
export const readDataJson = (rel) => JSON.parse(readFileSync(join(DATA, rel), 'utf8'));
export { CONFIG };

/** Every historical year first..last (no year 0). */
export function* years(first, last) {
  for (let y = first; y <= last; y++) if (y !== 0) yield y;
}
