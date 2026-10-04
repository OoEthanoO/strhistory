// Text formatting shared by the globe's UI (years, spans, areas, polity kinds).
// Years follow the Alex's Atlas convention: historical numbering, no year 0.
// Ported from the Alex's Atlas reference site, apps/site/src/format.ts (same names,
// signatures and behaviour; its tests are apps/site/src/format.test.ts).
import { formatYear } from '@alexs-atlas/borders';
import type { PolityInfo, PolityKind, PolityProps } from '@alexs-atlas/borders';

/**
 * Visible year: "500 BCE", "33 CE", "1453". CE is spelled out below 1000 so early
 * dates are not mistaken for BCE ones (same rule as the timeline's readout).
 */
export function displayYear(y: number): string {
  return y > 0 && y < 1000 ? formatYear(y, { ce: true }) : formatYear(y);
}

/** Year for assistive technology: every year carries its era ("1453 CE"). */
export function spokenYear(y: number): string {
  return formatYear(y, { ce: true });
}

/**
 * An inclusive span: "1305–1923", "27 BCE – 395" (spaced when it starts BCE), a single
 * year when from === to, and "present" for spans reaching the dataset's present year.
 */
export function formatSpan(from: number, to: number, present?: number): string {
  const end = present !== undefined && to >= present ? 'present' : formatYear(to);
  const start = formatYear(from);
  if (from === to) return start;
  const spaced = from < 0 || (to < 0 && end !== 'present');
  return spaced ? `${start} – ${end}` : `${start}–${end}`;
}

/** Spans of a polity index entry, sorted, as text: "629–632, 661–731". */
export function formatSpans(spans: readonly (readonly [number, number])[], present?: number): string {
  return [...spans]
    .sort((a, b) => a[0] - b[0])
    .map(([a, b]) => formatSpan(a, b, present))
    .join(', ');
}

/** First and last year of a polity's spans, or null when it has none. */
export function lifespan(info: Pick<PolityInfo, 'spans'> | undefined): { from: number; to: number } | null {
  const spans = info?.spans;
  if (!spans || spans.length === 0) return null;
  let from = Infinity;
  let to = -Infinity;
  for (const [a, b] of spans) {
    if (a < from) from = a;
    if (b > to) to = b;
  }
  return { from, to };
}

/** Whether `year` lies inside one of the spans (inclusive). */
export function aliveIn(spans: readonly (readonly [number, number])[] | undefined, year: number): boolean {
  return !!spans?.some(([a, b]) => a <= year && year <= b);
}

/**
 * The year inside `spans` closest to `year` (ties go to the earlier year), or null
 * when there are no spans. Used when a chosen polity is not on the map in the year shown.
 */
export function nearestYearIn(spans: readonly (readonly [number, number])[] | undefined, year: number): number | null {
  if (!spans || spans.length === 0) return null;
  let best: number | null = null;
  let bestDist = Infinity;
  for (const [a, b] of spans) {
    const y = year < a ? a : year > b ? b : year;
    // Distance on the astronomical axis (there is no year 0 between −1 and 1).
    const dist = Math.abs(astro(y) - astro(year));
    if (dist < bestDist || (dist === bestDist && best !== null && y < best)) {
      best = y;
      bestDist = dist;
    }
  }
  return best;
}

const astro = (y: number): number => (y < 0 ? y + 1 : y);

const KIND_LABELS: Record<PolityKind, string> = {
  state: 'State',
  dependency: 'Dependency',
  indigenous: 'Indigenous nation',
  disputed: 'Disputed area',
  other: 'Other polity',
  unclaimed: 'Unclaimed land',
};

/** "State", "Dependency", "Indigenous nation", … */
export function kindLabel(kind: PolityKind | string): string {
  return KIND_LABELS[kind as PolityKind] ?? 'Polity';
}

const NUMBER = new Intl.NumberFormat('en-US');
const COMPACT = new Intl.NumberFormat('en-US', { maximumSignificantDigits: 2 });

/** "≈ 1,230,000 km²" with two significant figures above 10,000 km² (areas are approximate). */
export function formatArea(km2: number): string {
  if (!Number.isFinite(km2) || km2 <= 0) return '—';
  if (km2 < 1) return '< 1 km²';
  const rounded = km2 >= 10_000 ? Number(COMPACT.format(km2).replace(/,/g, '')) : Math.round(km2);
  return `≈ ${NUMBER.format(rounded)} km²`;
}

/** "1 polity", "94 polities". */
export function countPolities(n: number): string {
  return n === 1 ? '1 polity' : `${NUMBER.format(n)} polities`;
}

/** Wikipedia article URL (English) from the index's article title. */
export function wikipediaUrl(title: string): string {
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_')).replace(/%2F/g, '/')}`;
}

/** Wikidata item URL; null unless the id looks like a Q-id. */
export function wikidataUrl(qid: string): string | null {
  return /^Q[1-9]\d*$/.test(qid) ? `https://www.wikidata.org/wiki/${qid}` : null;
}

/** The "controlled by" / "part of" line for a feature, skipping self-references. */
export function relationLines(props: Pick<PolityProps, 'name' | 'partof' | 'subjecto'>): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const self = props.name.trim().toLowerCase();
  if (props.subjecto && props.subjecto.trim().toLowerCase() !== self) out.push({ label: 'Controlled by', value: props.subjecto });
  if (props.partof && props.partof.trim().toLowerCase() !== self) out.push({ label: 'Part of', value: props.partof });
  return out;
}
