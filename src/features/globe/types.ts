/** Serializable data the globe island receives from the Astro page. */

export interface GlobeTopic {
  slug: string;
  href: string;
  title: string;
  shortTitle: string;
  summary: string;
  start: number;
  end: number;
  place: string;
  lat: number;
  lng: number;
  unitTitle: string;
  paper: 1 | 2 | 3;
  level: 'SL' | 'HL';
  curriculum: '2028' | 'archive';
  /** Snapshot year the globe switches to when this topic is selected. */
  snapshot: number;
}

export interface GlobeSnapshot {
  year: number;
  /** Actual year of the available border reconstruction; null means land only. */
  borderYear: number | null;
  title: string;
  summary: string;
  highlights: string[];
}

export interface GlobeData {
  topics: GlobeTopic[];
  snapshots: GlobeSnapshot[];
  currentYear: number;
}

/** What the pointer is over on the map (a polity/region). */
export interface PolityHover {
  name: string;
  subjecto: string | null;
  x: number;
  y: number;
}
