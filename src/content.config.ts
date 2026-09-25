/**
 * Content collections. Each collection is a folder under src/content/ with one
 * file per entry, so adding content never means editing a shared list.
 * Schemas live in src/schemas/ — edit those, not this wiring file.
 *
 * Files whose name starts with "_" are ignored (use them for templates).
 */
import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { courseSchema, guideSchema, newsSchema, teacherSchema } from './schemas/department';
import { glossarySchema } from './schemas/glossary';
import { snapshotSchema } from './schemas/snapshots';
import { syllabusSchema } from './schemas/syllabus';
import { topicSchema } from './schemas/topics';

const folder = (name: string, pattern = '**/[^_]*.{md,mdx}') =>
  glob({ base: `./src/content/${name}`, pattern });

export const collections = {
  topics: defineCollection({ loader: folder('topics'), schema: topicSchema }),
  glossary: defineCollection({ loader: folder('glossary'), schema: glossarySchema }),
  syllabus: defineCollection({ loader: folder('syllabus'), schema: syllabusSchema }),
  snapshots: defineCollection({ loader: folder('snapshots'), schema: snapshotSchema }),
  teachers: defineCollection({ loader: folder('teachers'), schema: teacherSchema }),
  courses: defineCollection({ loader: folder('courses'), schema: courseSchema }),
  news: defineCollection({ loader: folder('news'), schema: newsSchema }),
  guides: defineCollection({ loader: folder('guides'), schema: guideSchema }),
};
