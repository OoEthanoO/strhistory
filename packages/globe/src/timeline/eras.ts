// Era band configuration. The band is decoration for orientation only: hosts
// replace the eras freely (or pass `eras: false` to hide the band).

export interface TimelineEra {
  /** First year (inclusive, historical numbering). Omitted: from the timeline's start. */
  from?: number;
  /** Last year (inclusive). Omitted: to the timeline's end. */
  to?: number;
  /**
   * Text in the band. Shown inside the era's segment when it fits; the current era's
   * label is always shown (floating over its neighbours if needed).
   */
  label: string;
  /** Shorter text tried when `label` does not fit its segment. */
  short?: string;
  /** Tooltip text. Default: label and years. */
  title?: string;
}

/**
 * Default eras: the broad periods used in school world-history courses — the six
 * periods of the College Board's AP World History framework (2011–2019): to c. 600 BCE,
 * c. 600 BCE–c. 600 CE, c. 600–c. 1450, c. 1450–c. 1750, c. 1750–c. 1900,
 * c. 1900–present. World-scale rather than European names (no "Middle Ages");
 * boundaries are conventional and approximate, which the tooltips say ("c.").
 */
export const DEFAULT_ERAS: readonly TimelineEra[] = Object.freeze([
  { to: -601, label: 'Early civilizations', title: 'Early civilizations · to c. 600 BCE' },
  { from: -600, to: 600, label: 'Classical', title: 'Classical era · c. 600 BCE – c. 600 CE' },
  { from: 601, to: 1450, label: 'Post-classical', title: 'Post-classical era · c. 600 – c. 1450' },
  { from: 1451, to: 1750, label: 'Early modern', title: 'Early modern era · c. 1450 – c. 1750' },
  { from: 1751, to: 1900, label: 'Industrial', title: 'Industrial era · c. 1750 – c. 1900' },
  { from: 1901, label: 'Contemporary', title: 'Contemporary era · c. 1900 – present' },
].map((e) => Object.freeze(e)));
