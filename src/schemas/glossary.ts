import { reference } from 'astro:content';
import { z } from 'astro/zod';

/**
 * A key term. Notes reference it with <Term id="<file-name>">…</Term>; clicking
 * the term reveals `definition` and `significance`.
 * Files live in src/content/glossary/<id>.md.
 */
export const glossarySchema = z.object({
  term: z.string(),
  /** What it is — one plain sentence. */
  definition: z.string(),
  /** Why it matters — the point a strong IB answer would make. 1–3 sentences. */
  significance: z.string(),
  /** Optional date or period, e.g. "1938" or "1928–1941". */
  when: z.coerce.string().optional(),
  related: z.array(reference('glossary')).default([]),
});
