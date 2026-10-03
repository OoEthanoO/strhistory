// User-visible strings of the timeline (override any of them with `labels`).

import { displayYear, spokenYear } from './years.js';

export interface TimelineLabels {
  /** Accessible name of the whole timeline. */
  timeline: string;
  /** Accessible name of the year slider. */
  slider: string;
  /** Keyboard help, read after the slider's value. */
  sliderHelp: string;
  /** Accessible name of the typed-year field. */
  yearField: string;
  /** Error shown for input that is not a year in range. */
  invalidYear(min: string, max: string): string;
  play: string;
  pause: string;
  /** Accessible name of the speed menu. */
  speed: string;
  stepBack(years: number): string;
  stepForward(years: number): string;
  prevChange: string;
  nextChange: string;
  /** Description of the highlighted lifespan band (years already formatted). */
  highlight(spans: string): string;
  /** Year text on ticks, in the field and in the hover readout ("500 BCE", "1453"). */
  formatYear(year: number): string;
  /** Year text for assistive technology (`aria-valuetext`: "500 BCE", "1453 CE"). */
  spokenYear(year: number): string;
}

const plural = (n: number): string => (n === 1 ? '1 year' : `${n} years`);

export const DEFAULT_TIMELINE_LABELS: Readonly<TimelineLabels> = Object.freeze({
  timeline: 'Timeline',
  slider: 'Year',
  sliderHelp:
    'Arrow keys move one year, Shift with arrows ten years, Page Up and Page Down a larger step. ' +
    'Open and close square brackets jump to the previous and next border change. Space plays or pauses.',
  yearField: 'Go to year',
  invalidYear: (min: string, max: string) => `Enter a year from ${min} to ${max}, like 1453, 500 BC or AD 33`,
  play: 'Play',
  pause: 'Pause',
  speed: 'Playback speed',
  stepBack: (n: number) => `Back ${plural(n)}`,
  stepForward: (n: number) => `Forward ${plural(n)}`,
  prevChange: 'Previous border change',
  nextChange: 'Next border change',
  highlight: (spans: string) => `Highlighted on the timeline: ${spans}`,
  formatYear: displayYear,
  spokenYear,
});
