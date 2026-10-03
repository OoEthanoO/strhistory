// Recipe: the <chrono-globe> custom element (packages/globe/AGENTS.md §8.5).
// scripts/recipes.mjs reads window.__recipe.
import '@fontsource-variable/inter';
import 'maplibre-gl/dist/maplibre-gl.css';
import '../src/style.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { defineChronoGlobeElement, type ChronoGlobeElement } from '../src/index.js';

defineChronoGlobeElement('chrono-globe', { workerUrl, fontFamily: 'Inter Variable' });

const el = document.querySelector('chrono-globe') as ChronoGlobeElement;
const events: string[] = [];
const result: Record<string, unknown> = { events };
for (const type of ['ca-ready', 'ca-yearapplied', 'ca-select', 'ca-failure']) {
  el.addEventListener(type, (e) => events.push(`${type}:${JSON.stringify((e as CustomEvent).detail?.pid ?? (e as CustomEvent).detail)}`));
}

el.addEventListener(
  'ca-ready',
  async () => {
    // Attribute → setYear; the element reports the applied year as an event.
    const applied = new Promise<number>((resolve) =>
      el.addEventListener('ca-yearapplied', (e) => {
        if ((e as CustomEvent<number>).detail === 1500) resolve(1500);
      }),
    );
    el.year = 1500;
    result.yearAfterSet = await applied;
    el.setAttribute('selected', 'clio:ottoman-empire');
    result.selected = el.globe?.getSelected();
    result.ok = result.yearAfterSet === 1500 && result.selected === 'clio:ottoman-empire' && el.dataset.caState === 'ready';
    (window as unknown as { __recipe: unknown }).__recipe = result;
  },
  { once: true },
);
el.addEventListener('ca-failure', () => {
  result.ok = false;
  (window as unknown as { __recipe: unknown }).__recipe = result;
});
