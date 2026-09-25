/**
 * Content queries shared by pages. Pages should go through these helpers rather
 * than calling getCollection directly, so ordering and draft handling stay
 * consistent across the site.
 */
import { getCollection, getEntry, type CollectionEntry } from 'astro:content';

export type Topic = CollectionEntry<'topics'>;
export type Snapshot = CollectionEntry<'snapshots'>;
export type Unit = CollectionEntry<'syllabus'>;

const isPublished = (entry: { data: { draft?: boolean } }) => import.meta.env.DEV || !entry.data.draft;

/** Published topics, oldest first. */
export async function getTopics(): Promise<Topic[]> {
  const topics = await getCollection('topics', isPublished);
  return topics.sort((a, b) => a.data.period.start - b.data.period.start || a.data.title.localeCompare(b.data.title));
}

/** Snapshots, oldest first. */
export async function getSnapshots(): Promise<Snapshot[]> {
  const snapshots = await getCollection('snapshots');
  return snapshots.sort((a, b) => a.data.year - b.data.year);
}

/** Syllabus units ordered by paper, then their own order. */
export async function getUnits(): Promise<Unit[]> {
  const units = await getCollection('syllabus');
  return units.sort((a, b) => a.data.paper - b.data.paper || a.data.order - b.data.order);
}

/** The snapshot year the globe should open on for a topic. */
export function snapshotYearFor(topic: Topic, snapshotYears: number[]): number {
  if (topic.data.snapshot !== undefined) return topic.data.snapshot;
  const atOrBefore = snapshotYears.filter((y) => y <= topic.data.period.start);
  return atOrBefore.length ? atOrBefore[atOrBefore.length - 1] : snapshotYears[0];
}

/** Glossary lookup used by <Term>. Throws on unknown ids so typos fail the build. */
export async function getTerm(id: string) {
  const entry = await getEntry('glossary', id);
  if (!entry) {
    throw new Error(
      `Unknown glossary term "${id}". Add src/content/glossary/${id}.md or fix the <Term id> in the notes.`,
    );
  }
  return entry;
}

export async function getTeachers() {
  const teachers = await getCollection('teachers');
  return teachers.sort((a, b) => a.data.order - b.data.order || a.data.name.localeCompare(b.data.name));
}

export async function getCourses() {
  const courses = await getCollection('courses');
  return courses.sort((a, b) => a.data.order - b.data.order);
}

export async function getNews() {
  const news = await getCollection('news', isPublished);
  return news.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export async function getGuides() {
  const guides = await getCollection('guides');
  return guides.sort((a, b) => a.data.order - b.data.order);
}

/**
 * Which topics use each glossary term. Built by scanning the raw MDX for
 * <Term id="…">, so it needs no bookkeeping from authors.
 */
export async function getTermUsage(): Promise<Map<string, Topic[]>> {
  const usage = new Map<string, Topic[]>();
  for (const topic of await getTopics()) {
    for (const id of termIdsIn(topic.body ?? '')) {
      const list = usage.get(id) ?? [];
      if (!list.includes(topic)) list.push(topic);
      usage.set(id, list);
    }
  }
  return usage;
}

export function termIdsIn(mdx: string): string[] {
  const ids = new Set<string>();
  for (const m of mdx.matchAll(/<Term\s+[^>]*id=["']([^"']+)["']/g)) ids.add(m[1]);
  return [...ids];
}
