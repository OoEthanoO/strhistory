/**
 * Build-time loader: turns content collections into the small JSON payload the
 * globe island needs. Runs in Astro frontmatter, never in the browser.
 */
import { getEntry } from 'astro:content';
import { getSnapshots, getTopics, snapshotYearFor } from '@/lib/content';
import type { GlobeData } from './types';

export async function getGlobeData(): Promise<GlobeData> {
  const snapshots = await getSnapshots();
  const years = snapshots.map((s) => s.data.year);
  const topics = await getTopics();

  return {
    currentYear: new Date().getFullYear(),
    snapshots: snapshots.map((s) => ({
      year: s.data.year,
      borderYear: s.data.borderYear === undefined ? s.data.year : s.data.borderYear,
      title: s.data.title,
      summary: s.data.summary,
      highlights: s.data.highlights,
    })),
    topics: await Promise.all(
      topics.map(async (t) => {
        const unit = await getEntry(t.data.unit);
        return {
          slug: t.id,
          href: `/topics/${t.id}`,
          title: t.data.title,
          shortTitle: t.data.shortTitle ?? t.data.title,
          summary: t.data.summary,
          start: t.data.period.start,
          end: t.data.period.end,
          place: t.data.location.place,
          lat: t.data.location.lat,
          lng: t.data.location.lng,
          unitTitle: unit?.data.title ?? '',
          paper: unit?.data.paper ?? 2,
          level: t.data.level,
          curriculum: t.data.curriculum,
          snapshot: snapshotYearFor(t, years),
        };
      }),
    ),
  };
}
