import { useEffect, useRef, useState } from 'react';
import PrebakedGlobe, { type GlobeView } from './PrebakedGlobe';
import type { GlobeController } from './map';
import type { GlobeData } from './types';
import './home-globe.css';

const START: GlobeView = { center: [15, 30], scale: 1 };
export default function HomeGlobe({ topics }: GlobeData) {
  const container = useRef<HTMLDivElement>(null);
  const controller = useRef<GlobeController | null>(null);
  const view = useRef<GlobeView>(START);
  const [mapReady, setMapReady] = useState(false);
  const [borderYear, setBorderYear] = useState<number | null>(null);
  const [level, setLevel] = useState('HL');
  const levelRef = useRef(level);
  levelRef.current = level;
  const [handoffHref, setHandoffHref] = useState('/globe?year=1789&level=HL');
  const ready = mapReady && borderYear === 1783;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pointers = useRef(new Set<number>());
  const navigating = useRef(false);
  const mapFailed = useRef(false);
  const current = topics.filter(t => t.curriculum === '2028' && (level === 'HL' || t.level !== 'HL') && t.start <= 1789 && t.end >= 1789);
  const href = () => {
    const q = new URLSearchParams({ year: '1789', level: levelRef.current, lng: view.current.center[0].toFixed(3), lat: view.current.center[1].toFixed(3), scale: view.current.scale.toFixed(3) });
    return `/globe?${q}`;
  };
  const enter = () => {
    if (navigating.current) return;
    navigating.current = true;
    window.location.assign(href());
  };
  useEffect(() => {
    try { setLevel(localStorage.getItem('history-level') === 'SL' ? 'SL' : 'HL'); } catch {}
    let disposed = false;
    import('./map').then(({ GlobeController }) => {
      if (disposed || !container.current) return;
      const c = new GlobeController(container.current, {
        onPinEnter: () => {}, onPinLeave: () => {},
        onPinClick: (_topic, event) => { event.preventDefault(); enter(); },
        onPolityHover: () => {}, onLoadingChange: () => {},
        onViewChange: next => { view.current = next; setHandoffHref(href()); },
        onInteractionEnd: next => { view.current = next; enter(); },
        onSnapshotChange: setBorderYear,
        onFailure: () => { mapFailed.current = true; setMapReady(false); },
      }, view.current.center, { compact: true });
      controller.current = c;
      c.setSnapshot(1783);
      c.whenReady().then(() => { if (!disposed && !mapFailed.current) { c.setView(view.current.center, view.current.scale); setMapReady(true); } });
    }).catch(() => {});
    // MapLibre listens for document mouseup: a drag can finish outside the card.
    const release = (event: PointerEvent) => {
      if (!pointers.current.delete(event.pointerId) || pointers.current.size) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => { if (controller.current) view.current = controller.current.getView(); enter(); }, 60);
    };
    const cancel = (event: PointerEvent) => { pointers.current.delete(event.pointerId); };
    document.addEventListener('pointerup', release);
    document.addEventListener('pointercancel', cancel);
    return () => { disposed = true; clearTimeout(timer.current); document.removeEventListener('pointerup', release); document.removeEventListener('pointercancel', cancel); controller.current?.destroy(); controller.current = null; };
  }, []);
  useEffect(() => { setHandoffHref(href()); }, [level]);
  useEffect(() => {
    const c = controller.current;
    if (!c || !ready) return;
    c.setTopics(current.map(topic => ({ ...topic, href: href() })));
    c.updatePins({ active: new Set(current.map(t => t.slug)), selected: null, hovered: null }, current);
  }, [ready, level]);
  const finishSoon = () => { clearTimeout(timer.current); timer.current = setTimeout(enter, 60); };
  return <div className="home-globe" data-ready={ready || undefined}>
    <div className="home-globe__caption"><span>THE WORLD IN</span><strong>1789</strong><span>Borders: 1783</span></div>
    <div className="home-globe__surface">
      {!ready && <PrebakedGlobe topics={current} borderYear={1783} onViewChange={next => { view.current = next; setHandoffHref(href()); controller.current?.setView(next.center, next.scale); }} onInteractionEnd={enter} pinHref={() => handoffHref} />}
      <div ref={container} className="home-globe__map" aria-hidden={!ready} inert={!ready}
        onPointerDownCapture={event => { if (event.button === 0) pointers.current.add(event.pointerId); }}
        onWheelCapture={() => { clearTimeout(timer.current); timer.current = setTimeout(enter, 220); }}
        onKeyUpCapture={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Enter', ' '].includes(e.key)) finishSoon(); }} />
    </div>
    <a href={handoffHref} className="home-globe__enter">Drag, zoom or click to explore <span aria-hidden="true">↗</span></a>
  </div>;
}
