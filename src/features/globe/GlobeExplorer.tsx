/**
 * The /globe explorer (a React island): the Alex's Atlas globe with its minimal UI —
 * the year at the top centre with the context of its era; search, the history notes
 * and the map key in a column at the top left (their panels open to the right of their
 * buttons); About at the top right; zoom in, zoom out and reset view at the bottom
 * left; the timeline bar along the bottom. IB History notes are pins on the globe
 * (map.ts) with a preview card. Composition adapted from the Alex's Atlas reference
 * site (apps/site/src/app.ts).
 *
 * The SVG globe (PrebakedGlobe) is interactive from the first paint; the WebGL globe
 * takes over once its first borders have rendered, and the SVG stays if WebGL fails.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { createBorders, normalizeText, type BordersClient, type Manifest, type PolityInfo, type PolitySearchResult } from '@alexs-atlas/borders';
import type { SelectInfo } from '@alexs-atlas/globe';
import { defaultStops } from '@alexs-atlas/globe/timeline';
// Styles in the order the globe package requires (packages/AGENTS.md §5.4): MapLibre's
// first (only its CSS here; its code loads lazily with map.ts), then the globe and
// timeline styles, then the explorer's own.
import 'maplibre-gl/dist/maplibre-gl.css';
import '@alexs-atlas/globe/style.css';
import './atlas.css';
import { clampYear, DEFAULT_YEAR, FIRST_YEAR, formatRange, formatYear, indexOfYear, topicInYear } from './era';
import type { GlobeController } from './map';
import { fillColor } from './map-colors';
import PrebakedGlobe, { BAKED_FRAME, type GlobeView } from './PrebakedGlobe';
import type { GlobeData, GlobeTopic } from './types';
import { HistoryWriter, parseGlobeUrl, type GlobeUrlState } from './url';
import { AboutContent } from './ui/AboutContent';
import { Announcer, type AnnouncerHandle } from './ui/Announcer';
import { Dialog, type DialogHandle } from './ui/Dialog';
import { EraCaption } from './ui/EraCaption';
import { aliveIn, countPolities, formatSpan, lifespan, nearestYearIn, spokenYear } from './ui/format';
import { IconButton } from './ui/Icon';
import { Legend } from './ui/Legend';
import { MapControls } from './ui/MapControls';
import { NotesPanel } from './ui/NotesPanel';
import { rowsFromFeatures, sortRows, type ListRow } from './ui/polities';
import { SearchPanel, type SearchPanelHandle } from './ui/SearchPanel';
import { ShortcutsContent } from './ui/ShortcutsContent';
import { TimelineBar, type TimelineBarHandle } from './ui/TimelineBar';
import { Toasts, useToasts } from './ui/Toasts';
import { TopicPreview } from './ui/TopicPreview';
import { YearDisplay } from './ui/YearDisplay';

/** Folder of the borders dataset (scripts/data/sync-atlas-data.mjs), ending with '/'. */
const DATA_BASE = '/data/alexs-atlas/';
const MANIFEST_URL = `${DATA_BASE}manifest.json`;
/** Default camera centre: Europe, Africa and western Asia in view. */
const DEFAULT_CENTER: [number, number] = [15, 30];
const PHONE_QUERY = '(max-width: 639.98px)';
/** Extra margin (px) around a polity when the globe flies to it. */
const FIT_MARGIN = 40;
/** replaceState at most once per this many ms while scrubbing or panning. */
const URL_THROTTLE_MS = 300;
/** The screen-reader year announcement waits until scrubbing pauses this long. */
const ANNOUNCE_YEAR_MS = 800;
/** The SL/HL choice shared with the notes library and topic pages. */
const LEVEL_KEY = 'history-level';
/** Scale at which a note's place is shown when the explorer opens on it. */
const TOPIC_SCALE = 1.4;
const MIN_SCALE = 0.5;
/** A pin's or row's preview stays this long after the pointer leaves, so it can reach the card. */
const HOVER_LINGER_MS = 700;

type Panel = 'search' | 'notes' | 'key' | null;
type Padding = { top: number; right: number; bottom: number; left: number };
type YearSource = 'timeline' | 'url' | 'jump';
type SelectSource = 'click' | 'search' | 'list' | 'url' | 'history' | 'api';

/** Track positions: human origins to the dataset's first year take the first 8 %;
 * Alex's Atlas's default stops fill the rest. */
function timelineStops(present: number): [number, number][] {
  const atlas = defaultStops(present).map(([y, t]) => [y, 0.08 + 0.92 * t] as [number, number]);
  return [[FIRST_YEAR, 0], [-10000, 0.04], ...atlas];
}

function isTextEntry(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t instanceof HTMLTextAreaElement || t instanceof HTMLSelectElement) return true;
  return t instanceof HTMLInputElement && !['button', 'checkbox', 'radio', 'range', 'reset', 'submit', 'color', 'file', 'image'].includes(t.type);
}

function isActivatable(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  if (t instanceof HTMLButtonElement || t instanceof HTMLAnchorElement || t.tagName === 'SUMMARY') return true;
  if (t instanceof HTMLInputElement) return ['button', 'checkbox', 'radio', 'range', 'reset', 'submit'].includes(t.type);
  const role = t.getAttribute('role');
  return role === 'button' || role === 'link' || role === 'option' || role === 'tab' || role === 'menuitem' || role === 'slider';
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
/** Read directly: the `phone` state lags one render behind (the first view is computed before it is set). */
const isPhone = () => typeof matchMedia === 'function' && matchMedia(PHONE_QUERY).matches;
const noteText = (topic: GlobeTopic) => normalizeText(`${topic.title} ${topic.summary} ${topic.place} ${topic.unitTitle}`);

export default function GlobeExplorer({ topics, snapshots, currentYear }: GlobeData) {
  // ---- elements and imperative parts ------------------------------------------------
  const rootEl = useRef<HTMLDivElement>(null);
  const stageEl = useRef<HTMLDivElement>(null);
  const mapEl = useRef<HTMLDivElement>(null);
  const hudLeftEl = useRef<HTMLDivElement>(null);
  const hudRightEl = useRef<HTMLDivElement>(null);
  const dockEl = useRef<HTMLDivElement>(null);
  const search = useRef<SearchPanelHandle>(null);
  const timeline = useRef<TimelineBarHandle>(null);
  const announcer = useRef<AnnouncerHandle>(null);
  const about = useRef<DialogHandle>(null);
  const shortcuts = useRef<DialogHandle>(null);
  const ctrl = useRef<GlobeController | null>(null);
  const bordersRef = useRef<BordersClient | null>(null);
  const borders = () => (bordersRef.current ??= createBorders({ manifestUrl: MANIFEST_URL }));
  const history = useRef<HistoryWriter | null>(null);
  const camera = useRef<GlobeView>({ center: DEFAULT_CENTER, scale: 1 });
  const indexRef = useRef<Record<string, PolityInfo> | null>(null);
  const indexLoad = useRef<Promise<Record<string, PolityInfo> | null> | null>(null);
  const selectSeq = useRef(0);
  const userChangedYear = useRef(false);
  /** The next URL write pushes a history entry (a selection) instead of replacing. */
  const pushNext = useRef(false);
  /** A polity named by the URL is framed once the globe is ready (when the URL had no view). */
  const flyWhenReady = useRef<string | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // ---- state ---------------------------------------------------------------------------
  const [hydrated, setHydrated] = useState(false);
  const [manifest, setManifest] = useState<Manifest | null>(null);
  const [index, setIndex] = useState<Record<string, PolityInfo> | null>(null);
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [appliedYear, setAppliedYear] = useState(DEFAULT_YEAR);
  const [borderYear, setBorderYear] = useState<number | null>(null);
  const [bordersLoading, setBordersLoading] = useState(true);
  const [rows, setRows] = useState<ListRow[]>([]);
  const [selectedPid, setSelectedPid] = useState<string | null>(null);
  const [level, setLevel] = useState<'SL' | 'HL'>('SL');
  const [curriculum, setCurriculum] = useState<'2028' | 'archive'>('2028');
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<GlobeTopic | null>(null);
  const [hovered, setHovered] = useState<GlobeTopic | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [searchRequest, setSearchRequest] = useState<{ token: number; mode: 'search' | 'list' }>();
  const [notesFocus, setNotesFocus] = useState(0);
  const [eraOpen, setEraOpen] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [landReady, setLandReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [phone, setPhone] = useState(false);
  const [view, setView] = useState<GlobeView>(camera.current);
  /** A flight to a note, made after the render that shows its card (so the card is measured). */
  const [flight, setFlight] = useState<{ topic: GlobeTopic; animate?: boolean; scale?: number } | null>(null);
  const { toasts, show: toast, dismiss } = useToasts();

  // ---- derived -----------------------------------------------------------------------------
  const ready = landReady && !mapFailed;
  const present = manifest?.years.present ?? currentYear;
  const bakedBorders = year >= BAKED_FRAME[0] && year <= BAKED_FRAME[1];
  const snapshot = snapshots[indexOfYear(snapshots, year)];
  const inCourse = useMemo(
    () => topics.filter((topic) => topic.curriculum === curriculum && (level === 'HL' || topic.level !== 'HL')),
    [topics, level, curriculum],
  );
  const filtered = useMemo(() => {
    const key = normalizeText(query.trim());
    return key ? inCourse.filter((topic) => noteText(topic).includes(key)) : inCourse;
  }, [inCourse, query]);
  const visible = useMemo(() => filtered.filter((topic) => showAll || topicInYear(topic, year)), [filtered, showAll, year]);
  const activeSet = useMemo(() => new Set(visible.map((topic) => topic.slug)), [visible]);
  const highlight = useMemo(() => {
    const spans = selectedPid ? index?.[selectedPid]?.spans : undefined;
    if (spans?.length) return spans.map(([from, to]) => ({ from, to }));
    return selected ? [{ from: selected.start, to: selected.end }] : null;
  }, [selectedPid, index, selected]);
  const stops = useMemo(() => timelineStops(present), [present]);
  const preview = hovered ?? (selected && filtered.includes(selected) ? selected : null);
  const shownBorders = ready ? borderYear : mapFailed && bakedBorders ? year : null;
  const borderStatus = !ready && !mapFailed
    ? 'Loading political borders…'
    : shownBorders !== null
      ? `Political borders as of ${formatYear(shownBorders)}.`
      : year < (manifest?.years.from ?? -3400)
        ? 'Physical geography only: the political borders begin in 3400 BCE.'
        : 'Physical geography only: this device cannot show the detailed globe with its political borders.';
  /** The year of the polity list: the borders on screen, or the year shown when WebGL failed. */
  const listYear = mapFailed ? year : appliedYear;

  /** The latest state, for the imperative handlers (globe callbacks, keyboard, history). */
  const latest = useRef({ year, listYear, selectedPid, selected, hovered, panel, phone, ready, rows, level, curriculum, showAll, query, playing, eraOpen, visible });
  latest.current = { year, listYear, selectedPid, selected, hovered, panel, phone, ready, rows, level, curriculum, showAll, query, playing, eraOpen, visible };

  // ---- layout: insets of the chrome over the map (flights keep their target clear) -----
  /** `card`: also keep clear of the note card (on phones it spans the bottom of the map). */
  const insets = (card = false): Padding => {
    const stage = stageEl.current?.getBoundingClientRect();
    if (!stage) return { top: 0, right: 0, bottom: 0, left: 0 };
    const gap = 8;
    const phoneLayout = isPhone();
    const { width, height } = stage;
    const yearBottom = stageEl.current?.querySelector('.era, .year-display')?.getBoundingClientRect().bottom ?? stage.top;
    const dock = dockEl.current?.getBoundingClientRect();
    let bottom = (dock && dock.height > 0 ? Math.max(0, Math.round(stage.bottom - dock.top)) : phoneLayout ? 100 : 56) + gap;
    let top: number;
    let left = 0;
    let right = 0;
    if (phoneLayout) {
      // Narrow screens: the corner buttons belong to the top band (side insets would squeeze the globe).
      const cornersBottom = Math.max(hudLeftEl.current?.getBoundingClientRect().bottom ?? 0, hudRightEl.current?.getBoundingClientRect().bottom ?? 0);
      top = Math.max(0, Math.round(Math.max(yearBottom, cornersBottom) - stage.top)) + gap;
      const preview = card ? stageEl.current?.querySelector('.preview')?.getBoundingClientRect() : undefined;
      if (preview && preview.height > 0) bottom = Math.max(bottom, Math.round(stage.bottom - preview.top) + gap);
    } else {
      top = Math.max(0, Math.round(yearBottom - stage.top)) + gap;
      const open = latest.current.panel;
      const panelEl = open === 'search' ? search.current?.panelElement : open === 'notes' ? rootEl.current?.querySelector<HTMLElement>('.notes__panel') : null;
      const leftChrome = panelEl ?? hudLeftEl.current;
      left = Math.max(0, Math.round((leftChrome?.getBoundingClientRect().right ?? stage.left) - stage.left)) + gap;
      right = Math.max(0, Math.round(stage.right - (hudRightEl.current?.getBoundingClientRect().left ?? stage.right))) + gap;
    }
    if (height - top - bottom < 160) bottom = Math.max(0, height - top - 160);
    if (width - left - right < 200) {
      const k = Math.max(0, width - 200) / Math.max(1, left + right);
      left *= k;
      right *= k;
    }
    return { top, right: Math.round(right), bottom: Math.round(bottom), left: Math.round(left) };
  };
  const fitPadding = (): Padding => {
    const p = insets(true);
    return { top: p.top + FIT_MARGIN, right: p.right + FIT_MARGIN, bottom: p.bottom + FIT_MARGIN, left: p.left + FIT_MARGIN };
  };
  /** Scale at which the globe fills the free area between the year and the timeline. */
  const defaultScale = (): number => {
    const stage = stageEl.current?.getBoundingClientRect();
    if (!stage || !stage.width || !stage.height) return 1;
    const p = insets();
    const free = Math.max(120, Math.min(stage.width - p.left - p.right, stage.height - p.top - p.bottom));
    return Math.max(MIN_SCALE, free / Math.min(stage.width, stage.height));
  };

  // ---- camera ------------------------------------------------------------------------------
  const changeView = (next: GlobeView) => {
    camera.current = next;
    setView(next);
    ctrl.current?.setView(next.center, next.scale);
  };
  const resetView = () => {
    const next = { center: DEFAULT_CENTER, scale: defaultScale() };
    if (latest.current.ready && ctrl.current) ctrl.current.globe.setView(next, { animate: true });
    else changeView(next);
  };
  const flyToPolity = (pid: string, y: number) => {
    void ctrl.current?.globe.flyToPolity(pid, { year: y, padding: fitPadding() });
  };
  /** The camera centre that shows `place` `offset` px from the middle of the map (orthographic approximation). */
  const offsetCenter = ([lng, lat]: [number, number], scale: number, [dx, dy]: [number, number]): [number, number] => {
    const stage = stageEl.current?.getBoundingClientRect();
    if (!stage?.width || !stage.height) return [lng, lat];
    const radius = (scale * Math.min(stage.width, stage.height)) / 2;
    const deg = 180 / Math.PI;
    const centerLat = Math.max(-80, Math.min(80, lat + (dy / radius) * deg));
    const centerLng = lng - (dx / radius / Math.max(0.2, Math.cos(lat / deg))) * deg;
    return [((((centerLng + 180) % 360) + 360) % 360) - 180, centerLat];
  };
  /** Shows a note's place in the middle of the free area between the panels, the card and the timeline. */
  const flyToTopic = (topic: GlobeTopic, o: { animate?: boolean; scale?: number } = {}) => {
    const p = insets(true);
    const offset: [number, number] = [(p.left - p.right) / 2, (p.top - p.bottom) / 2];
    if (latest.current.ready && ctrl.current) ctrl.current.flyTo(topic, { offset, animate: o.animate });
    else {
      const scale = o.scale ?? Math.max(TOPIC_SCALE, camera.current.scale);
      changeView({ center: offsetCenter([topic.lng, topic.lat], scale, offset), scale });
    }
  };

  // ---- year ------------------------------------------------------------------------------------
  /** Shows `y` (clamped, never 0). `interacting` = a live timeline drag or playback (coarse borders). */
  const goToYear = (y: number, source: YearSource, interacting = false) => {
    const next = clampYear(y, currentYear);
    ctrl.current?.setInteracting(interacting);
    if (source !== 'timeline') timeline.current?.setValue(next);
    if (source !== 'url') userChangedYear.current = true;
    setYear(next);
  };

  // ---- polity selection (ported from app.ts selectPolity) --------------------------------
  const loadIndex = (): Promise<Record<string, PolityInfo> | null> => {
    if (indexRef.current) return Promise.resolve(indexRef.current);
    indexLoad.current ??= borders()
      .polities()
      .then((value) => {
        indexRef.current = value;
        setIndex(value);
        return value;
      })
      .catch(() => {
        indexLoad.current = null;
        toast('The list of places could not be loaded; search is unavailable for now.', { kind: 'error' });
        return null;
      });
    return indexLoad.current;
  };

  const selectPolity = async (pid: string | null, o: { source: SelectSource; fly?: boolean; push?: boolean }) => {
    const seq = ++selectSeq.current;
    if (pid === null) {
      if (latest.current.selectedPid === null) return;
      latest.current.selectedPid = null; // before select(): its onSelect echo must see the change
      setSelectedPid(null);
      ctrl.current?.globe.select(null);
      if (o.push) pushNext.current = true;
      return;
    }
    const idx = await loadIndex();
    if (seq !== selectSeq.current) return; // another selection (or a deselection) came first
    const info = idx?.[pid];
    if (!info && idx && (o.source === 'url' || o.source === 'history')) {
      toast('That link names a place this map does not know; showing the year only.');
      if (latest.current.selectedPid) void selectPolity(null, { source: 'api' });
      return;
    }
    // Searching or picking from the list jumps to a year in which the polity exists.
    let target = latest.current.year;
    let jumped = false;
    if (info && (o.source === 'search' || o.source === 'list') && !aliveIn(info.spans, target)) {
      const jump = info.peak !== undefined && aliveIn(info.spans, info.peak) ? info.peak : nearestYearIn(info.spans, target);
      if (jump !== null) {
        target = jump;
        jumped = true;
        goToYear(jump, 'jump');
      }
    }
    const changed = latest.current.selectedPid !== pid;
    latest.current.selectedPid = pid; // before select(): its onSelect echo must see the change
    setSelectedPid(pid);
    ctrl.current?.globe.select(pid);
    if (o.fly) {
      if (latest.current.ready) flyToPolity(pid, target);
      else flyWhenReady.current = pid;
    }
    // Choosing the polity already shown changes nothing: the next scrub still replaces.
    if (o.push && (changed || jumped)) pushNext.current = true;
    if (changed) {
      const life = lifespan(info);
      const name = info?.name ?? latest.current.rows.find((r) => r.pid === pid)?.name ?? pid;
      announcer.current?.say(`Selected ${name}${life ? `, ${formatSpan(life.from, life.to, present)}` : ''}.`, { channel: 'select' });
    }
  };

  /** Clicks on the globe, and echoes of our own select() calls. */
  const onGlobeSelect = (info: SelectInfo | null) => {
    if (info === null) {
      if (latest.current.selectedPid !== null) void selectPolity(null, { source: 'click', push: true });
      return;
    }
    if (info.pid !== latest.current.selectedPid) void selectPolity(info.pid, { source: 'click', push: true });
  };

  /** Search: an exact name first, then the polities on the map in the year shown, then the rest. */
  const searchPolities = async (q: string): Promise<PolitySearchResult[]> => {
    const results = await borders().search(q, { limit: 40 });
    const key = normalizeText(q);
    const rank = (r: PolitySearchResult) => (normalizeText(r.name) === key ? 0 : aliveIn(r.spans, latest.current.listYear) ? 1 : 2);
    return results
      .map((r, i) => ({ r, i, k: rank(r) }))
      .sort((a, b) => a.k - b.k || a.i - b.i)
      .slice(0, 20)
      .map((x) => x.r);
  };

  /** Notes for the search panel: those of the level and collection whose text matches, titles first. */
  const notesFor = (q: string): GlobeTopic[] => {
    const key = normalizeText(q.trim());
    if (!key) return [];
    return inCourse
      .filter((topic) => noteText(topic).includes(key))
      .sort((a, b) => Number(!normalizeText(a.title).includes(key)) - Number(!normalizeText(b.title).includes(key)));
  };

  // ---- notes -------------------------------------------------------------------------------
  /** The card previews the note under the pointer or focus, and lingers so the pointer can reach it. */
  const hover = (topic: GlobeTopic) => {
    clearTimeout(hoverTimer.current);
    setHovered(topic);
  };
  const unhover = (topic?: GlobeTopic) => {
    clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      setHovered((previous) => (!topic || previous?.slug === topic.slug ? null : previous));
    }, HOVER_LINGER_MS);
  };

  /** Goes to a note: its first year, its place on the globe, the note selected. */
  const locate = (topic: GlobeTopic) => {
    const s = latest.current;
    timeline.current?.pause();
    // A history entry only when something changes (re-locating the note shown just flies back).
    if (s.selected?.slug !== topic.slug || s.year !== clampYear(topic.start, currentYear) || s.selectedPid !== null) pushNext.current = true;
    // The newest selection wins: the timeline shows the note's dates and F fits the note.
    if (s.selectedPid !== null) void selectPolity(null, { source: 'api' });
    setSelected(topic);
    goToYear(topic.start, 'jump');
    if (isPhone()) setPanel(null);
    setFlight({ topic });
    announcer.current?.say(`${topic.title}, ${formatRange(topic.start, topic.end)}, ${topic.place}.`, { channel: 'select' });
  };

  const openAbout = () => {
    setPanel(null);
    about.current?.open();
  };
  const openShortcuts = () => {
    about.current?.close();
    shortcuts.current?.open();
  };
  const fitSelected = () => {
    const { selectedPid: pid, selected: topic, listYear: y } = latest.current;
    if (pid) flyToPolity(pid, y);
    else if (topic) flyToTopic(topic);
    else toast('Select a place or a note first: click it on the globe, search for it or choose it in the notes.');
  };

  // ---- URL ---------------------------------------------------------------------------------------
  const urlState = (): GlobeUrlState => {
    const s = latest.current;
    let v = camera.current;
    try {
      if (ctrl.current && s.ready) v = ctrl.current.getView();
    } catch {
      /* no map */
    }
    return {
      year: s.year,
      level: s.level,
      curriculum: s.curriculum,
      topic: s.selected?.slug,
      polity: s.selectedPid ?? undefined,
      all: s.showAll || undefined,
      q: s.query.trim() || undefined,
      view: { lng: v.center[0], lat: v.center[1], scale: v.scale },
    };
  };

  /** Reads the URL: on load and on Back/Forward. */
  const applyUrl = (initial: boolean) => {
    const s = parseGlobeUrl(window.location.search, { minYear: FIRST_YEAR, maxYear: currentYear });
    const topic = topics.find((entry) => entry.slug === s.topic) ?? null;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(LEVEL_KEY);
    } catch {
      /* storage may be disabled */
    }
    setLevel(s.level ?? (topic?.level === 'HL' || (initial && stored === 'HL') ? 'HL' : initial ? 'SL' : latest.current.level));
    setCurriculum(s.curriculum ?? (topic?.curriculum === 'archive' ? 'archive' : '2028'));
    setShowAll(s.all === true);
    setQuery(s.q ?? '');
    setSelected(topic);
    goToYear(s.year ?? topic?.start ?? DEFAULT_YEAR, 'url');
    const next: GlobeView | null = s.view
      ? { center: [s.view.lng, s.view.lat], scale: s.view.scale }
      : topic
        ? { center: [topic.lng, topic.lat], scale: TOPIC_SCALE }
        : initial
          ? { center: DEFAULT_CENTER, scale: defaultScale() }
          : null;
    if (next) {
      if (!initial && latest.current.ready && ctrl.current) {
        camera.current = next;
        ctrl.current.globe.setView(next, { animate: !reducedMotion() });
      } else changeView(next);
    }
    // A link to a note (no camera in it): once its card is on screen, move the place clear of it.
    if (topic && !s.view) setFlight({ topic, animate: false, scale: TOPIC_SCALE });
    const pid = s.polity ?? null;
    if (pid !== latest.current.selectedPid) void selectPolity(pid, { source: initial ? 'url' : 'history', fly: !s.view, push: false });
  };

  // Read URL state after hydration, so the server render and the first client render agree.
  useEffect(() => {
    history.current = new HistoryWriter(window, URL_THROTTLE_MS);
    applyUrl(true);
    setHydrated(true);
    const onPop = () => {
      pushNext.current = false; // Back/Forward never pushes
      history.current?.cancel();
      applyUrl(false);
    };
    window.addEventListener('popstate', onPop);
    return () => {
      window.removeEventListener('popstate', onPop);
      history.current?.cancel();
      clearTimeout(hoverTimer.current);
    };
  }, []);

  // Write it back: replace while scrubbing and panning (throttled), push a selection.
  useEffect(() => {
    if (!hydrated || playing) return;
    const writer = history.current;
    if (!writer) return;
    if (pushNext.current) {
      pushNext.current = false;
      writer.push(urlState());
    } else writer.replace(urlState());
    try {
      window.localStorage.setItem(LEVEL_KEY, level);
    } catch {
      /* storage may be disabled */
    }
  }, [hydrated, playing, year, level, curriculum, selected, selectedPid, showAll, query]);

  // ---- data and the WebGL globe -----------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    borders()
      .ready()
      .then((m) => {
        if (!cancelled) setManifest(m);
      })
      .catch(() => {
        if (!cancelled) toast('The map data could not be loaded. Reload the page to try again.', { kind: 'error' });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let controller: GlobeController | undefined;
    import('./map')
      .then(({ GlobeController: Controller }) => {
        if (cancelled || !mapEl.current) return;
        controller = new Controller(
          mapEl.current,
          {
            onPinEnter: hover,
            onPinLeave: unhover,
            onPinClick: () => {
              /* Every pin remains a direct, native note link. */
            },
            onLoadingChange: setBordersLoading,
            onBordersChange: setBorderYear,
            onYearApplied: (y) => {
              setAppliedYear(y);
              const nextRows = sortRows(rowsFromFeatures(controller?.globe.layers?.frameFeatures() ?? []), 'name', 1);
              setRows(nextRows);
              if (userChangedYear.current && !timeline.current?.isPlaying()) {
                announcer.current?.say(`${spokenYear(y)}. ${countPolities(nextRows.length)} on the map.`, { channel: 'year', delay: ANNOUNCE_YEAR_MS });
              }
            },
            onViewChange: (next) => {
              camera.current = next;
              if (!latest.current.playing) history.current?.replace(urlState());
            },
            onSelect: onGlobeSelect,
            onDataError: () => {
              toast(`Borders for ${formatYear(latest.current.year)} could not be loaded. Change the year to try again.`, { kind: 'error' });
            },
            onFailure: () => {
              setView(camera.current);
              setMapFailed(true);
              setBorderYear(null);
              toast('The detailed globe could not start on this device, so a simpler globe is shown.', { kind: 'error' });
            },
          },
          { year: latest.current.year, view: camera.current, borders: borders(), minScale: MIN_SCALE },
        );
        ctrl.current = controller;
        if (latest.current.selectedPid) controller.globe.select(latest.current.selectedPid);
        controller.setTopics(latest.current.visible);
        void controller.whenReady().then(() => {
          if (cancelled || !controller) return;
          controller.setView(camera.current.center, camera.current.scale);
          setLandReady(true);
          const pid = flyWhenReady.current;
          flyWhenReady.current = null;
          if (pid) void controller.globe.flyToPolity(pid, { year: latest.current.year, padding: fitPadding() });
          announcer.current?.say(`Map loaded: ${spokenYear(latest.current.year)}.`, { channel: 'year' });
          // The polity index (search, lifespans) loads when the browser is idle after the first frame.
          const idle = (cb: () => void) => ('requestIdleCallback' in window ? window.requestIdleCallback(cb, { timeout: 2000 }) : setTimeout(cb, 300));
          idle(() => void loadIndex());
        });
        if (import.meta.env.DEV) (window as unknown as { __globe: GlobeController }).__globe = controller;
      })
      .catch((error) => {
        console.warn('Detailed globe unavailable; using the interactive base globe.', error);
        setMapFailed(true);
      });
    return () => {
      cancelled = true;
      ctrl.current = null;
      controller?.destroy();
    };
  }, []);

  useEffect(() => {
    ctrl.current?.setYear(year);
  }, [year]);

  useEffect(() => {
    if (flight) flyToTopic(flight.topic, flight);
  }, [flight]);

  // Without WebGL the list of polities comes straight from the data (the SVG globe has no layers).
  useEffect(() => {
    if (!mapFailed || playing) return;
    let cancelled = false;
    borders()
      .bordersAt(year, { lod: 'l0' })
      .then((fc) => {
        if (!cancelled) setRows(sortRows(rowsFromFeatures(fc.features), 'name', 1));
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      });
    return () => {
      cancelled = true;
    };
  }, [mapFailed, playing, year]);

  useEffect(() => {
    ctrl.current?.setTopics(visible);
  }, [visible, ready]);

  useEffect(() => {
    ctrl.current?.updatePins({ active: activeSet, selected: selected?.slug ?? null, hovered: hovered?.slug ?? null }, visible);
  }, [activeSet, selected, hovered, visible, ready]);

  // One popover at a time: a top-left panel closes the era card.
  useEffect(() => {
    if (panel) setEraOpen(false);
  }, [panel]);

  // ---- layout: phone mode and the timeline bar's height ---------------------------------------
  useEffect(() => {
    const media = matchMedia(PHONE_QUERY);
    const update = () => setPhone(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const bar = timeline.current?.element;
    const root = rootEl.current;
    if (!bar || !root || typeof ResizeObserver !== 'function') return;
    const measure = () => root.style.setProperty('--timeline-h', `${Math.round(bar.getBoundingClientRect().height) || (latest.current.phone ? 88 : 40)}px`);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(bar);
    return () => observer.disconnect();
  }, []);

  // ---- keyboard (ported from app.ts onKeyDown, plus N for the notes) --------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const s = latest.current;
      if (e.key === 'Escape' || e.key === 'Esc') {
        if (e.defaultPrevented || about.current?.isOpen || shortcuts.current?.isOpen) return;
        if (s.hovered) {
          // A pin's or row's preview first: it may cover the focused pin (WCAG 1.4.13).
          e.preventDefault();
          clearTimeout(hoverTimer.current);
          setHovered(null);
        } else if (s.eraOpen) {
          e.preventDefault();
          setEraOpen(false);
        } else if (s.panel) {
          e.preventDefault();
          setPanel(null);
        } else if (s.selectedPid) {
          e.preventDefault();
          void selectPolity(null, { source: 'api', push: true });
        } else if (s.selected) {
          e.preventDefault();
          setSelected(null);
        }
        return;
      }
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTextEntry(e.target)) return;
      if (about.current?.isOpen || shortcuts.current?.isOpen) return;
      const inTimeline = e.target instanceof Node && !!dockEl.current?.contains(e.target);
      switch (e.key) {
        case '/':
          e.preventDefault();
          setPanel('search');
          setSearchRequest((r) => ({ token: (r?.token ?? 0) + 1, mode: 'search' }));
          break;
        case 'l':
        case 'L':
          e.preventDefault();
          if (s.panel === 'search') setPanel(null);
          else {
            setPanel('search');
            setSearchRequest((r) => ({ token: (r?.token ?? 0) + 1, mode: 'list' }));
          }
          break;
        case 'n':
        case 'N':
          e.preventDefault();
          setPanel('notes');
          setNotesFocus((n) => n + 1);
          break;
        case '?':
          e.preventDefault();
          shortcuts.current?.open();
          break;
        case '[':
        case ']':
          if (inTimeline || !timeline.current) return; // the timeline handles its own keys
          e.preventDefault();
          if (timeline.current.stepChange(e.key === '[' ? -1 : 1) === null) {
            toast(e.key === '[' ? 'No earlier border change.' : 'No later border change in the data.');
          }
          break;
        case ' ':
        case 'Spacebar':
          if (inTimeline || isActivatable(e.target) || !timeline.current || e.repeat) return;
          if (e.target instanceof Node && !!hudLeftEl.current?.contains(e.target)) return;
          e.preventDefault();
          timeline.current.togglePlay();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          fitSelected();
          break;
        case 'r':
        case 'R':
          e.preventDefault();
          resetView();
          break;
        default:
          break;
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, []);

  // ---- render --------------------------------------------------------------------------------------
  const zoom = (delta: number) => {
    if (ready && ctrl.current) ctrl.current.zoomBy(delta);
    else changeView({ ...view, scale: Math.min(8, Math.max(MIN_SCALE, view.scale * 2 ** delta)) });
  };

  return (
    <div
      className="gx"
      ref={rootEl}
      data-layout={phone ? 'phone' : 'wide'}
      data-panel={panel ?? undefined}
      data-ready={ready || undefined}
      data-playing={playing || undefined}
      data-failed={mapFailed || undefined}
    >
      <a
        className="skip-link"
        href="#gx-timeline"
        onClick={(e) => {
          e.preventDefault();
          dockEl.current?.querySelector<HTMLInputElement>('input[type="range"]')?.focus({ preventScroll: true });
        }}
      >
        Skip to the timeline
      </a>
      {/* BaseLayout already provides the page's <main>: the stage is a labelled region. */}
      <div className="stage" ref={stageEl} role="region" aria-label="Map">
        <h1 className="sr-only">Explore history on the globe</h1>
        <div className="globe">
          {!ready && (
            <PrebakedGlobe topics={visible} center={view.center} scale={view.scale} borders={bakedBorders} onViewChange={changeView} className="gx-baked" />
          )}
          <div className="gx-map" ref={mapEl} aria-hidden={!ready} inert={!ready} />
        </div>
        <YearDisplay year={year} loading={bordersLoading && !mapFailed} />
        <EraCaption
          year={year}
          snapshot={snapshot}
          status={borderStatus}
          open={eraOpen}
          onOpenChange={(open) => {
            setEraOpen(open);
            if (open) setPanel(null); // one popover at a time
          }}
        />
        <div className="hud hud--left" ref={hudLeftEl}>
          <SearchPanel
            ref={search}
            open={panel === 'search'}
            onOpenChange={(open) => setPanel((current) => (open ? 'search' : current === 'search' ? null : current))}
            request={searchRequest}
            search={searchPolities}
            rows={rows}
            year={listYear}
            present={present}
            lifespan={(pid) => lifespan(index?.[pid])}
            color={(p) => fillColor(p, listYear)}
            selected={selectedPid}
            onChoose={(pid, source) => {
              void selectPolity(pid, { source, fly: true, push: true });
              if (isPhone()) setPanel(null);
            }}
            notes={notesFor}
            onChooseNote={locate}
          />
          <NotesPanel
            open={panel === 'notes'}
            onOpenChange={(open) => setPanel((current) => (open ? 'notes' : current === 'notes' ? null : current))}
            focusToken={notesFocus}
            topics={filtered}
            visible={activeSet}
            year={year}
            level={level}
            onLevel={setLevel}
            curriculum={curriculum}
            onCurriculum={setCurriculum}
            showAll={showAll}
            onShowAll={setShowAll}
            query={query}
            onQuery={setQuery}
            selected={selected?.slug ?? null}
            onLocate={locate}
            onHover={(topic) => (topic ? hover(topic) : unhover())}
          />
          <Legend year={listYear} open={panel === 'key'} onOpenChange={(open) => setPanel((current) => (open ? 'key' : current === 'key' ? null : current))} />
        </div>
        <div className="hud hud--right" ref={hudRightEl}>
          <div className="hud__item">
            <IconButton icon="info" label="About this globe and credits" title="About & credits" aria-haspopup="dialog" onClick={openAbout} />
          </div>
        </div>
        <MapControls onZoomIn={() => zoom(1)} onZoomOut={() => zoom(-1)} onReset={resetView} />
        {preview && (
          <TopicPreview
            topic={preview}
            inYear={activeSet.has(preview.slug)}
            onClose={preview === selected ? () => setSelected(null) : undefined}
            onLocate={locate}
            onPointerEnter={() => clearTimeout(hoverTimer.current)}
            onPointerLeave={() => unhover()}
          />
        )}
      </div>
      <div className="timeline-dock" id="gx-timeline" ref={dockEl}>
        <TimelineBar
          ref={timeline}
          min={FIRST_YEAR}
          max={currentYear}
          value={year}
          present={present}
          frames={manifest?.frames ?? null}
          stops={stops}
          highlight={highlight}
          onInput={(y) => goToYear(y, 'timeline', true)}
          onChange={(y) => goToYear(y, 'timeline', false)}
          onPlayChange={(isPlaying) => {
            setPlaying(isPlaying);
            if (isPlaying) announcer.current?.cancel('year');
            else ctrl.current?.setInteracting(false);
          }}
        />
      </div>
      <Toasts toasts={toasts} onDismiss={dismiss} />
      <Announcer ref={announcer} />
      <Dialog ref={about} id="gx-about" title="About this globe" subtitle="Credits, sources and how the map is made" className="dialog--about">
        <AboutContent manifest={manifest} dataBase={DATA_BASE} onShortcuts={openShortcuts} />
      </Dialog>
      <Dialog ref={shortcuts} id="gx-shortcuts" title="Keyboard shortcuts" className="dialog--shortcuts">
        <ShortcutsContent />
      </Dialog>
    </div>
  );
}
