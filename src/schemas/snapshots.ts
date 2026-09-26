import { z } from 'astro/zod';

/**
 * A point on the exploration timeline, independent of the taught curriculum.
 * By default a matching world_<year>.geojson is required. Set borderYear to
 * another available year, or null for a land-only context without political borders.
 */
export const snapshotSchema = z.object({
  year: z.number().int(),
  title: z.string(),
  summary: z.string(),
  highlights: z.array(z.string()).default([]),
  /** Omit for this year's border file; null means a land-only overview. */
  borderYear: z.number().int().nullable().optional(),
});
