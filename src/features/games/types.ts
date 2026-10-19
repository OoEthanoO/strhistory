export interface HistoricalDate { year: number; month: number; day: number }
export interface Coordinates { lat: number; lng: number }
export interface HistoryEvent {
  id: string;
  title: string;
  date: HistoricalDate;
  location: Coordinates & { name: string };
  unit: string;
  curriculum: '2028' | 'archive';
  level: 'SL' | 'HL';
  image: { src: string; alt: string; title: string; creator: string; created: string; licence: string; source: string; concealBottom?: number };
  summary: string;
  source: { label: string; url: string };
  topic?: string;
}
export interface GameCourse { id: string; title: string; units: string[]; sample: boolean }
export interface GameUnit { id: string; title: string; archive: boolean }
export interface GameCatalogue { events: HistoryEvent[]; courses: GameCourse[]; units: GameUnit[] }
export interface MapArtwork { land: string; grid: string }
export interface CraftItem {
  id: string;
  label: string;
  icon: string;
  category: 'foundation' | 'idea' | 'society' | 'person' | 'event' | 'technology';
  description: string;
}
export interface CraftRecipe {
  ingredients: [string, string];
  result: string;
  explanation: string;
  /** `school` recipes are about St. Robert's own history department, not the past. */
  kind: 'association' | 'history' | 'school';
  source?: { label: string; url: string };
}
export type ConnectionsLevel = 1 | 2 | 3 | 4;
export interface ConnectionsGroup {
  /** 1 is the most direct connection, 4 the trickiest. */
  level: ConnectionsLevel;
  /** The connection, shown once the group is found. */
  label: string;
  items: [string, string, string, string];
  explanation: string;
  sources: { label: string; url: string }[];
  /** A study note to read next: a file name in src/content/topics. */
  topic?: string;
}
export interface ConnectionsPuzzle { id: string; groups: [ConnectionsGroup, ConnectionsGroup, ConnectionsGroup, ConnectionsGroup] }
