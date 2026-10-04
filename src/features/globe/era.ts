/** Calendar helpers are independent of the curriculum and available map files. */
import type { GlobeSnapshot, GlobeTopic } from './types';
export { formatYear, formatYearRange as formatRange } from '../../lib/format.ts';

export const FIRST_YEAR = -300000;
export const DEFAULT_YEAR = 1789;

/** Note dates are inclusive. A nearby snapshot never makes a pin visible. */
export function topicInYear(topic: Pick<GlobeTopic, 'start' | 'end'>, year: number): boolean {
  return topic.start <= year && year <= topic.end;
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
