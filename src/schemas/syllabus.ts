import { z } from 'astro/zod';

/**
 * A unit of the IB History syllabus (a prescribed subject, a world history
 * topic, or an HL regional option). Topics point at one of these via `unit`.
 * Files live in src/content/syllabus/<id>.md.
 */
export const syllabusSchema = z.object({
  title: z.string(),
  curriculum: z.enum(['2028', 'archive']).default('archive'),
  /** Which exam paper assesses this unit. */
  paper: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  /** e.g. "Prescribed subject 3", "World history topic 10", "HL option: History of Europe". */
  component: z.string(),
  levels: z.enum(['SL & HL', 'HL only']),
  description: z.string(),
  /** Sort order within its paper. */
  order: z.number().default(100),
});
