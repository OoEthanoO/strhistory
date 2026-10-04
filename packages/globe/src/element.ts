// Optional <chrono-globe> custom element wrapping ChronoGlobe. Registered only
// when defineChronoGlobeElement() is called (no DOM access at import time).
//
//   <chrono-globe manifest-url="/data/alexs-atlas/manifest.json" year="1453"
//                 center="20,30" scale="1" style="height: 70vh"></chrono-globe>
//
// Attributes: manifest-url (required), year, center ("lon,lat"), scale,
// labels ("false" hides), font-family, selected (pid). Events (CustomEvent,
// bubbling, `detail` = the callback argument): ca-ready, ca-yearapplied,
// ca-hover, ca-select, ca-viewchange, ca-interactionend, ca-loading, ca-failure.
import { ChronoGlobe } from './chrono-globe.js';
import type { ChronoGlobeOptions } from './types.js';

export interface ChronoGlobeElement extends HTMLElement {
  /** The ChronoGlobe while connected (null before connect / after disconnect). */
  readonly globe: ChronoGlobe | null;
  year: number;
}

function parseCenter(v: string | null): [number, number] | undefined {
  if (!v) return undefined;
  const [lon, lat] = v.split(',').map((s) => Number(s.trim()));
  return lon !== undefined && lat !== undefined && Number.isFinite(lon) && Number.isFinite(lat) ? [lon, lat] : undefined;
}

/**
 * Registers `<chrono-globe>` (or `tagName`). `defaults` are merged into every
 * instance's options (e.g. `{ workerUrl, fontFamily, theme }`). Returns the
 * element class; calling it twice returns the already registered class.
 */
export function defineChronoGlobeElement(
  tagName = 'chrono-globe',
  defaults: Partial<Omit<ChronoGlobeOptions, 'data' | 'year'>> = {},
): CustomElementConstructor {
  if (typeof customElements === 'undefined') throw new Error('@alexs-atlas/globe: custom elements need a browser');
  const existing = customElements.get(tagName);
  if (existing) return existing;

  class ChronoGlobeEl extends HTMLElement implements ChronoGlobeElement {
    static observedAttributes = ['year', 'selected', 'labels'];
    private _globe: ChronoGlobe | null = null;

    get globe(): ChronoGlobe | null {
      return this._globe;
    }

    get year(): number {
      return this._globe?.getYear() ?? Number(this.getAttribute('year') ?? 'NaN');
    }

    set year(y: number) {
      this.setAttribute('year', String(y));
    }

    connectedCallback(): void {
      if (this._globe) return;
      this.classList.add('ca-globe-host');
      const manifestUrl = this.getAttribute('manifest-url');
      if (!manifestUrl) {
        console.error(`@alexs-atlas/globe: <${tagName}> needs a manifest-url attribute`);
        return;
      }
      const year = Number(this.getAttribute('year') ?? '1');
      const center = parseCenter(this.getAttribute('center'));
      const scale = Number(this.getAttribute('scale') ?? '1');
      const fire = (type: string, detail: unknown): void => {
        this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true }));
      };
      const options: ChronoGlobeOptions = {
        ...defaults,
        data: { manifestUrl },
        year: Number.isFinite(year) && year !== 0 ? year : 1,
        labels: this.getAttribute('labels') !== 'false',
      };
      if (center) options.view = { center, scale: Number.isFinite(scale) && scale > 0 ? scale : 1 };
      const font = this.getAttribute('font-family');
      if (font) options.fontFamily = font;
      this._globe = new ChronoGlobe(this, options, {
        onYearApplied: (y) => fire('ca-yearapplied', y),
        onHover: (info) => fire('ca-hover', info),
        onSelect: (info) => fire('ca-select', info),
        onViewChange: (v) => fire('ca-viewchange', v),
        onInteractionEnd: (v) => fire('ca-interactionend', v),
        onLoadingChange: (l) => fire('ca-loading', l),
        onFailure: (reason, error) => fire('ca-failure', { reason, error }),
      });
      const selected = this.getAttribute('selected');
      if (selected) this._globe.select(selected);
      this._globe.whenReady().then(
        () => fire('ca-ready', null),
        () => undefined,
      );
    }

    disconnectedCallback(): void {
      this._globe?.destroy();
      this._globe = null;
    }

    attributeChangedCallback(name: string, _old: string | null, value: string | null): void {
      const g = this._globe;
      if (!g) return;
      if (name === 'year' && value !== null && Number.isFinite(Number(value))) g.setYear(Number(value));
      else if (name === 'selected') g.select(value || null);
      else if (name === 'labels') g.setLabels(value !== 'false');
    }
  }

  customElements.define(tagName, ChronoGlobeEl);
  return ChronoGlobeEl;
}
