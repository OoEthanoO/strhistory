// Public types of @alexs-atlas/borders (root AGENTS.md §5.2–§5.3).
//
// GeoJSON types are declared here instead of importing @types/geojson so the
// package has no type dependencies. They mirror @types/geojson (RFC 7946) and are
// structurally compatible with it, so results can be passed straight to
// MapLibre's `GeoJSONSource.setData` or any other GeoJSON consumer.

/** Historical year: a non-zero integer. −1 is 1 BCE, 1 is 1 CE (there is no year 0). */
export type HistYear = number;

/** Level-of-detail id used in the manifest. */
export type LodId = 'l0' | 'l1' | 'l2';

/** An LOD id; known ids autocomplete, other strings are accepted for forward compatibility. */
export type LodLike = LodId | (string & {});

// ----------------------------------------------------------------------- GeoJSON

export type Position = number[];
export type BBox = [number, number, number, number] | [number, number, number, number, number, number];

export interface Point { type: 'Point'; coordinates: Position; bbox?: BBox }
export interface MultiPoint { type: 'MultiPoint'; coordinates: Position[]; bbox?: BBox }
export interface LineString { type: 'LineString'; coordinates: Position[]; bbox?: BBox }
export interface MultiLineString { type: 'MultiLineString'; coordinates: Position[][]; bbox?: BBox }
export interface Polygon { type: 'Polygon'; coordinates: Position[][]; bbox?: BBox }
export interface MultiPolygon { type: 'MultiPolygon'; coordinates: Position[][][]; bbox?: BBox }
export interface GeometryCollection { type: 'GeometryCollection'; geometries: Geometry[]; bbox?: BBox }
export type Geometry = Point | MultiPoint | LineString | MultiLineString | Polygon | MultiPolygon | GeometryCollection;

/** Free-form GeoJSON properties (same shape as @types/geojson's GeoJsonProperties). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type GeoJsonProperties = { [name: string]: any } | null;

export interface Feature<G extends Geometry | null = Geometry, P = GeoJsonProperties> {
  type: 'Feature';
  geometry: G;
  properties: P;
  id?: string | number;
  bbox?: BBox;
}

export interface FeatureCollection<G extends Geometry | null = Geometry, P = GeoJsonProperties> {
  type: 'FeatureCollection';
  features: Feature<G, P>[];
  bbox?: BBox;
}

// ---------------------------------------------------------------------- dataset

export type PolityKind = 'state' | 'dependency' | 'indigenous' | 'disputed' | 'other' | 'unclaimed';

export interface ManifestLod {
  id: LodId;
  /** Simplification tolerance in metres. */
  toleranceM: number;
  /** Use this LOD from this map zoom on (pick the last entry with minZoom <= zoom). */
  minZoom: number;
}

export interface ManifestChunk {
  id: string;
  /** Inclusive year range covered by this chunk. */
  from: HistYear;
  to: HistYear;
  /** LOD id → path of the chunk's TopoJSON file, relative to the manifest. */
  files: Record<string, string>;
  /** LOD id → file size in bytes (the pipeline reports the gzip transfer size). */
  bytes: Record<string, number>;
  /** Number of records (geometries) in the chunk. */
  records: number;
}

export interface ManifestSource {
  id: string;
  name: string;
  version: string;
  url: string;
  license: string;
  spdx: string;
  attribution: string;
  changes?: string;
}

/** `manifest.json`, the dataset's entry point (AGENTS.md §5.2). */
export interface Manifest {
  schema: 'alexs-atlas.borders/1';
  dataset: string;
  version: string;
  /** ISO time of the build. */
  built: string;
  years: { convention: 'historical-no-zero'; from: HistYear; to: HistYear; present: HistYear; cutover: HistYear };
  lods: ManifestLod[];
  chunks: ManifestChunk[];
  /** Sorted change years: borders are identical from frames[i] to frames[i+1]-1. */
  frames: HistYear[];
  base: { land: Record<string, string>; lakes?: Record<string, string> };
  /** Path of the polity index, relative to the manifest. */
  polities: string;
  palette: { size: number };
  sources: ManifestSource[];
  attribution: { text: string; html: string };
  stats?: Record<string, unknown>;
}

/** Properties of every polygon in a chunk (and of every feature `bordersAt` returns). */
export interface PolityProps {
  /** Positive integer, unique in the dataset; also `Feature.id` (for MapLibre feature-state). */
  id: number;
  /** Record id: `${pid}@${from}`. */
  rid: string;
  /** Stable polity id (`clio:…`, `ne:…`, `ovr:…`; `none` for unclaimed land). */
  pid: string;
  /** Display name for this period ('' for unclaimed land). */
  name: string;
  /** Inclusive validity of this geometry. */
  from: HistYear;
  to: HistYear;
  kind: PolityKind;
  /** 0 = base layer (exclusive areas), 1 = hatched overlay. */
  tier: 0 | 1;
  /** Colour key: pid of the controlling polity (colonies share their empire's). */
  power: string;
  partof: string | null;
  subjecto: string | null;
  disputed: boolean;
  precision: 'exact' | 'approximate';
  /** Colour slot 0 … palette.size − 1. */
  c: number;
  /** Area in km². */
  a: number;
  /** Label point (pole of inaccessibility of the largest part). */
  lx: number;
  ly: number;
  /** Source id from manifest.sources. */
  src: string;
}

/** One entry of the polity index (`polities.<hash>.json`). */
export interface PolityInfo {
  name: string;
  altNames?: string[];
  kind: PolityKind;
  /** Inclusive [from, to] ranges in which the polity is on the map. */
  spans: [HistYear, HistYear][];
  wikidata?: string;
  wikipedia?: string;
  power?: string;
  /** [west, south, east, north] in degrees (west > east when it crosses the antimeridian). */
  bbox: [number, number, number, number];
  /** Year of the polity's largest extent (first year of its largest record): a good year to show it. */
  peak?: HistYear;
  src: string;
  note?: string;
}

/** A search hit: the index entry plus its pid. */
export type PolitySearchResult = PolityInfo & {
  pid: string;
  /** The alternative name that matched, when the hit came from `altNames` rather than `name`. */
  matched?: string;
};

// ------------------------------------------------------------------------ client

/** Years that share identical borders. Unbounded (±Infinity) outside the dataset's coverage. */
export interface Frame {
  from: number;
  to: number;
}

export type LineKind = 'border' | 'coast';
export interface LineProps {
  kind: LineKind;
}

/** Minimal `fetch` the client needs; the global `fetch` satisfies it. */
export type FetchLike = (
  url: string,
  init?: { signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; statusText?: string; json(): Promise<unknown> }>;

export interface QueryOptions {
  /** LOD id (default: the manifest's first LOD). */
  lod?: LodLike;
  signal?: AbortSignal;
}

export interface SearchOptions {
  /** Maximum number of results (default 10). */
  limit?: number;
  /** Only polities on the map in this year. */
  year?: HistYear;
}

export type BordersSource = { manifestUrl: string } | { manifest: Manifest; baseUrl: string };

export interface BordersInit {
  /** fetch implementation (default: globalThis.fetch). */
  fetch?: FetchLike;
  /** Decoded chunk topologies kept per LOD (default 4). */
  cacheChunks?: number;
  /** Decoded per-year results (borders, labels, lines) kept per kind (default 8 frames). */
  cacheFrames?: number;
}

export interface BordersClient {
  /** Loads (once) and returns the manifest. */
  ready(): Promise<Manifest>;
  /** The frame containing `year`. Throws until the manifest is loaded, and for invalid years. */
  frameOf(year: HistYear): Frame;
  /** Polities alive in `year` (tier 0 and tier 1). Results are shared per frame — treat them as read-only. */
  bordersAt(year: HistYear, o?: QueryOptions): Promise<FeatureCollection<Polygon | MultiPolygon, PolityProps>>;
  /** One label point per polity alive in `year` (unclaimed land skipped). */
  labelsAt(year: HistYear, o?: QueryOptions): Promise<FeatureCollection<Point, PolityProps>>;
  /** Mesh of the tier-0 features alive in `year`: borders between different features, and the coast. */
  linesAt(year: HistYear, o?: QueryOptions): Promise<FeatureCollection<MultiLineString, LineProps>>;
  /** Natural Earth base layer ('lakes' resolves to an empty collection when the dataset has none). */
  base(name: 'land' | 'lakes', lod?: LodLike): Promise<FeatureCollection>;
  polities(): Promise<Record<string, PolityInfo>>;
  polity(pid: string): Promise<PolityInfo | undefined>;
  /** Diacritic-insensitive search over names and alternative names. */
  search(q: string, o?: SearchOptions): Promise<PolitySearchResult[]>;
  /** Starts loading the chunk for `year` in the background (errors are ignored). */
  prefetch(year: HistYear, lod?: LodLike): void;
}
