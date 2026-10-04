// Public API of the timeline module (re-exported by @alexs-atlas/globe).
// Styles: timeline.css (bundled into @alexs-atlas/globe/style.css).

export { Timeline } from './timeline.js';
export type { TimelineOptions, TimelineSpan } from './timeline.js';
export { createTimeScale, defaultStops, DEFAULT_STOPS, DEFAULT_PRESENT_YEAR } from './scale.js';
export type { TimeScale, TimeStop } from './scale.js';
export { DEFAULT_ERAS } from './eras.js';
export type { TimelineEra } from './eras.js';
export { DEFAULT_TIMELINE_LABELS } from './labels.js';
export type { TimelineLabels } from './labels.js';
