/** Small, dependency-free formatting helpers shared across pages. */

/** 1931, 1941 → "1931–1941"; 1936, 1936 → "1936"; negative years → BCE. */
export function formatYearRange(start: number, end: number): string {
  if (start === end) return formatYear(start);
  if (start < 0 && end < 0) return `${Math.abs(start)}–${Math.abs(end)} BCE`;
  return `${formatYear(start)}–${formatYear(end)}`;
}

export function formatYear(year: number): string {
  return year < 0 ? `${Math.abs(year)} BCE` : String(year);
}

// YAML date-only values are UTC midnight; do not shift them into the prior day.
const dateFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });

export function formatDate(date: Date): string {
  return dateFmt.format(date);
}

/** "Paper 2" style label for an exam paper number. */
export const paperLabel = (paper: number) => `Paper ${paper}`;

export function slugify(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
