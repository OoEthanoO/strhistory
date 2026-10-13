import { geoGraticule10, geoMercator, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import type { GeometryObject, Topology } from 'topojson-specification';
import world from 'world-atlas/land-110m.json';
import { getCourses, getUnits } from '@/lib/content';
import { events } from './events';
import type { GameCatalogue, MapArtwork } from './types';

export async function getGameCatalogue(): Promise<GameCatalogue> {
  const [courses, units] = await Promise.all([getCourses(), getUnits()]);
  // A course's deck is its units that have image rounds. A course with none
  // (such as Grade 10) practises with the whole collection and says so.
  const withRounds = (id: string) => events.some(event => event.unit === id);
  return {
    events,
    courses: courses.map(course => ({ id: course.id, title: course.data.title, units: course.data.units.map(unit => unit.id).filter(withRounds), sample: course.data.placeholder })),
    units: units.filter(unit => withRounds(unit.id)).map(unit => ({ id: unit.id, title: unit.data.title, archive: unit.data.curriculum === 'archive' })),
  };
}

export function getMapArtwork(): MapArtwork {
  const projection = geoMercator().scale(150).translate([480, 250]);
  const path = geoPath(projection);
  return { land: path(feature(world as unknown as Topology, world.objects.land as GeometryObject)) ?? '', grid: path(geoGraticule10()) ?? '' };
}
