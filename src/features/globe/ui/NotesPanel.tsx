/**
 * The history notes panel (top-left column, between search and the map key): the
 * catalogue of IB History notes with its search, SL/HL level, collection (2028
 * curriculum or archive) and "show pins from all years" filters. Each row links to
 * its study notes and has a button that shows the note's pin on the globe. Its panel
 * opens to the right of its button, in the look of the search panel.
 */
import { useEffect, useRef } from 'react';
import { formatRange, formatYear } from '../era';
import type { GlobeTopic } from '../types';
import { Icon, IconButton } from './Icon';

export interface NotesPanelProps {
  open: boolean;
  onOpenChange(open: boolean, o?: { restoreFocus?: boolean }): void;
  /** Bumped by the parent for the N shortcut: focus the search field. */
  focusToken?: number;
  /** Notes matching the level, collection and search, in date order. */
  topics: GlobeTopic[];
  /** Slugs of the notes with a pin on the globe now. */
  visible: Set<string>;
  year: number;
  level: 'SL' | 'HL';
  onLevel(level: 'SL' | 'HL'): void;
  curriculum: '2028' | 'grade-10' | 'archive';
  onCurriculum(curriculum: '2028' | 'grade-10' | 'archive'): void;
  showAll: boolean;
  onShowAll(showAll: boolean): void;
  query: string;
  onQuery(query: string): void;
  /** Slug of the selected note. */
  selected: string | null;
  onLocate(topic: GlobeTopic): void;
  onHover(topic: GlobeTopic | null): void;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function NotesPanel(p: NotesPanelProps) {
  const root = useRef<HTMLDivElement>(null);
  const panel = useRef<HTMLElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const callbacks = useRef(p);
  callbacks.current = p;
  /** A tap opens the list without raising the on-screen keyboard (as in the search panel). */
  const focusOnOpen = useRef(true);
  const wasOpen = useRef(p.open);
  /** Focus was in the panel when the host closed it (Locate on phones). */
  const focusInside = useRef(false);

  // A press anywhere else closes the panel (as the search panel and the map key do).
  useEffect(() => {
    if (!p.open) return;
    const outside = (e: PointerEvent) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) callbacks.current.onOpenChange(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [p.open]);

  useEffect(() => {
    if (p.open && focusOnOpen.current) input.current?.focus({ preventScroll: true });
    focusOnOpen.current = true;
  }, [p.open, p.focusToken]);

  // Closed by the host while focus was inside: keep focus out of the hidden panel.
  useEffect(() => {
    const closed = wasOpen.current && !p.open;
    wasOpen.current = p.open;
    if (closed && (focusInside.current || panel.current?.contains(document.activeElement))) toggle.current?.focus({ preventScroll: true });
    focusInside.current = false;
  }, [p.open]);

  const pins = p.visible.size;
  const count = `${plural(pins, 'pin', 'pins')} ${p.showAll ? 'from all years' : `in ${formatYear(p.year)}`} · ${plural(p.topics.length, 'note', 'notes')}${p.level === 'HL' ? ' · HL includes SL' : ''}`;
  // Announced when the filters or the search change the notes, not with every year of playback.
  const notesStatus = `${plural(p.topics.length, 'note', 'notes')}${p.level === 'HL' ? ', HL includes SL' : ''}`;

  return (
    <div className="hud__item notes" ref={root}>
      <IconButton
        ref={toggle}
        icon="notes"
        label="History notes"
        title="History notes (N)"
        aria-expanded={p.open}
        aria-controls="gx-notes-panel"
        onClick={(e) => {
          if (!p.open) focusOnOpen.current = (e.nativeEvent as PointerEvent).pointerType !== 'touch';
          p.onOpenChange(!p.open);
        }}
      />
      <section
        ref={panel}
        className="popover notes__panel"
        id="gx-notes-panel"
        aria-labelledby="gx-notes-title"
        hidden={!p.open}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          p.onOpenChange(false);
          toggle.current?.focus({ preventScroll: true });
        }}
      >
        <header className="notes__head">
          <h2 className="notes__title" id="gx-notes-title">History notes</h2>
          <p className="notes__count">{count}</p>
          <p className="sr-only" aria-live="polite">
            {p.open ? notesStatus : ''}
          </p>
        </header>
        <div className="notes__filters">
          <label className="notes__field">
            <Icon name="search" />
            <span className="sr-only">Search notes</span>
            <input
              ref={input}
              className="notes__input"
              type="search"
              placeholder="Search notes, places, topics…"
              value={p.query}
              onChange={(e) => p.onQuery(e.target.value)}
            />
          </label>
          <div className="notes__controls">
            {p.curriculum !== 'grade-10' && (
              <div className="seg" role="group" aria-label="Course level">
                {(['SL', 'HL'] as const).map((value) => (
                  <button key={value} type="button" className="seg__btn" aria-pressed={p.level === value} onClick={() => p.onLevel(value)}>
                    {value}
                  </button>
                ))}
              </div>
            )}
            <label className="notes__select-wrap">
              <span className="sr-only">Collection</span>
              <select className="notes__select" value={p.curriculum} onChange={(e) => p.onCurriculum(e.target.value as '2028' | 'grade-10' | 'archive')}>
                <option value="2028">2028 curriculum</option>
                <option value="grade-10">Grade 10</option>
                <option value="archive">Archive</option>
              </select>
            </label>
          </div>
          <label className="notes__check">
            <input type="checkbox" checked={p.showAll} onChange={(e) => p.onShowAll(e.target.checked)} /> Show pins from all years
          </label>
        </div>
        <div className="notes__scroll">
          {p.topics.length > 0 ? (
            <ul className="notes__list">
              {p.topics.map((topic) => {
                const onGlobe = p.visible.has(topic.slug);
                return (
                  <li
                    key={topic.slug}
                    className="note-row"
                    data-selected={p.selected === topic.slug || undefined}
                    data-outside={!onGlobe || undefined}
                  >
                    <span className="paper-badge" data-paper={topic.paper} title={`Paper ${topic.paper}`}>
                      P{topic.paper}
                    </span>
                    <div className="note-row__text">
                      <a
                        className="note-row__title"
                        href={topic.href}
                        onMouseEnter={() => p.onHover(topic)}
                        onMouseLeave={() => p.onHover(null)}
                        onFocus={() => p.onHover(topic)}
                        onBlur={() => p.onHover(null)}
                      >
                        {topic.title}
                      </a>
                      <span className="note-row__meta">
                        {formatRange(topic.start, topic.end)} · {topic.place}
                      </span>
                      <span className="note-row__status">
                        {onGlobe ? 'On the globe' : `Pin in ${formatRange(topic.start, topic.end)}`}
                        {topic.level === 'HL' ? ' · HL' : ''}
                      </span>
                    </div>
                    <IconButton
                      icon="locate"
                      className="ui-btn--small note-row__locate"
                      label={`Show ${topic.title} on the globe in ${formatYear(topic.start)}`}
                      onClick={() => {
                        // Read by the close effect, which runs before this microtask.
                        focusInside.current = true;
                        p.onLocate(topic);
                        queueMicrotask(() => {
                          focusInside.current = false;
                        });
                      }}
                    />
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="notes__empty">No notes match these filters.</p>
          )}
        </div>
        <footer className="notes__foot">
          <a href={`/topics?level=${p.level}&curriculum=${p.curriculum}`}>
            Open the notes library <Icon name="arrowRight" />
          </a>
        </footer>
      </section>
    </div>
  );
}
