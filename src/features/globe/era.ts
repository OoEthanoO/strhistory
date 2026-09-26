/** Calendar helpers are independent of the curriculum and available map files. */
import type { GlobeSnapshot, GlobeTopic } from './types';
export { formatYear, formatYearRange as formatRange } from '../../lib/format.ts';

export const FIRST_YEAR = -300000;
export const DEFAULT_YEAR = 1789;

/** Note dates are inclusive. A nearby snapshot never makes a pin visible. */
export function topicInYear(topic: Pick<GlobeTopic, 'start' | 'end'>, year: number): boolean {
  return topic.start <= year && year <= topic.end;
}

export function topicInEra(topic: GlobeTopic, snapshots: GlobeSnapshot[], index: number): boolean {
  return topicInYear(topic, snapshots[index].year);
}

export function clampYear(year: number, currentYear: number): number {
  const clamped = Math.max(FIRST_YEAR, Math.min(currentYear, Math.round(year)));
  return clamped === 0 ? 1 : clamped;
}

/** Latest contextual snapshot at or before the selected year. */
export function indexOfYear(snapshots: GlobeSnapshot[], year: number): number {
  let best = -1;
  snapshots.forEach((snapshot, index) => {
    if (snapshot.year <= year) best = index;
  });
  return best;
}

/** Nonlinear scale gives early human history and recent centuries room to explore. */
export function timelineX(years: number[], year: number): number {
  if (years.length < 2 || year <= years[0]) return 0;
  if (year >= years[years.length - 1]) return 1;
  let index = 0;
  while (index < years.length - 2 && year >= years[index + 1]) index++;
  return (index + (year - years[index]) / (years[index + 1] - years[index])) / (years.length - 1);
}

export function yearAtTimelineX(years: number[], position: number): number {
  const scaled = Math.max(0, Math.min(1, position)) * (years.length - 1);
  const index = Math.min(years.length - 2, Math.floor(scaled));
  const year = Math.round(years[index] + (scaled - index) * (years[index + 1] - years[index]));
  return year === 0 ? 1 : year;
}
