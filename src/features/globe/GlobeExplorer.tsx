/** SSR supplies the interactive baked globe; WebGL progressively adds detail. */
import { useEffect, useMemo, useRef, useState } from 'react';
import EraPanel from './EraPanel';
import { clampYear, DEFAULT_YEAR, FIRST_YEAR, indexOfYear, topicInYear } from './era';
import './globe.css';
import type { GlobeController } from './map';
import PrebakedGlobe, { BAKED_FRAME, type GlobeView } from './PrebakedGlobe';
import Timeline from './Timeline';
import TopicList from './TopicList';
import TopicPreview from './TopicPreview';
import type { GlobeData, GlobeTopic } from './types';

const DEFAULT_VIEW: GlobeView = { center: [15, 30], scale: 1 };
const LEVEL_KEY = 'history-level';

export default function GlobeExplorer({ topics, snapshots, currentYear }: GlobeData) {
  const mapEl = useRef<HTMLDivElement>(null);
  const ctrl = useRef<GlobeController | null>(null);
  const camera = useRef<GlobeView>(DEFAULT_VIEW);
  const [view, setView] = useState<GlobeView>(DEFAULT_VIEW);
  const [year, setYear] = useState(DEFAULT_YEAR);
  const [level, setLevel] = useState<'SL' | 'HL'>('SL');
  const [curriculum, setCurriculum] = useState<'2028' | 'archive'>('2028');
  const [showAll, setShowAll] = useState(false);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<GlobeTopic | null>(null);
  const [hovered, setHovered] = useState<GlobeTopic | null>(null);
  const [landReady, setLandReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  // The year whose borders the detailed map shows (null: none yet, or before the dataset).
  const [borderYear, setBorderYear] = useState<number | null>(null);
  const [bordersLoading, setBordersLoading] = useState(true);
  const [playing, setPlaying] = useState(false);
  const [listExpanded, setListExpanded] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [eraOpen, setEraOpen] = useState(false);

  const index = indexOfYear(snapshots, year);
  const snapshot = snapshots[index];
  // The baked first frame draws the 1789 borders while the year shown shares them.
  const bakedBorders = year >= BAKED_FRAME[0] && year <= BAKED_FRAME[1];
  // The detailed globe takes over once its first borders have rendered.
  const ready = landReady && !mapFailed;
  const filtered = useMemo(() => {
    const search = query.trim().toLocaleLowerCase();
    return topics.filter((topic) => topic.curriculum === curriculum && (level === 'HL' || topic.level !== 'HL') && (!search || `${topic.title} ${topic.summary} ${topic.place} ${topic.unitTitle}`.toLocaleLowerCase().includes(search)));
  }, [topics, level, curriculum, query]);
  const visible = useMemo(() => filtered.filter((topic) => showAll || topicInYear(topic, year)), [filtered, showAll, year]);
  const activeSet = useMemo(() => new Set(visible.map((topic) => topic.slug)), [visible]);
  const latest = useRef({ visible, year });
  latest.current = { visible, year };

  // Read URL state after hydration so SSR and the first client render agree.
  useEffect(() => {
    const read = () => {
      const params = new URLSearchParams(window.location.search);
      const topic = topics.find((entry) => entry.slug === params.get('topic')) ?? null;
      const requested = params.get('year');
      const value = requested !== null && requested.trim() !== '' ? Number(requested) : NaN;
      setYear(Number.isFinite(value) ? clampYear(value, currentYear) : topic?.start ?? DEFAULT_YEAR);
      setSelected(topic);
      let stored: string | null = null;
      try { stored = window.localStorage.getItem(LEVEL_KEY); } catch { /* storage may be disabled */ }
      const requestedLevel = params.get('level');
      setLevel(requestedLevel === 'HL' || (!requestedLevel && (topic?.level === 'HL' || stored === 'HL')) ? 'HL' : 'SL');
      setCurriculum(params.get('curriculum') === 'archive' || (!params.has('curriculum') && topic?.curriculum === 'archive') ? 'archive' : '2028');
      setShowAll(params.get('all') === '1');
      setQuery(params.get('q') ?? '');
      const lng = Number(params.get('lng'));
      const lat = Number(params.get('lat'));
      const scale = Number(params.get('scale'));
      if (params.has('lng') && params.has('lat') && Number.isFinite(lng) && Number.isFinite(lat)) {
        const next: GlobeView = { center: [Math.max(-180, Math.min(180, lng)), Math.max(-85, Math.min(85, lat))], scale: Number.isFinite(scale) && scale > 0 ? Math.min(8, scale) : 1 };
        camera.current = next;
        setView(next);
        ctrl.current?.setView(next.center, next.scale);
      } else if (topic) {
        const next: GlobeView = { center: [topic.lng, topic.lat], scale: 1.4 };
        camera.current = next;
        setView(next);
        ctrl.current?.setView(next.center, next.scale);
      }
      setHydrated(true);
    };
    read();
    window.addEventListener('popstate', read);
    return () => window.removeEventListener('popstate', read);
  }, [topics, currentYear]);

  useEffect(() => {
    let cancelled = false;
    let controller: GlobeController | undefined;
    import('./map').then(({ GlobeController: Controller }) => {
      if (cancelled || !mapEl.current) return;
      controller = new Controller(mapEl.current, {
        onPinEnter: setHovered,
        onPinLeave: (topic) => setHovered((previous) => previous?.slug === topic.slug ? null : previous),
        onPinClick: () => { /* Every pin remains a direct, native note link. */ },
        onLoadingChange: setBordersLoading,
        onBordersChange: setBorderYear,
        onViewChange: (next) => { camera.current = next; },
        onFailure: () => { setView(camera.current); setMapFailed(true); setBorderYear(null); },
      }, { year: latest.current.year, view: camera.current });
      ctrl.current = controller;
      controller.setTopics(latest.current.visible);
      controller.whenReady().then(() => {
        if (cancelled) return;
        controller!.setView(camera.current.center, camera.current.scale);
        setLandReady(true);
      });
      if (import.meta.env.DEV) (window as unknown as { __globe: GlobeController }).__globe = controller;
    }).catch((error) => console.warn('Detailed globe unavailable; using the interactive base globe.', error));
    return () => { cancelled = true; ctrl.current = null; controller?.destroy(); };
  }, []);

  useEffect(() => {
    const controller = ctrl.current;
    if (!controller) return;
    controller.setYear(year);
    controller.prefetch([snapshots[index + 1]?.year, snapshots[index - 1]?.year].filter((value): value is number => typeof value === 'number'));
  }, [year]);

  useEffect(() => { ctrl.current?.setTopics(visible); }, [visible, ready]);
  useEffect(() => { ctrl.current?.updatePins({ active: activeSet, selected: selected?.slug ?? null, hovered: hovered?.slug ?? null }, visible); }, [activeSet, selected, hovered, visible, ready]);

  useEffect(() => {
    if (!hydrated) return;
    const params = new URLSearchParams(window.location.search);
    params.set('year', String(year));
    params.set('level', level);
    params.set('curriculum', curriculum);
    if (selected) params.set('topic', selected.slug); else params.delete('topic');
    if (showAll) params.set('all', '1'); else params.delete('all');
    if (query) params.set('q', query); else params.delete('q');
    // Home handoff coordinates are consumed once; subsequent camera motion is local.
    params.delete('lng'); params.delete('lat'); params.delete('scale');
    window.history.replaceState(null, '', `${window.location.pathname}?${params}`);
    try { window.localStorage.setItem(LEVEL_KEY, level); } catch { /* storage may be disabled */ }
  }, [year, level, curriculum, selected, showAll, query, hydrated]);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(() => setYear((value) => {
      const next = snapshots.find((entry) => entry.year > value)?.year;
      if (next === undefined) { setPlaying(false); return currentYear; }
      return next;
    }), 3000);
    return () => window.clearInterval(timer);
  }, [playing, snapshots, currentYear]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { setInfoOpen(false); setSelected(null); setListExpanded(false); ctrl.current?.clearSelection(); } };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, []);

  const changeYear = (value: number) => { setPlaying(false); setYear(clampYear(value, currentYear)); setSelected(null); setHovered(null); };
  const changeView = (next: GlobeView) => { camera.current = next; setView(next); ctrl.current?.setView(next.center, next.scale); };
  const locate = (topic: GlobeTopic) => {
    setPlaying(false); setYear(topic.start); setSelected(topic); setListExpanded(false);
    if (ready) ctrl.current?.flyTo(topic);
    else changeView({ center: [topic.lng, topic.lat], scale: 1.4 });
  };
  const preview = hovered ?? (selected && filtered.includes(selected) ? selected : null);

  return (
    <div className="gx" data-ready={ready || undefined}>
      <h1 className="visually-hidden">Explore history on the globe</h1>
      <div className="gx-world">
        {!ready && <PrebakedGlobe topics={visible} center={view.center} scale={view.scale} borders={bakedBorders} onViewChange={changeView} className="gx-baked" />}
        <div className="gx-map" ref={mapEl} aria-hidden={!ready} inert={!ready} />
      </div>
      <TopicList year={year} topics={filtered} visible={activeSet} selected={selected?.slug ?? null} query={query} onQuery={setQuery} level={level} onLevel={setLevel} curriculum={curriculum} onCurriculum={setCurriculum} showAll={showAll} onShowAll={setShowAll} expanded={listExpanded} onToggle={() => setListExpanded((open) => !open)} onSelect={locate} onHover={setHovered} />
      <EraPanel year={year} snapshot={snapshot} borderYear={ready ? borderYear : mapFailed && bakedBorders ? year : null} loading={!mapFailed && (!ready || bordersLoading)} open={eraOpen} onToggle={() => setEraOpen((open) => !open)} />
      <div className="gx-tools" role="toolbar" aria-label="Globe controls">
        <button type="button" className="gx-tool" onClick={() => ready ? ctrl.current?.zoomBy(0.5) : changeView({ ...view, scale: Math.min(8, view.scale * 1.3) })} aria-label="Zoom in">+</button>
        <button type="button" className="gx-tool" onClick={() => ready ? ctrl.current?.zoomBy(-0.5) : changeView({ ...view, scale: Math.max(0.6, view.scale / 1.3) })} aria-label="Zoom out">−</button>
        <button type="button" className="gx-tool" onClick={() => ready ? ctrl.current?.resetView() : changeView(DEFAULT_VIEW)} aria-label="Reset globe view">◎</button>
        <button type="button" className="gx-tool" onClick={() => setInfoOpen((open) => !open)} aria-expanded={infoOpen} aria-label="About this map">i</button>
      </div>
      {infoOpen && <aside className="gx-panel gx-info" aria-label="About this map"><h2>Reading the globe</h2><p>Each pin opens one note. Pins appear only within that note’s date range; use “Show pins from all years” to explore the whole collection.</p><p>The timeline and world summaries are independent of the syllabus. SL shows shared course content; HL also includes the regional study.</p><p>Borders follow the selected year from 3400 BCE to the present, clipped to modern coastlines. Before 3400 BCE the globe shows physical geography only. Dashed outlines mark approximate extents; hatched areas are indigenous nations and disputed areas. Hover over a country to see its name and years, or click it to outline it.</p><p className="gx-info__credit">Historical borders: <a href="https://github.com/Seshat-Global-History-Databank/cliopatria">Cliopatria</a> (Seshat Global History Databank), Bennett et al., <i>Scientific Data</i> 12, 247 (2025), <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a>, modified by Alex’s Atlas (clipped to Natural Earth land, islands assigned, sourced corrections). Native American nations in the United States before 1946 adapted from <i>Tribal Lands Ceded to the United States</i>, USDA Forest Service (2018), CC BY 4.0. Land, lakes and modern borders: <a href="https://www.naturalearthdata.com/">Natural Earth</a>. <a href="/data/alexs-atlas/ATTRIBUTION.md">Full attribution</a>.</p><button type="button" className="gx-btn" onClick={() => setInfoOpen(false)}>Close</button></aside>}
      {preview && <TopicPreview topic={preview} inEra={activeSet.has(preview.slug)} onClose={selected ? () => setSelected(null) : undefined} onJump={locate} />}
      <Timeline snapshots={snapshots} year={year} currentYear={currentYear} onYear={changeYear} playing={playing} onTogglePlay={() => { if (!playing && year >= currentYear) setYear(FIRST_YEAR); setPlaying((value) => !value); }} />
    </div>
  );
}
