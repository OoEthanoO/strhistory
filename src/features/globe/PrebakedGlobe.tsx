import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { geoDistance, geoGraticule10, geoOrthographic, geoPath } from 'd3-geo';
import { feature } from 'topojson-client';
import landTopology from 'world-atlas/land-110m.json';
import { colorFor, LAND_BASE, OCEAN } from './palette';
import initialBorders from './baked/prebaked_1783.json';
import { pinOffsets } from './pin-layout';
import type { GlobeTopic } from './types';
import './prebaked.css';

export interface GlobeView { center: [number, number]; scale: number }
interface Props {
  topics: GlobeTopic[];
  center?: [number, number];
  scale?: number;
  className?: string;
  onViewChange?: (view: GlobeView) => void;
  onInteractionEnd?: (view: GlobeView) => void;
  pinHref?: (topic: GlobeTopic) => string;
  borderYear?: number | null;
}
const DEFAULT_CENTER: [number, number] = [15, 30];
const topology = landTopology as unknown as Parameters<typeof feature>[0];
const land = feature(topology, topology.objects.land);
const graticule = geoGraticule10();
const normalise = ({ center, scale }: GlobeView): GlobeView => ({
  center: [((center[0] + 540) % 360) - 180, Math.max(-80, Math.min(80, center[1]))],
  scale: Math.max(0.65, Math.min(6, scale)),
});

/** The first frame is baked into HTML; this same geometry remains draggable
 * while WebGL, detailed coastlines, historical borders and labels arrive. */
export default function PrebakedGlobe({ topics, center = DEFAULT_CENTER, scale = 1, className = '', onViewChange, onInteractionEnd, pinHref, borderYear = null }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number]>([800, 600]);
  const [view, setView] = useState<GlobeView>({ center, scale });
  const live = useRef(view);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const moved = useRef(false);
  const callbacks = useRef({ onViewChange, onInteractionEnd });
  callbacks.current = { onViewChange, onInteractionEnd };
  const wheelEnd = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const id = useId().replaceAll(':', '');
  useEffect(() => { const next = { center, scale }; live.current = next; setView(next); }, [center[0], center[1], scale]);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize([entry.contentRect.width, entry.contentRect.height]));
    if (root.current) observer.observe(root.current);
    const element = root.current;
    const wheel = (event: WheelEvent) => {
      event.preventDefault();
      const next = normalise({ ...live.current, scale: live.current.scale * Math.exp(-event.deltaY * 0.001) });
      live.current = next; setView(next); callbacks.current.onViewChange?.(next);
      clearTimeout(wheelEnd.current);
      wheelEnd.current = setTimeout(() => callbacks.current.onInteractionEnd?.(live.current), 180);
    };
    element?.addEventListener('wheel', wheel, { passive: false });
    return () => { observer.disconnect(); clearTimeout(wheelEnd.current); element?.removeEventListener('wheel', wheel); };
  }, []);
  const update = (next: GlobeView) => {
    const value = normalise(next);
    live.current = value;
    setView(value);
    onViewChange?.(value);
  };
  const [width, height] = size;
  const radius = Math.min(width, height) * 0.45 * view.scale;
  const projection = useMemo(() => geoOrthographic().translate([width / 2, height / 2]).scale(radius).rotate([-view.center[0], -view.center[1]]).precision(0.6), [width, height, radius, view.center]);
  const path = geoPath(projection).digits(1);
  const pins = topics.filter(t => geoDistance([t.lng, t.lat], view.center) < Math.PI / 2 - 0.03);
  const offsets = pinOffsets(pins.map(t => { const [x, y] = projection([t.lng, t.lat]) ?? [0, 0]; return { id: t.slug, x, y }; }));
  return <div ref={root} className={`prebaked-globe ${className}`}>
    <svg viewBox={`0 0 ${width} ${height}`} role="group" aria-label="Interactive history globe. Drag to rotate; use arrow keys to rotate and plus or minus to zoom." tabIndex={0}
      onPointerDown={e => {
        if (e.button !== 0) return;
        if (!pointers.current.size) moved.current = false;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (!(e.target as Element).closest('a')) e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={e => {
        const previous = pointers.current.get(e.pointerId);
        if (!previous) return;
        const before = [...pointers.current.values()];
        const dx = e.clientX - previous.x, dy = e.clientY - previous.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) moved.current = true;
        pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (pointers.current.size >= 2) {
          const after = [...pointers.current.values()];
          const oldDistance = Math.hypot(before[0].x - before[1].x, before[0].y - before[1].y);
          const newDistance = Math.hypot(after[0].x - after[1].x, after[0].y - after[1].y);
          if (oldDistance > 0) update({ ...live.current, scale: live.current.scale * newDistance / oldDistance });
        } else update({ ...live.current, center: [live.current.center[0] - dx * 90 / radius, live.current.center[1] + dy * 90 / radius] });
      }}
      onPointerUp={e => {
        if (!pointers.current.has(e.pointerId)) return;
        pointers.current.delete(e.pointerId);
        if (pointers.current.size) return;
        if (!(e.target as Element).closest('a') || moved.current) onInteractionEnd?.(live.current);
      }}
      onPointerCancel={e => { pointers.current.delete(e.pointerId); }}
      onClickCapture={e => { if (moved.current) { e.preventDefault(); moved.current = false; } }}
      onKeyDown={e => {
        if (e.target !== e.currentTarget) return;
        const [lng, lat] = live.current.center;
        const changes: Record<string, GlobeView> = {
          ArrowLeft: { ...live.current, center: [lng - 10, lat] }, ArrowRight: { ...live.current, center: [lng + 10, lat] },
          ArrowUp: { ...live.current, center: [lng, lat + 10] }, ArrowDown: { ...live.current, center: [lng, lat - 10] },
          '+': { ...live.current, scale: live.current.scale * 1.2 }, '=': { ...live.current, scale: live.current.scale * 1.2 },
          '-': { ...live.current, scale: live.current.scale / 1.2 }, Home: { center: DEFAULT_CENTER, scale: 1 },
        };
        if (changes[e.key]) { e.preventDefault(); update(changes[e.key]); }
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onInteractionEnd?.(live.current); }
      }}
      onKeyUp={e => { if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', 'Home'].includes(e.key)) onInteractionEnd?.(live.current); }}>
      <defs><radialGradient id={`${id}-halo`}><stop offset="80%" stopColor="#6f9bd8" stopOpacity="0.16" /><stop offset="100%" stopColor="#6f9bd8" stopOpacity="0" /></radialGradient></defs>
      <circle cx={width / 2} cy={height / 2} r={radius * 1.08} fill={`url(#${id}-halo)`} />
      <circle cx={width / 2} cy={height / 2} r={radius} fill={OCEAN} />
      <path d={path(graticule) ?? ''} fill="none" stroke="#a9c1e0" strokeOpacity="0.1" strokeWidth="0.6" />
      <path d={path(land as never) ?? ''} fill={LAND_BASE} />
      {borderYear === 1783 && initialBorders.features.map((f, i) => <path key={i} d={path(f as never) ?? ''} fill={colorFor(f.properties?.subjecto ?? f.properties?.name)} fillOpacity="0.88" stroke={OCEAN} strokeWidth="0.5" />)}
      <circle cx={width / 2} cy={height / 2} r={radius} fill="none" stroke="#a9c1e0" strokeOpacity="0.2" />
      {pins.map(t => {
        const point = projection([t.lng, t.lat]);
        if (!point) return null;
        const [dx, dy] = offsets.get(t.slug) ?? [0, 0];
        return <a key={t.slug} href={pinHref?.(t) ?? t.href} aria-label={`${t.title}, ${t.place} — ${pinHref ? 'explore the globe' : 'open notes'}`}>
          <g transform={`translate(${point[0] + dx} ${point[1] + dy})`} className="prebaked-pin">
            {(dx !== 0 || dy !== 0) && <line x1="0" y1="0" x2={-dx} y2={-dy} stroke="#f2b35b" strokeOpacity="0.7" />}
            <circle r="13" fill="transparent" /><circle r="7" fill="#f2b35b" fillOpacity="0.2" /><circle r="4" fill="#f2b35b" stroke={OCEAN} strokeWidth="1.5" />
            <title>{t.title}</title>
          </g>
        </a>;
      })}
    </svg>
  </div>;
}
