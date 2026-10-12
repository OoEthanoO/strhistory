import { useEffect, useState } from 'react';
import { filterEvents } from './logic';
import type { GameCatalogue } from './types';

export function useDeck(catalogue: GameCatalogue) {
  const [course, setCourse] = useState('ib-history-hl');
  const [unit, setUnit] = useState('');
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedCourse = params.get('course');
    const nextCourse = requestedCourse !== null && (requestedCourse === '' || catalogue.courses.some(item => item.id === requestedCourse)) ? requestedCourse : 'ib-history-hl';
    setCourse(nextCourse);
    const requestedUnit = params.get('unit');
    if (requestedUnit && filterEvents(catalogue, nextCourse, requestedUnit).length) setUnit(requestedUnit);
  }, [catalogue]);
  return { course, unit, setCourse, setUnit };
}
