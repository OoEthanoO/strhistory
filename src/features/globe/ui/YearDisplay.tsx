// The large year at the top centre (Newsreader). Visual only: the timeline's slider
// carries the accessible value and the live region announces changes. It dims gently
// while the borders of a new year load (`data-loading`). Ported from the Alex's Atlas
// reference site, apps/site/src/ui/year-display.ts.
import type { JSX } from 'react';
import { formatYear } from '@alexs-atlas/borders';

/** The number and era parts of a year: "500" + "BCE", "33" + "CE", "1453" + "". */
function splitYear(y: number): { num: string; era: string } {
  const text = formatYear(y); // "500 BCE" | "1453"
  const [num = text, era = ''] = y < 0 ? text.split(' ') : [text, y < 1000 ? 'CE' : ''];
  return { num, era };
}

export function YearDisplay({ year, loading }: { year: number; loading: boolean }): JSX.Element {
  const { num, era } = splitYear(year);
  return (
    <div className="year-display" aria-hidden="true" data-loading={loading ? 'true' : undefined}>
      <span className="year-display__num">{num}</span>
      <span className="year-display__era" hidden={!era}>
        {era}
      </span>
    </div>
  );
}
