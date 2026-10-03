// Rows for the list of polities on the map in the year shown (the search panel's list):
// a frame's features grouped into one row per polity. Ported from the Alex's Atlas
// reference site, apps/site/src/polities.ts (same names and behaviour; its tests are
// apps/site/src/polities.test.ts).
import type { PolityProps } from '@alexs-atlas/borders';
import { kindLabel } from './format';

export interface ListRow {
  pid: string;
  name: string;
  kind: PolityProps['kind'];
  tier: 0 | 1;
  /** Colour slot and colour key of the polity's largest feature (`PolityProps.c`, `.power`). */
  c: number;
  power: string;
  /** Area km² (summed over the polity's features in the frame). */
  area: number;
  from: number;
  to: number;
  /** "Controlled by …" / "Part of …" text, if any. */
  relation?: string;
  precision: PolityProps['precision'];
}

export type SortKey = 'name' | 'kind' | 'area';

const COLLATOR = new Intl.Collator('en', { sensitivity: 'base', numeric: true });

/** Groups a frame's features into one row per polity (unclaimed land skipped). */
export function rowsFromFeatures(features: readonly { properties: PolityProps }[]): ListRow[] {
  const byPid = new Map<string, ListRow & { largest: number }>();
  for (const { properties: p } of features) {
    if (p.kind === 'unclaimed' || !p.pid || p.pid === 'none') continue;
    const row = byPid.get(p.pid);
    if (row) {
      row.area += p.a;
      if (p.a > row.largest) {
        row.largest = p.a;
        row.c = p.c;
        row.power = p.power;
      }
      continue;
    }
    const self = p.name.trim().toLowerCase();
    const relation =
      p.subjecto && p.subjecto.trim().toLowerCase() !== self
        ? `Controlled by ${p.subjecto}`
        : p.partof && p.partof.trim().toLowerCase() !== self
          ? `Part of ${p.partof}`
          : undefined;
    byPid.set(p.pid, {
      pid: p.pid,
      name: p.name || p.pid,
      kind: p.kind,
      tier: p.tier,
      c: p.c,
      power: p.power,
      area: p.a,
      largest: p.a,
      from: p.from,
      to: p.to,
      ...(relation ? { relation } : {}),
      precision: p.precision,
    });
  }
  return [...byPid.values()].map(({ largest: _largest, ...row }) => row);
}

/** Sorts rows in place: name A–Z, kind then name, or area largest first. */
export function sortRows(rows: ListRow[], key: SortKey, dir: 1 | -1): ListRow[] {
  const cmp: Record<SortKey, (a: ListRow, b: ListRow) => number> = {
    name: (a, b) => COLLATOR.compare(a.name, b.name),
    kind: (a, b) => COLLATOR.compare(kindLabel(a.kind), kindLabel(b.kind)) || COLLATOR.compare(a.name, b.name),
    area: (a, b) => a.area - b.area || COLLATOR.compare(a.name, b.name),
  };
  return rows.sort((a, b) => dir * cmp[key](a, b));
}
