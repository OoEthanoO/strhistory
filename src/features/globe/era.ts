/**
 * Pure timeline maths (no DOM, no MapLibre) so it is easy to reason about and
 * reuse. An "era" is the span from one snapshot up to the next.
 */
import type { GlobeSnapshot, GlobeTopic } from './types';

/** [from, to) years covered by the snapshot at `index`. The last era is open-ended. */
export function eraBounds(snapshots: GlobeSnapshot[], index: number): [number, number] {
  const from = snapshots[index].year;
  const to = index + 1 < snapshots.length ? snapshots[index + 1].year : Number.POSITIVE_INFINITY;
  return [from, to];
}

/**
 * How far (in years) a snapshot may lie outside a topic's dates and still count
 * as showing its world. Stops, say, Rwanda (1990s) lighting up on the 1960 map
 * just because 1960–1994 is one era.
 */
const ERA_WINDOW = 10;

/** Is `topic` one of the lit pins when the snapshot at `index` is on screen? */
export function topicInEra(topic: GlobeTopic, snapshots: GlobeSnapshot[], index: number): boolean {
  const year = snapshots[index].year;
  if (topic.snapshot === year) return true;
  const [from, to] = eraBounds(snapshots, index);
  const overlaps = topic.start < to && topic.end >= from;
  const close = year >= topic.start - ERA_WINDOW && year <= topic.end + ERA_WINDOW;
  return overlaps && close;
}

export function indexOfYear(snapshots: GlobeSnapshot[], year: number): number {
  const exact = snapshots.findIndex((s) => s.year === year);
  if (exact !== -1) return exact;
  // Otherwise the latest snapshot at or before `year`.
  let best = 0;
  snapshots.forEach((s, i) => {
    if (s.year <= year) best = i;
  });
  return best;
}

/**
 * Horizontal position (0–1) of a year on the timeline. Snapshots are spaced
 * evenly (they are unevenly spread in time — ten of them fall in the 20th
 * century), and years in between are interpolated within their era.
 */
export function timelineX(years: number[], year: number): number {
  const n = years.length;
  if (n < 2) return 0;
  if (year <= years[0]) return 0;
  if (year >= years[n - 1]) return 1;
  let i = 0;
  while (i < n - 2 && year >= years[i + 1]) i++;
  const frac = (year - years[i]) / (years[i + 1] - years[i]);
  return (i + frac) / (n - 1);
}

/** Packs [x0, x1] intervals into as few rows as possible (greedy). Returns a lane per item. */
export function packLanes(intervals: Array<[number, number]>, gap = 0.006): number[] {
  const order = intervals.map((_, i) => i).sort((a, b) => intervals[a][0] - intervals[b][0]);
  const laneEnds: number[] = [];
  const lanes = new Array<number>(intervals.length);
  for (const i of order) {
    const [x0, x1] = intervals[i];
    let lane = laneEnds.findIndex((end) => end + gap <= x0);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(x1);
    } else {
      laneEnds[lane] = x1;
    }
    lanes[i] = lane;
  }
  return lanes;
}

export function formatRange(start: number, end: number): string {
  return start === end ? String(start) : `${start}–${end}`;
}
