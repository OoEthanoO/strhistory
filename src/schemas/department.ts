import { reference, type SchemaContext } from 'astro:content';
import { z } from 'astro/zod';

/**
 * Schemas for the department pages: teachers, courses, news and study guides.
 * `placeholder: true` marks sample content that should be replaced with real
 * information; the site shows a small "Sample" badge on it.
 */

export const teacherSchema = ({ image }: SchemaContext) =>
  z.object({
    name: z.string(),
    /** e.g. "Head of History", "IB History Teacher". */
    role: z.string(),
    photo: image().optional(),
    photoAlt: z.string().optional(),
    courses: z.array(reference('courses')).default([]),
    email: z.email().optional(),
    education: z.array(z.string()).default([]),
    interests: z.array(z.string()).default([]),
    /** A line the teacher chooses — a favourite quote or their teaching philosophy. */
    quote: z.string().optional(),
    order: z.number().default(100),
    placeholder: z.boolean().default(false),
  });

export const courseSchema = z.object({
  title: z.string(),
  code: z.string().optional(),
  grades: z.string(),
  /** e.g. "IB Diploma · Higher Level". */
  level: z.string(),
  summary: z.string(),
  units: z.array(reference('syllabus')).default([]),
  assessment: z
    .array(z.object({ component: z.string(), weight: z.string(), detail: z.string() }))
    .default([]),
  order: z.number().default(100),
  placeholder: z.boolean().default(false),
});

export const newsSchema = ({ image }: SchemaContext) =>
  z.object({
    title: z.string(),
    date: z.coerce.date(),
    summary: z.string(),
    tags: z.array(z.string()).default([]),
    image: image().optional(),
    imageAlt: z.string().optional(),
    placeholder: z.boolean().default(false),
    draft: z.boolean().default(false),
  });

export const guideSchema = z.object({
  title: z.string(),
  category: z.enum(['Assessment', 'Skills', 'Research']),
  summary: z.string(),
  order: z.number().default(100),
  updated: z.coerce.date().optional(),
});
