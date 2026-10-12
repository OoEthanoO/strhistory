import { useEffect, useId, useRef, useState } from 'react';
import { geoMercator } from 'd3-geo';
import type { Coordinates, MapArtwork } from './types';

const width = 960, height = 500;
const projection = geoMercator().scale(150).translate([480, 250]);
const cities: [string, number, number][] = [
  ['London', -0.12, 51.51], ['Paris', 2.35, 48.86], ['Versailles', 2.12, 48.8], ['Berlin', 13.4, 52.52],
  ['Rome', 12.5, 41.9], ['Turin', 7.68, 45.07], ['Frankfurt', 8.68, 50.11], ['Vienna', 16.37, 48.21],
  ['Moscow', 37.62, 55.75], ['St Petersburg', 30.31, 59.94], ['Madrid', -3.7, 40.42], ['Warsaw', 21.01, 52.23],
  ['Athens', 23.73, 37.98], ['Istanbul', 28.98, 41.01], ['Cairo', 31.24, 30.04], ['Delhi', 77.21, 28.61],
  ['Beijing', 116.4, 39.9], ['Tokyo', 139.69, 35.69], ['Kyoto', 135.77, 35.01], ['Shanghai', 121.47, 31.23],
  ['Seoul', 126.98, 37.57], ['Singapore', 103.82, 1.35], ['Cape Town', 18.42, -33.93], ['Nairobi', 36.82, -1.29],
  ['New York', -74.01, 40.71], ['Washington', -77.04, 38.91], ['Mexico City', -99.13, 19.43],
  ['Havana', -82.37, 23.11], ['Rio de Janeiro', -43.17, -22.91], ['Buenos Aires', -58.38, -34.6], ['Sydney', 151.21, -33.87],
];
type View = { x: number; y: number; k: number };
const bounded = ({ x, y, k }: View): View => ({ k, x: Math.max(width * (1 - k), Math.min(0, x)), y: Math.max(height * (1 - k), Math.min(0, y)) });

interface Props { artwork: MapArtwork; value: Coordinates | null; onChange: (value: Coordinates) => void; answer?: Coordinates }
export default function GuessMap({ artwork, value, onChange, answer }: Props) {
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const svg = useRef<SVGSVGElement>(null);
  const [screenScale, setScreenScale] = useState(1);
  const drag = useRef<{ x: number; y: number; view: View; moved: boolean } | null>(null);
  const id = useId();
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    // Keep pins and labels legible in CSS pixels as the responsive SVG shrinks.
    const resize = new ResizeObserver(([entry]) => {
      if (entry && entry.contentRect.width > 0) setScreenScale(width / entry.contentRect.width);
    });
    resize.observe(element);
    return () => resize.disconnect();
  }, []);
  function point(clientX: number, clientY: number) {
    const matrix = svg.current?.getScreenCTM();
    return matrix ? new DOMPoint(clientX, clientY).matrixTransform(matrix.inverse()) : null;
  }
  function zoom(factor: number) {
    setView(old => {
      const k = Math.max(1, Math.min(64, old.k * factor));
      return bounded({ k, x: width / 2 - (width / 2 - old.x) * k / old.k, y: height / 2 - (height / 2 - old.y) * k / old.k });
    });
  }
  function region(lng: number, lat: number, k: number) {
    const xy = projection([lng, lat])!;
    setView(bounded({ k, x: width / 2 - xy[0] * k, y: height / 2 - xy[1] * k }));
  }
  const pin = value ? projection([value.lng, value.lat]) : null;
  const actual = answer ? projection([answer.lng, answer.lat]) : null;
  return <div className="guess-map">
    <div className="map-toolbar"><span>Find the place</span><div>
      <button type="button" onClick={() => region(0, 0, 1)}>World</button>
      <button type="button" onClick={() => region(12, 49, 7)}>Europe</button>
      <button type="button" onClick={() => region(128, 36, 5)}>East Asia</button>
    </div></div>
    <svg ref={svg} className="guess-map-canvas" viewBox={`0 0 ${width} ${height}`} role="group" tabIndex={0}
      aria-label="Location map" aria-describedby={`${id}-help`}
      onKeyDown={event => {
        if (['+', '='].includes(event.key)) { event.preventDefault(); zoom(1.5); }
        if (event.key === '-') { event.preventDefault(); zoom(1 / 1.5); }
        if (!answer && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) {
          event.preventDefault();
          const centre = projection.invert!([(width / 2 - view.x) / view.k, (height / 2 - view.y) / view.k])!;
          const old = value ?? { lat: centre[1], lng: centre[0] }, step = event.shiftKey ? 0.1 : 1;
          onChange({ lat: Number(Math.max(-85, Math.min(85, old.lat + (event.key === 'ArrowUp' ? step : event.key === 'ArrowDown' ? -step : 0))).toFixed(4)), lng: Number((((old.lng + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0) + 540) % 360) - 180).toFixed(4)) });
        }
      }}
      onPointerDown={event => {
        if (event.button !== 0) return;
        const p = point(event.clientX, event.clientY);
        if (p) { drag.current = { x: p.x, y: p.y, view, moved: false }; event.currentTarget.setPointerCapture(event.pointerId); }
      }}
      onPointerMove={event => {
        const start = drag.current, p = point(event.clientX, event.clientY);
        if (!start || !p) return;
        if (Math.hypot(p.x - start.x, p.y - start.y) > 5) start.moved = true;
        if (start.moved) setView(bounded({ ...start.view, x: start.view.x + p.x - start.x, y: start.view.y + p.y - start.y }));
      }}
      onPointerCancel={() => { drag.current = null; }}
      onPointerUp={event => {
        const start = drag.current, p = point(event.clientX, event.clientY);
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (!start || start.moved || !p || answer) return;
        const coordinate = projection.invert!([(p.x - view.x) / view.k, (p.y - view.y) / view.k]);
        if (coordinate && Math.abs(coordinate[1]) <= 85) onChange({ lng: Number(coordinate[0].toFixed(4)), lat: Number(coordinate[1].toFixed(4)) });
      }}>
      <title>World coastline map. Select a location with the pointer or arrow keys.</title>
      <defs><clipPath id={`${id}-clip`}><rect width={width} height={height} /></clipPath></defs>
      <g clipPath={`url(#${id}-clip)`}><g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
        <path className="map-grid" d={artwork.grid} vectorEffect="non-scaling-stroke" />
        <path className="map-land" d={artwork.land} vectorEffect="non-scaling-stroke" />
        {view.k >= 4 && cities.filter(([name]) => view.k >= 12 || name !== 'Versailles').map(([name, lng, lat]) => {
          const p = projection([lng, lat])!;
          return <g key={name} transform={`translate(${p[0]},${p[1]}) scale(${screenScale / view.k})`} className="map-city" aria-hidden="true"><circle r="2.5" /><text x="6" y="-5">{name}</text></g>;
        })}
        {pin && actual && Math.abs(pin[0] - actual[0]) < width / 2 && <line className="map-distance" x1={pin[0]} y1={pin[1]} x2={actual[0]} y2={actual[1]} vectorEffect="non-scaling-stroke" />}
        {pin && <g className="map-pin" transform={`translate(${pin[0]},${pin[1]}) scale(${screenScale / view.k})`}><circle r="8" /><path d="M-14 0H14M0-14V14" /><title>Your guess</title></g>}
        {actual && <g className="map-answer" transform={`translate(${actual[0]},${actual[1]}) scale(${screenScale / view.k})`}><path d="M0-11 11 0 0 11-11 0Z" /><title>Actual location</title></g>}
      </g></g>
    </svg>
    <div className="map-bottom"><p id={`${id}-help`}>Tap to pin · drag to pan · arrows move pin (Shift: fine adjustment).</p><div className="map-zoom"><button type="button" aria-label="Zoom in on location map" disabled={view.k === 64} onClick={() => zoom(2)}>+</button><button type="button" aria-label="Zoom out of location map" disabled={view.k === 1} onClick={() => zoom(0.5)}>−</button></div></div>
    {answer && <p className="map-legend"><span>⊕ Your guess</span><span>◇ Actual event</span></p>}
    {!answer && <details className="map-coordinates"><summary>Enter coordinates instead</summary><div className="game-fields">
      <label>Latitude<input type="number" min="-85" max="85" step="0.0001" value={value?.lat ?? ''} onChange={event => { const lat = event.target.valueAsNumber; if (Number.isFinite(lat) && Math.abs(lat) <= 85) onChange({ lat, lng: value?.lng ?? 0 }); }} /></label>
      <label>Longitude<input type="number" min="-180" max="180" step="0.0001" value={value?.lng ?? ''} onChange={event => { const lng = event.target.valueAsNumber; if (Number.isFinite(lng) && Math.abs(lng) <= 180) onChange({ lng, lat: value?.lat ?? 0 }); }} /></label>
    </div></details>}
    <p className="game-help">{value ? `Pin: ${value.lat.toFixed(3)}°, ${value.lng.toFixed(3)}°. ` : 'No pin placed yet. '}Modern coastlines: Natural Earth / world-atlas (public domain). Full place points within 10 km.</p>
  </div>;
}
