// The timeline's only import from @alexs-atlas/borders: the shared year helpers
// (root AGENTS.md §5.3), plus the two ways the timeline prints a year.

import { addYears, clampYear, formatYear, parseYear } from '@alexs-atlas/borders';

export { addYears, clampYear, formatYear, parseYear };

/** Matches an era marker already present in a formatted year. */
const ERA = /\b(BCE|BC|CE|AD)\b/;

/** Screen-reader text: "500 BCE", "1453 CE" (every year carries its era). */
export function spokenYear(y: number): string {
  const s = formatYear(y, { ce: true });
  return y > 0 && !ERA.test(s) ? `${s} CE` : s;
}

/**
 * Visible text: "500 BCE", "33 CE", "1453". CE is spelled out below 1000 so early
 * dates are not mistaken for BCE ones next to a BCE label.
 */
export function displayYear(y: number): string {
  return y > 0 && y < 1000 ? spokenYear(y) : formatYear(y);
}
