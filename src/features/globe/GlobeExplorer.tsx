/**
 * The /globe page: a 3D globe of historical borders with IB topic pins and a
 * timeline. Rendered client-only (client:only="react") because MapLibre needs
 * the DOM and WebGL.
 *
 * State lives here; MapLibre lives in GlobeController (map.ts). URL query
 * (?year=1938&topic=slug) mirrors the state so views can be linked and "Back"
 * from the notes returns to the same place.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import EraPanel from './EraPanel';
import { indexOfYear, topicInEra } from './era';
import './globe.css';
import { GlobeController } from './map';
import Timeline from './Timeline';
import TopicList from './TopicList';
import TopicPreview from './TopicPreview';
import type { GlobeData, GlobeTopic, PolityHover } from './types';

const PLAY_INTERVAL_MS = 2800;

/** The era with the most topics — a sensible place to open the globe. */
function busiestIndex({ snapshots, topics }: GlobeData): number {
  let best = snapshots.length - 1;
  let bestCount = -1;
  snapshots.forEach((_, i) => {
    const count = topics.filter((t) => topicInEra(t, snapshots, i)).length;
    if (count >= bestCount) {
      best = i;
      bestCount = count;
    }
  });
  return best;
}

function readInitialState(data: GlobeData) {
  const q = new URLSearchParams(window.location.search);
  const topic = data.topics.find((t) => t.slug === q.get('topic')) ?? null;
  const year = Number(q.get('year'));
  const index = year
    ? indexOfYear(data.snapshots, year)
    : topic
      ? indexOfYear(data.snapshots, topic.snapshot)
      : busiestIndex(data);
  return { index, topic };
}

function centerOf(topics: GlobeTopic[]): [number, number] {
  if (!topics.length) return [15, 30];
  const lng = topics.reduce((s, t) => s + t.lng, 0) / topics.length;
  const lat = topics.reduce((s, t) => s + t.lat, 0) / topics.length;
  return [lng, Math.max(-30, Math.min(45, lat))];
}

export default function GlobeExplorer(data: GlobeData) {
  const { topics, snapshots } = data;
  const initial = useMemo(() => readInitialState(data), []);

  const mapEl = useRef<HTMLDivElement>(null);
  const ctrl = useRef<GlobeController | null>(null);

  const [index, setIndex] = useState(initial.index);
  const [selected, setSelected] = useState<GlobeTopic | null>(initial.topic);
  const [hovered, setHovered] = useState<GlobeTopic | null>(null);
  const [polity, setPolity] = useState<PolityHover | null>(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [eraOpen, setEraOpen] = useState(() => window.matchMedia('(min-width: 720px)').matches);

  const snapshot = snapshots[index];
  const inEra = useMemo(() => topics.filter((t) => topicInEra(t, snapshots, index)), [topics, snapshots, index]);
  const others = useMemo(() => topics.filter((t) => !topicInEra(t, snapshots, index)), [topics, snapshots, index]);
  const activeSet = useMemo(() => new Set(inEra.map((t) => t.slug)), [inEra]);

  // Controller callbacks read the latest state through this ref.
  const live = useRef({ activeSet });
  live.current = { activeSet };

  const goToTopic = (topic: GlobeTopic) => {
    setPlaying(false);
    setSelected(topic);
    setIndex(indexOfYear(snapshots, topic.snapshot));
    ctrl.current?.flyTo(topic);
  };

  // Mount MapLibre once.
  useEffect(() => {
    const c = new GlobeController(
      mapEl.current!,
      {
        onPinEnter: (t) => setHovered(t),
        onPinLeave: (t) => setHovered((h) => (h?.slug === t.slug ? null : h)),
        onPinClick: (t, e) => {
          // A lit pin is a link to its notes; a dim pin (other era) moves the
          // timeline to that topic's era instead.
          if (live.current.activeSet.has(t.slug)) return;
          e.preventDefault();
          goToTopic(t);
        },
        onPolityHover: setPolity,
        onLoadingChange: setLoading,
      },
      initial.topic ? [initial.topic.lng, initial.topic.lat] : centerOf(inEra),
    );
    ctrl.current = c;
    if (import.meta.env.DEV) (window as unknown as { __globe: GlobeController }).__globe = c;
    c.setTopics(topics);
    c.whenReady().then(() => setReady(true));
    if (initial.topic) c.flyTo(initial.topic);
    else c.startSpin();
    return () => {
      ctrl.current = null;
      c.destroy();
    };
  }, []);

  // Load borders for the current snapshot; warm the neighbours.
  useEffect(() => {
    const c = ctrl.current;
    if (!c) return;
    c.setSnapshot(snapshot.year);
    c.prefetch([snapshots[index + 1]?.year, snapshots[index - 1]?.year].filter(Boolean) as number[]);
  }, [snapshot.year]);

  useEffect(() => {
    ctrl.current?.updatePins(
      { active: activeSet, selected: selected?.slug ?? null, hovered: hovered?.slug ?? null },
      topics,
    );
  }, [activeSet, selected, hovered, topics]);

  // Mirror state in the URL.
  useEffect(() => {
    const q = new URLSearchParams({ year: String(snapshot.year) });
    if (selected) q.set('topic', selected.slug);
    window.history.replaceState(null, '', `${window.location.pathname}?${q}`);
  }, [snapshot.year, selected]);

  // Play through time.
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      setIndex((i) => {
        if (i >= snapshots.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, PLAY_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [playing, snapshots.length]);

  // Escape closes whatever is open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setListOpen(false);
      setInfoOpen(false);
      setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const changeIndex = (i: number) => {
    setIndex(i);
    if (selected && !topicInEra(selected, snapshots, i)) setSelected(null);
  };

  const togglePlay = () => {
    if (!playing && index >= snapshots.length - 1) setIndex(0);
    setSelected(null);
    setPlaying((p) => !p);
  };

  const preview = hovered ?? selected;

  return (
    <div className="gx" data-ready={ready || undefined}>
      <h1 className="visually-hidden">IB History globe</h1>
      <div className="gx-stars" aria-hidden="true" />
      <div className="gx-map" ref={mapEl} />

      {!ready && (
        <div className="gx-boot" role="status">
          <span className="gx-spinner" aria-hidden="true" />
          Loading the globe…
        </div>
      )}
      {ready && loading && (
        <div className="gx-loading" role="status">
          Loading {snapshot.year} borders…
        </div>
      )}

      <EraPanel
        snapshot={snapshot}
        topicCount={inEra.length}
        open={eraOpen}
        onToggle={() => setEraOpen((o) => !o)}
        onShowTopics={() => setListOpen(true)}
      />

      <div className="gx-tools" role="toolbar" aria-label="Globe controls">
        <button type="button" className="gx-tool" onClick={() => setListOpen((o) => !o)} aria-expanded={listOpen} aria-label="Topic list">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" className="gx-tool" onClick={() => ctrl.current?.zoomBy(0.8)} aria-label="Zoom in">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" className="gx-tool" onClick={() => ctrl.current?.zoomBy(-0.8)} aria-label="Zoom out">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          </svg>
        </button>
        <button type="button" className="gx-tool" onClick={() => ctrl.current?.resetView()} aria-label="Show the whole globe">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M4 12h16M12 4c2.5 2.2 3.5 5 3.5 8s-1 5.8-3.5 8c-2.5-2.2-3.5-5-3.5-8s1-5.8 3.5-8Z" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <button type="button" className="gx-tool" onClick={() => setInfoOpen((o) => !o)} aria-expanded={infoOpen} aria-label="About this map">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.8" />
            <path d="M12 11v6M12 7.5v.01" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {infoOpen && (
        <aside className="gx-panel gx-info" aria-label="About this map">
          <h2>Reading the map</h2>
          <ul>
            <li>
              <span className="gx-key gx-key--pin" /> A lit pin is an IB topic in this era — click it to open the notes.
            </li>
            <li>
              <span className="gx-key gx-key--dim" /> A faint pin belongs to another era — click it to travel there.
            </li>
            <li>
              <span className="gx-key gx-key--fill" /> Territories are coloured by the power that controlled them, so colonies
              share their empire's colour.
            </li>
            <li>
              <span className="gx-key gx-key--dash" /> Dashed borders are approximate.
            </li>
          </ul>
          <p className="gx-info__credit">
            Borders:{' '}
            <a href="https://github.com/aourednik/historical-basemaps" target="_blank" rel="noreferrer">
              historical-basemaps
            </a>{' '}
            (GPL-3.0), simplified — approximate, especially before 1800. Land:{' '}
            <a href="https://www.naturalearthdata.com/" target="_blank" rel="noreferrer">
              Natural Earth
            </a>
            . Rendering: MapLibre GL.
          </p>
          <button type="button" className="gx-btn" onClick={() => setInfoOpen(false)}>
            Close
          </button>
        </aside>
      )}

      {listOpen && (
        <TopicList
          year={snapshot.year}
          inEra={inEra}
          others={others}
          selected={selected?.slug ?? null}
          onSelect={(t) => {
            goToTopic(t);
            if (window.matchMedia('(max-width: 719px)').matches) setListOpen(false);
          }}
          onHover={setHovered}
          onClose={() => setListOpen(false)}
        />
      )}

      {preview && (
        <TopicPreview
          key={preview.slug}
          topic={preview}
          inEra={activeSet.has(preview.slug)}
          onClose={preview === selected && !hovered ? () => setSelected(null) : undefined}
          onJump={goToTopic}
        />
      )}

      {polity && !hovered && (
        <div className="gx-polity" style={{ transform: `translate(${polity.x + 14}px, ${polity.y + 14}px)` }} aria-hidden="true">
          <strong>{polity.name}</strong>
          {polity.subjecto && polity.subjecto !== polity.name && <span>Controlled by {polity.subjecto}</span>}
        </div>
      )}

      <Timeline
        snapshots={snapshots}
        index={index}
        onIndex={changeIndex}
        topics={topics}
        activeSet={activeSet}
        selected={selected?.slug ?? null}
        onSelectTopic={goToTopic}
        onHoverTopic={setHovered}
        playing={playing}
        onTogglePlay={togglePlay}
      />
    </div>
  );
}
