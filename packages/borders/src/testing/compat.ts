// Compile-only checks (type-checked by `npx tsc -p packages/borders/src/tsconfig.json`,
// never executed or built): the package's own GeoJSON types must be assignable to
// @types/geojson and to MapLibre's GeoJSONSource.setData, which consumers use.

import type * as GeoJSON from 'geojson';
import type { GeoJSONSource } from 'maplibre-gl';
import type { BordersClient, FetchLike } from '../index.js';

export async function compat(borders: BordersClient, source: GeoJSONSource): Promise<void> {
  const polygons = await borders.bordersAt(1453);
  const labels = await borders.labelsAt(1453);
  const lines = await borders.linesAt(1453);
  const land = await borders.base('land');

  const a: GeoJSON.FeatureCollection<GeoJSON.Polygon | GeoJSON.MultiPolygon> = polygons;
  const b: GeoJSON.FeatureCollection<GeoJSON.Point> = labels;
  const c: GeoJSON.FeatureCollection<GeoJSON.MultiLineString> = lines;
  const d: GeoJSON.FeatureCollection = land;
  const e: GeoJSON.GeoJSON = polygons;
  void [a, b, c, d, e];

  source.setData(polygons);
  source.setData(labels);
  source.setData(lines);
  source.setData(land);
}

// The global fetch satisfies the client's FetchLike.
export const globalFetchIsFetchLike: FetchLike = fetch;
