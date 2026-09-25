import { z } from 'astro/zod';

/**
 * A point on the globe's timeline. Each needs a matching border file at
 * public/data/snapshots/world_<year>.geojson — run `npm run data:snapshots`
 * after adding one. Files live in src/content/snapshots/<year>.md.
 */
export const snapshotSchema = z.object({
  year: z.number().int(),
  title: z.string(),
  summary: z.string(),
  highlights: z.array(z.string()).default([]),
});
