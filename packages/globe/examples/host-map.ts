// Recipe: bring-your-own-map (packages/globe/AGENTS.md §8.6, strhistory path B).
// The host owns the map and its style; addBorderLayers() inserts the Alex’s Atlas
// sources and layers below one of the host's layers (here 'graticule', in the
// sibling site its 'sea' layer). scripts/recipes.mjs checks the layer order,
// year changes, remove() and re-adding, and reads window.__recipe.
import 'maplibre-gl/dist/maplibre-gl.css';
import '../src/style.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
import { Map as MlMap, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import { createBorders } from '@alexs-atlas/borders';
import type { Feature, FeatureCollection } from 'geojson';
import { addBorderLayers, type BorderLayersHandle } from '../src/index.js';

setWorkerUrl(workerUrl);

/** Meridians and parallels every 30° (a stand-in for the host's own layers). */
function graticule(): FeatureCollection {
  const features: Feature[] = [];
  for (let lon = -180; lon < 180; lon += 30) {
    const coords: [number, number][] = [];
    for (let lat = -80; lat <= 80; lat += 2) coords.push([lon, lat]);
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const coords: [number, number][] = [];
    for (let lon = -180; lon <= 180; lon += 2) coords.push([lon, lat]);
    features.push({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } });
  }
  return { type: 'FeatureCollection', features };
}

const cities: FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    { type: 'Feature', properties: { name: 'Constantinople' }, geometry: { type: 'Point', coordinates: [28.98, 41.01] } },
    { type: 'Feature', properties: { name: 'Venice' }, geometry: { type: 'Point', coordinates: [12.34, 45.44] } },
    { type: 'Feature', properties: { name: 'Cairo' }, geometry: { type: 'Point', coordinates: [31.24, 30.04] } },
  ],
};

// The host's style (no URLs anywhere: no glyphs, so text is drawn locally).
const hostStyle: StyleSpecification = {
  version: 8,
  projection: { type: 'globe' },
  sources: {
    graticule: { type: 'geojson', data: graticule() },
    cities: { type: 'geojson', data: cities },
  },
  layers: [
    { id: 'ocean', type: 'background', paint: { 'background-color': '#10233a' } },
    { id: 'graticule', type: 'line', source: 'graticule', paint: { 'line-color': 'rgba(180, 200, 230, 0.35)', 'line-width': 0.8 } },
    { id: 'cities', type: 'circle', source: 'cities', paint: { 'circle-radius': 4, 'circle-color': '#ffd27a', 'circle-stroke-color': '#10233a', 'circle-stroke-width': 1.5 } },
    {
      id: 'city-labels',
      type: 'symbol',
      source: 'cities',
      layout: { 'text-field': ['get', 'name'], 'text-font': ['system-ui', 'sans-serif'], 'text-size': 13, 'text-offset': [0, 1.1], 'text-anchor': 'top' },
      paint: { 'text-color': '#ffe7b0', 'text-halo-color': '#10233a', 'text-halo-width': 1.5 },
    },
  ],
};

const map = new MlMap({ container: 'map', style: hostStyle, center: [22, 38], zoom: 2.6, renderWorldCopies: false });
const result: Record<string, unknown> = {};
(window as unknown as { __map: MlMap }).__map = map;

const ids = (): string[] => map.getStyle().layers.map((l) => l.id);

map.on('load', async () => {
  try {
    const borders = createBorders({ manifestUrl: '/data/alexs-atlas/manifest.json' });
    const add = (year: number): BorderLayersHandle =>
      addBorderLayers(map, { borders, year, beforeId: 'graticule', prefix: 'chrono-' });

    let handle = add(1453);
    await handle.setYear(1453);
    result.layerIds = handle.layerIds;
    result.sourceIds = handle.sourceIds;
    result.orderAfterAdd = ids();

    // A year change resolves once the new borders rendered.
    const t0 = performance.now();
    await handle.setYear(1914);
    result.yearChangeMs = Math.round(performance.now() - t0);
    result.featuresIn1914 = map.querySourceFeatures('chrono-frame').length > 0;

    // remove() leaves exactly the host's style behind; adding again works.
    handle.remove();
    result.orderAfterRemove = ids();
    result.sourcesAfterRemove = Object.keys(map.getStyle().sources);
    handle = add(1914);
    await handle.setYear(1914);
    result.orderAfterReAdd = ids();
    (window as unknown as { __handle: BorderLayersHandle }).__handle = handle;
    result.ok = true;
  } catch (err) {
    result.ok = false;
    result.error = String(err);
  }
  (window as unknown as { __recipe: unknown }).__recipe = result;
});
