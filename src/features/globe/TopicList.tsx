import { formatRange, formatYear } from './era';
import type { GlobeTopic } from './types';

interface Props {
  year: number;
  topics: GlobeTopic[];
  visible: Set<string>;
  selected: string | null;
  query: string;
  onQuery(value: string): void;
  level: 'SL' | 'HL';
  onLevel(level: 'SL' | 'HL'): void;
  curriculum: '2028' | 'archive';
  onCurriculum(curriculum: '2028' | 'archive'): void;
  showAll: boolean;
  onShowAll(show: boolean): void;
  expanded: boolean;
  onToggle(): void;
  onSelect(topic: GlobeTopic): void;
  onHover(topic: GlobeTopic | null): void;
}

export default function TopicList({ year, topics, visible, selected, query, onQuery, level, onLevel, curriculum, onCurriculum, showAll, onShowAll, expanded, onToggle, onSelect, onHover }: Props) {
  return (
    <aside className="gx-panel gx-list" data-expanded={expanded || undefined} aria-label="Find history notes">
      <div className="gx-list__head"><div><span className="gx-eyebrow">Your history atlas</span><h2>Explore the notes</h2></div><button className="gx-icon-btn gx-list__toggle" type="button" onClick={onToggle} aria-expanded={expanded} aria-label={expanded ? 'Collapse note list' : 'Expand note list'}>{expanded ? '−' : '+'}</button></div>
      <div className="gx-list__filters">
        <label className="gx-search"><span className="visually-hidden">Search notes, places or topics</span><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="10" cy="10" r="6" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="m15 15 5 5" stroke="currentColor" strokeWidth="1.7" /></svg><input type="search" value={query} onChange={(event) => onQuery(event.target.value)} placeholder="Search notes, places, topics…" /></label>
        <div className="gx-list__filterrow"><div className="gx-level" role="group" aria-label="Course level"><button type="button" aria-pressed={level === 'SL'} onClick={() => onLevel('SL')}>SL</button><button type="button" aria-pressed={level === 'HL'} onClick={() => onLevel('HL')}>HL</button></div><select aria-label="Note collection" value={curriculum} onChange={(event) => onCurriculum(event.target.value as '2028' | 'archive')}><option value="2028">2028 curriculum</option><option value="archive">Archive notes</option></select></div>
        <label className="gx-showall"><input type="checkbox" checked={showAll} onChange={(event) => onShowAll(event.target.checked)} /><span>Show pins from all years</span></label>
        <p className="gx-list__count" aria-live="polite">{visible.size} pins {showAll ? 'across all years' : `in ${formatYear(year)}`} · {topics.length} searchable notes{level === 'HL' ? ' · includes SL' : ''}</p>
      </div>
      <div className="gx-list__scroll">
        {topics.length ? <ul>{topics.map((topic) => <li key={topic.slug} className="gx-list__item" data-selected={selected === topic.slug || undefined}>
          <a className="gx-list__pick" href={topic.href} onMouseEnter={() => onHover(topic)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(topic)} onBlur={() => onHover(null)}><span className="gx-paper" data-paper={topic.paper}>P{topic.paper}</span><span className="gx-list__text"><span className="gx-list__title">{topic.title}</span><span className="gx-list__meta">{formatRange(topic.start, topic.end)} · {topic.place}</span><span className="gx-list__visibility">{visible.has(topic.slug) ? 'On this globe' : 'Outside this year'}{topic.level === 'HL' ? ' · HL' : ''}</span></span></a>
          <button className="gx-list__locate" type="button" onClick={() => onSelect(topic)} aria-label={`Locate ${topic.title} in ${formatYear(topic.start)}`} title="Locate on globe">⌖</button>
        </li>)}</ul> : <p className="gx-list__empty">No notes match these filters. Try a place, event or a different course level.</p>}
      </div>
      <a className="gx-list__all" href={`/topics?level=${level}&curriculum=${curriculum}`}>Open the notes library →</a>
    </aside>
  );
}
