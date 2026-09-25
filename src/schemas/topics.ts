import { reference } from 'astro:content';
import { z } from 'astro/zod';

/**
 * An IB History topic: one pin on the globe and one page of study notes.
 * Files live in src/content/topics/<slug>.mdx — the filename is the URL slug.
 */
export const topicSchema = z.object({
  title: z.string(),
  /** Short label shown next to the pin on the globe. Defaults to `title`. */
  shortTitle: z.string().max(36).optional(),
  /** The IB syllabus unit this topic belongs to (src/content/syllabus/<id>.md). */
  unit: reference('syllabus'),
  /** Years covered. Controls which timeline eras show the pin. */
  period: z
    .object({ start: z.number().int(), end: z.number().int() })
    .refine((p) => p.end >= p.start, { message: 'period.end must be on or after period.start' }),
  /** Where the pin goes. `place` is shown to students ("Mukden, Manchuria"). */
  location: z.object({
    place: z.string(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  /** One or two sentences, shown on cards, pin previews and search results. */
  summary: z.string().max(320),
  /** The big questions the notes answer — IB-style, shown at the top of the page. */
  keyQuestions: z.array(z.string()).default([]),
  related: z.array(reference('topics')).default([]),
  authors: z.array(reference('teachers')).default([]),
  /**
   * Snapshot year the globe should show for this topic. Defaults to the latest
   * snapshot at or before `period.start`.
   */
  snapshot: z.number().int().optional(),
  updated: z.coerce.date().optional(),
  /** Drafts build in `npm run dev` but are left out of production builds. */
  draft: z.boolean().default(false),
});
