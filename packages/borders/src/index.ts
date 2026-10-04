// @alexs-atlas/borders — query API for the Alex’s Atlas historical borders dataset.
// Isomorphic ESM (browser, worker, Node); no DOM access, no MapLibre import.
// Contract: root AGENTS.md §5.3; usage: packages/borders/AGENTS.md.

export { createBorders } from './client.js';
export { loadManifest, validateManifest, lodForZoom, attributionHtml } from './manifest.js';
export {
  formatYear,
  parseYear,
  addYears,
  clampYear,
  toAstronomical,
  fromAstronomical,
  isValidYear,
  yearFilter,
} from './years.js';
export { normalizeText } from './search.js';
export { FetchError } from './loader.js';

export type { FormatYearOptions } from './years.js';
export type { AttributionOptions } from './manifest.js';
export type {
  BBox,
  BordersClient,
  BordersInit,
  BordersSource,
  Feature,
  FeatureCollection,
  FetchLike,
  Frame,
  GeoJsonProperties,
  Geometry,
  GeometryCollection,
  HistYear,
  LineKind,
  LineProps,
  LineString,
  LodId,
  LodLike,
  Manifest,
  ManifestChunk,
  ManifestLod,
  ManifestSource,
  MultiLineString,
  MultiPoint,
  MultiPolygon,
  Point,
  PolityInfo,
  PolityKind,
  PolityProps,
  PolitySearchResult,
  Polygon,
  Position,
  QueryOptions,
  SearchOptions,
} from './types.js';
