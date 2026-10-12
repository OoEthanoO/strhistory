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
  kind: 'association' | 'history';
  source?: { label: string; url: string };
}
