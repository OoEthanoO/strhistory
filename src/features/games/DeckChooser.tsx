import { filterEvents } from './logic';
import type { GameCatalogue } from './types';

interface Props { catalogue: GameCatalogue; course: string; unit: string; onCourse: (course: string) => void; onUnit: (unit: string) => void }
export default function DeckChooser({ catalogue, course, unit, onCourse, onUnit }: Props) {
  const courseEvents = filterEvents(catalogue, course, '');
  const courseInfo = catalogue.courses.find(item => item.id === course);
  return <div className="game-deck">
    <label>Course<select value={course} onChange={event => { onCourse(event.target.value); onUnit(''); }}>
      <option value="">All history</option>
      {catalogue.courses.map(item => <option key={item.id} value={item.id}>{item.title}{item.sample ? ' · sample course' : ''}</option>)}
    </select></label>
    <label>Unit<select value={unit} onChange={event => onUnit(event.target.value)}>
      <option value="">All available units</option>
      {catalogue.units.filter(item => courseEvents.some(event => event.unit === item.id)).map(item => <option key={item.id} value={item.id}>{item.title}{item.archive ? ' · archive' : ''}</option>)}
    </select></label>
    <p className="game-help">{filterEvents(catalogue, course, unit).length} image rounds available. {courseInfo?.units.length === 0 ? 'This course has no prescribed event deck; these are broad source-practice rounds.' : 'A growing practice collection, not complete syllabus coverage.'}</p>
  </div>;
}
