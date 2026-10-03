/**
 * Search (top left of the globe): an icon button that opens a panel to its right with
 * a search field over a list. With the field empty the list shows the polities on the
 * map in the year shown (A–Z, each with its map colour); typing searches every polity
 * in the dataset (the host ranks the ones on the map in the year shown first) and the
 * history notes, which come first under their own group label.
 *
 * The field is an editable combobox with a listbox (WAI-ARIA APG "list autocomplete
 * with manual selection"): ↓/↑ move the active option (aria-activedescendant; focus
 * stays in the field), Home/End go to the first/last option while an option is active
 * (otherwise they move the caret), Enter chooses the active option (or the first
 * result), Esc closes the panel and returns focus to the button, Tab leaves it.
 * Choosing keeps the panel open so the list can be browsed (the host closes it on
 * phones); a press outside the panel closes it.
 *
 * Ported from the Alex's Atlas reference site, apps/site/src/ui/search.ts (an
 * imperative DOM class there, a React function component here; same markup and class
 * names). The one extension is the "History notes" group of search results.
 */
import { forwardRef, useEffect, useId, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { CSSProperties, FocusEvent, KeyboardEvent, MouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import type { PolitySearchResult } from '@alexs-atlas/borders';
import { formatRange } from '../era';
import type { GlobeTopic } from '../types';
import { aliveIn, countPolities, displayYear, formatSpan, formatSpans, kindLabel, lifespan } from './format';
import { Icon, IconButton } from './Icon';
import type { ListRow } from './polities';

export interface SearchPanelProps {
  open: boolean;
  onOpenChange(open: boolean, o?: { restoreFocus?: boolean }): void;
  /** Bumped by the parent for the '/' and 'L' shortcuts: focus the field; mode 'list' also clears the query (the year's list). */
  request?: { token: number; mode: 'search' | 'list' };
  search(q: string): Promise<PolitySearchResult[]>;
  /** Polities on the map in the applied year, A–Z. Pass a stable array (it resets the active option when it changes). */
  rows: ListRow[];
  /** The applied year (whose borders are shown). */
  year: number;
  /** Dataset present year (spans reaching it read "present"). */
  present: number;
  /** A polity's lifespan once the polity index has loaded, else null. */
  lifespan(pid: string): { from: number; to: number } | null;
  /** Map colour of a polity in the list (as the globe draws it). */
  color(p: { power: string; pid: string; c: number }): string;
  /** The selected polity, if any. */
  selected: string | null;
  onChoose(pid: string, source: 'list' | 'search'): void;
  /** History notes matching the query (already filtered by the explorer's level/curriculum), most relevant first. */
  notes(q: string): GlobeTopic[];
  onChooseNote(topic: GlobeTopic): void;
}

export interface SearchPanelHandle {
  readonly element: HTMLElement | null;
  /** The panel (while open, its right edge bounds the free map area). */
  readonly panelElement: HTMLElement | null;
}

type Item = { kind: 'note'; topic: GlobeTopic } | { kind: 'polity'; pid: string; source: 'list' | 'search' };

/** The query whose results are shown ('' = the list of the year) and its polity results. */
interface Shown {
  query: string;
  results: PolitySearchResult[];
}

const DEBOUNCE_MS = 90;
/** History notes shown above the polity results. */
const MAX_NOTES = 5;
const EMPTY: Shown = { query: '', results: [] };
const NO_NOTES: GlobeTopic[] = [];

const LABEL = 'Search places, powers and notes';

/** Focuses `el` without scrolling the page. */
const focusQuietly = (el: HTMLElement | null | undefined): void => el?.focus({ preventScroll: true });

const matchesText = (n: number): string => (n === 1 ? '1 match' : `${n} matches`);

function listStatus(n: number, year: number): string {
  return `${countPolities(n)} on the map in ${displayYear(year)}. Type to search all polities and history notes.`;
}

function queryStatus(q: string, n: number, notes: number): string {
  if (n === 0) return `No polity or history note matches ${q}`;
  if (notes === 0) return matchesText(n);
  return `${matchesText(n)}, ${notes === 1 ? '1 history note' : `${notes} history notes`} first`;
}

const optionIndex = (target: EventTarget): number | null => {
  const li = target instanceof Element ? target.closest<HTMLElement>('[role="option"]') : null;
  return li ? Number(li.dataset.index) : null;
};

export const SearchPanel = forwardRef<SearchPanelHandle, SearchPanelProps>(function SearchPanel(props, ref) {
  const { open, rows, year, present, selected } = props;
  // Latest props for event listeners, timers and async callbacks.
  const latest = useRef(props);
  latest.current = props;

  const uid = useId();
  const panelId = `${uid}-search-panel`;
  const listId = `${uid}-search-list`;
  const inputId = `${uid}-search-input`;
  const headId = `${uid}-search-head`;
  const notesLabelId = `${uid}-search-notes`;
  const placesLabelId = `${uid}-search-places`;

  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const [value, setValue] = useState('');
  const [shown, setShown] = useState<Shown>(EMPTY);
  const [status, setStatus] = useState('');
  const [act, setAct] = useState<{ key: object; index: number } | null>(null);

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const seq = useRef(0);
  /** Enter was pressed before this query's results arrived: choose the first one then. */
  const chooseFirst = useRef<string | null>(null);
  /** Whether the next open puts the caret in the field (a touch tap on the button does not). */
  const focusOnOpen = useRef(true);
  /** The panel asked to close after a press outside or Tab: leave focus where it goes. */
  const quietClose = useRef(false);
  const wasOpen = useRef(false);
  const lastToken = useRef(props.request?.token);

  useImperativeHandle(
    ref,
    () => ({
      get element() {
        return rootRef.current;
      },
      get panelElement() {
        return panelRef.current;
      },
    }),
    [],
  );

  // History notes for the shown query (only while open: the list is not rendered when
  // closed). `notes` may be a new function on every render, so the hits keep their
  // identity while the same notes match.
  const freshNotes = open && shown.query ? props.notes(shown.query).slice(0, MAX_NOTES) : NO_NOTES;
  const noteKey = freshNotes.map((t) => t.slug).join('\n');
  const noteHits = useMemo(() => freshNotes, [noteKey]);

  /** Options in display order: notes first, then polities. */
  const items = useMemo<Item[]>(() => {
    if (!open) return [];
    if (shown.query) {
      return [
        ...noteHits.map((topic): Item => ({ kind: 'note', topic })),
        ...shown.results.map((r): Item => ({ kind: 'polity', pid: r.pid, source: 'search' })),
      ];
    }
    return rows.map((r): Item => ({ kind: 'polity', pid: r.pid, source: 'list' }));
  }, [open, shown, noteHits, rows]);

  // The active option resets whenever the list is rendered afresh (opening, new
  // results, another year or its polities), as chronoatlas's render() does.
  const listKey = useMemo(() => ({}), [open, shown, noteHits, rows, year]);
  const active = act && act.key === listKey && act.index < items.length ? act.index : -1;

  const setActive = (i: number, scroll = true): void => {
    const index = i >= 0 && i < items.length ? i : -1;
    if (index !== active) setAct({ key: listKey, index });
    if (!scroll || index < 0) return;
    const li = listRef.current?.querySelector(`[data-index="${index}"]`);
    // The first option of a group brings its group label into view too.
    if (li && !li.previousElementSibling) li.closest('.search__group')?.firstElementChild?.scrollIntoView({ block: 'nearest' });
    li?.scrollIntoView({ block: 'nearest' });
  };

  const choose = (i: number): void => {
    const item = items[i];
    if (!item) return;
    setActive(i, false);
    if (item.kind === 'note') latest.current.onChooseNote(item.topic);
    else latest.current.onChoose(item.pid, item.source);
  };

  const close = (restoreFocus: boolean): void => {
    if (!latest.current.open) return;
    clearTimeout(timer.current);
    if (restoreFocus) focusQuietly(toggleRef.current);
    else quietClose.current = true;
    latest.current.onOpenChange(false, restoreFocus ? { restoreFocus: true } : undefined);
  };

  const run = async (q: string): Promise<void> => {
    const mine = ++seq.current;
    let results: PolitySearchResult[];
    try {
      results = await latest.current.search(q);
    } catch {
      results = [];
    }
    if (mine !== seq.current) return; // a newer query is on its way
    const notes = Math.min(MAX_NOTES, latest.current.notes(q).length);
    setShown({ query: q, results });
    setStatus(queryStatus(q, results.length + notes, notes));
  };

  const onInput = (raw: string): void => {
    setValue(raw);
    chooseFirst.current = null;
    const q = raw.trim();
    clearTimeout(timer.current);
    if (!q) {
      seq.current++; // drop a search still on its way
      if (shown.query !== '') {
        setShown(EMPTY);
        setStatus(listStatus(rows.length, year));
      }
      return;
    }
    timer.current = setTimeout(() => void run(q), DEBOUNCE_MS);
  };

  // Opening: announce the list, reveal the selected polity, put the caret in the field.
  // Closing: drop a pending search; keep focus out of the hidden panel.
  useEffect(() => {
    if (open === wasOpen.current) return;
    wasOpen.current = open;
    if (open) {
      quietClose.current = false;
      setStatus(
        shown.query ? queryStatus(shown.query, shown.results.length + noteHits.length, noteHits.length) : listStatus(rows.length, year),
      );
      listRef.current?.querySelector<HTMLElement>('[data-current]')?.scrollIntoView({ block: 'nearest' });
      if (focusOnOpen.current) {
        focusQuietly(inputRef.current);
        inputRef.current?.select();
      }
      focusOnOpen.current = true;
    } else {
      clearTimeout(timer.current);
      const quiet = quietClose.current;
      quietClose.current = false;
      // Closed by the host while focus was inside (it would be lost to the page).
      if (!quiet && panelRef.current?.contains(document.activeElement)) focusQuietly(toggleRef.current);
    }
  }, [open]);

  // The '/' and 'L' shortcuts (the host toggles `open`; 'L' on an open panel closes it there).
  useEffect(() => {
    const r = props.request;
    if (!r || r.token === lastToken.current) return;
    lastToken.current = r.token;
    if (r.mode === 'list' && value !== '') onInput('');
    if (latest.current.open) {
      focusQuietly(inputRef.current);
      inputRef.current?.select();
    } else {
      focusOnOpen.current = true;
      latest.current.onOpenChange(true);
    }
  }, [props.request?.token, props.request?.mode]);

  // Enter right after typing: choose the first result once it has rendered.
  useEffect(() => {
    const q = chooseFirst.current;
    if (q === null || shown.query !== q) return;
    chooseFirst.current = null;
    if (items.length) choose(0);
  }, [shown, items]);

  // A press outside closes the panel (capture phase, only while open).
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent): void => {
      const root = rootRef.current;
      if (!(root && e.target instanceof Node && root.contains(e.target))) close(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  useEffect(
    () => () => {
      clearTimeout(timer.current);
      seq.current++;
    },
    [],
  );

  // ------------------------------------------------------------------ handlers

  const onToggleClick = (e: MouseEvent<HTMLButtonElement>): void => {
    if (open) close(true);
    else {
      // A tap opens the list without raising the on-screen keyboard; a click or a key
      // puts the caret in the field.
      focusOnOpen.current = (e.nativeEvent as PointerEvent).pointerType !== 'touch';
      props.onOpenChange(true);
    }
  };

  // Focus moving to another control (Tab) closes the panel.
  const onFocusOut = (e: FocusEvent<HTMLDivElement>): void => {
    const to = e.relatedTarget;
    if (latest.current.open && to instanceof Node && !e.currentTarget.contains(to)) close(false);
  };

  const onPanelKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if ((e.key === 'Escape' || e.key === 'Esc') && latest.current.open) {
      e.preventDefault();
      e.stopPropagation();
      close(true);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>): void => {
    const n = items.length;
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (n) setActive(active < n - 1 ? active + 1 : 0);
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (n) setActive(active > 0 ? active - 1 : n - 1);
        break;
      case 'Home':
      case 'End':
        // Only while browsing the list; otherwise they move the caret in the field.
        if (active < 0 || !n) break;
        e.preventDefault();
        setActive(e.key === 'Home' ? 0 : n - 1);
        break;
      case 'Enter': {
        if (e.nativeEvent.isComposing) break;
        const q = e.currentTarget.value.trim();
        e.preventDefault();
        if (q && q !== shown.query) {
          // Search right away if the debounce has not fired yet, then take the first hit.
          clearTimeout(timer.current);
          chooseFirst.current = q;
          void run(q);
        } else if (active >= 0) choose(active);
        else if (q && n) choose(0);
        break;
      }
      default:
        break;
    }
  };

  const onClear = (): void => {
    onInput('');
    focusQuietly(inputRef.current);
  };

  // Keep focus where it is while pressing an option (APG: focus stays in the combobox).
  const onListPointerDown = (e: ReactPointerEvent<HTMLUListElement>): void => e.preventDefault();
  const onListClick = (e: MouseEvent<HTMLUListElement>): void => {
    const i = optionIndex(e.target);
    if (i !== null) choose(i);
  };
  const onListPointerMove = (e: ReactPointerEvent<HTMLUListElement>): void => {
    const i = optionIndex(e.target);
    if (i !== null) setActive(i, false);
  };

  // ------------------------------------------------------------------- render

  const polityOption = (
    i: number,
    pid: string,
    o: { name: string; alt: string | null; meta: string; badge: string | null; color: string | null; hatch: boolean },
  ): ReactNode => {
    const sw = ['search__swatch', o.color ? '' : 'search__swatch--none', o.hatch ? 'search__swatch--hatch' : ''].filter(Boolean).join(' ');
    return (
      <li
        key={`p:${pid}`}
        id={`${listId}-${i}`}
        className="search__option"
        role="option"
        aria-selected={i === active}
        data-index={i}
        data-pid={pid}
        data-current={pid === selected ? 'true' : undefined}
      >
        <span className={sw} style={o.color ? ({ '--sw': o.color } as CSSProperties) : undefined} aria-hidden="true" />
        <span className="search__text">
          <span className="search__name">{o.name}</span>
          {o.alt ? <span className="search__alt">{o.alt}</span> : null}
          <span className="search__meta">
            {o.meta}
            {o.badge ? <span className="search__badge">{o.badge}</span> : null}
          </span>
        </span>
      </li>
    );
  };

  const noteOption = (i: number, t: GlobeTopic): ReactNode => (
    <li
      key={`n:${t.slug}`}
      id={`${listId}-${i}`}
      className="search__option search__option--note"
      role="option"
      aria-selected={i === active}
      data-index={i}
      data-slug={t.slug}
    >
      <Icon name="notes" className="icon icon--sm search__note-icon" />
      <span className="search__text">
        <span className="search__name">{t.title}</span>
        <span className="search__meta">{`Note · ${formatRange(t.start, t.end)} · ${t.place}`}</span>
      </span>
    </li>
  );

  let options: ReactNode = null;
  let head = '';
  let emptyText = '';
  if (open && shown.query) {
    const q = shown.query;
    const onMap = new Map(rows.map((r) => [r.pid, r]));
    const offset = noteHits.length;
    const polities = shown.results.map((r, j) => {
      const span = lifespan(r);
      const years = span ? (r.spans.length > 2 ? formatSpan(span.from, span.to, present) : formatSpans(r.spans, present)) : '';
      const row = onMap.get(r.pid);
      return polityOption(offset + j, r.pid, {
        name: r.name,
        alt: r.matched && r.matched !== r.name ? `also “${r.matched}”` : null,
        meta: [kindLabel(r.kind), years].filter(Boolean).join(' · '),
        badge: aliveIn(r.spans, year) ? `on the map in ${displayYear(year)}` : null,
        color: row ? props.color(row) : null,
        hatch: row?.tier === 1,
      });
    });
    if (noteHits.length) {
      // Two labelled groups in the listbox (APG grouped listbox): notes, then polities.
      options = [
        <li key="g:notes" className="search__group" role="group" aria-labelledby={notesLabelId}>
          <div className="search__head search__group-label" id={notesLabelId} role="presentation">
            History notes
          </div>
          <ul className="search__list search__group-list" role="none">
            {noteHits.map((t, j) => noteOption(j, t))}
          </ul>
        </li>,
        polities.length ? (
          <li key="g:places" className="search__group" role="group" aria-labelledby={placesLabelId}>
            <div className="search__head search__group-label" id={placesLabelId} role="presentation">
              Places and powers
            </div>
            <ul className="search__list search__group-list" role="none">
              {polities}
            </ul>
          </li>
        ) : null,
      ];
    } else options = polities;
    const n = items.length;
    head = n === 0 ? 'No matches' : matchesText(n);
    if (n === 0) emptyText = `No polity or history note matches “${q}”.`;
    else if (shown.results.length === 0) emptyText = `No polity matches “${q}”.`;
  } else if (open) {
    options = rows.map((r, i) => {
      const life = props.lifespan(r.pid) ?? { from: r.from, to: r.to };
      return polityOption(i, r.pid, {
        name: r.name,
        alt: null,
        meta: [kindLabel(r.kind), formatSpan(life.from, life.to, present), r.relation].filter(Boolean).join(' · '),
        badge: null,
        color: props.color(r),
        hatch: r.tier === 1,
      });
    });
    head = `${countPolities(rows.length)} on the map in ${displayYear(year)}`;
    if (rows.length === 0) emptyText = `No polities on the map in ${displayYear(year)}.`;
  }

  return (
    <div className="hud__item search" ref={rootRef} onBlur={onFocusOut}>
      <IconButton
        ref={toggleRef}
        icon="search"
        label={LABEL}
        title={`${LABEL} (/)`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggleClick}
      />
      <div ref={panelRef} className="popover search__panel" id={panelId} role="search" hidden={!open} onKeyDown={onPanelKeyDown}>
        <div className="search__field">
          <label className="sr-only" htmlFor={inputId}>
            Search places, powers and history notes
          </label>
          <Icon name="search" className="icon search__icon" />
          <input
            ref={inputRef}
            id={inputId}
            className="search__input"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open && items.length > 0}
            aria-controls={listId}
            aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            enterKeyHint="search"
            placeholder={LABEL}
            value={value}
            onChange={(e) => onInput(e.currentTarget.value)}
            onKeyDown={onKeyDown}
          />
          <button type="button" className="search__clear" aria-label="Clear search" title="Clear" hidden={value === ''} onClick={onClear}>
            <Icon name="close" />
          </button>
        </div>
        <p className="search__head" id={headId}>
          {head}
        </p>
        {/* tabIndex -1: Chrome makes a scrolling box keyboard-focusable on its own, which put
            a nameless Tab stop between the field and the next control (the arrows drive the list). */}
        <div className="search__scroll" tabIndex={-1}>
          <ul
            ref={listRef}
            id={listId}
            className="search__list"
            role="listbox"
            aria-labelledby={headId}
            onPointerDown={onListPointerDown}
            onClick={onListClick}
            onPointerMove={onListPointerMove}
          >
            {options}
          </ul>
          <p className="search__empty" hidden={!emptyText}>
            {emptyText}
          </p>
        </div>
      </div>
      <div className="sr-only" role="status" aria-live="polite">
        {status}
      </div>
    </div>
  );
});
