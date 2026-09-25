/**
 * Components available inside topic notes (MDX) without importing them.
 * The topic page passes this map to <Content components={notesComponents} />.
 *
 * To add a component: create it in this folder, add it here, and document it
 * in AGENTS.md → "Writing notes".
 */
import Callout from './Callout.astro';
import Chronology from './Chronology.astro';
import Event from './Event.astro';
import KeyQuote from './KeyQuote.astro';
import Perspective from './Perspective.astro';
import Q from './Q.astro';
import Recall from './Recall.astro';
import Term from './Term.astro';

export const notesComponents = {
  Callout,
  Chronology,
  Event,
  KeyQuote,
  Perspective,
  Q,
  Recall,
  Term,
};
