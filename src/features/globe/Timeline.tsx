import { useEffect, useMemo, useRef, useState } from 'react';
import { clampYear, FIRST_YEAR, formatYear, timelineX, yearAtTimelineX } from './era';
import type { GlobeSnapshot } from './types';

interface Props {
  snapshots: GlobeSnapshot[];
  year: number;
  currentYear: number;
  onYear(year: number): void;
  playing: boolean;
  onTogglePlay(): void;
}

/** Exploration stops and an exact year field: neither depends on course notes. */
export default function Timeline({ snapshots, year, currentYear, onYear, playing, onTogglePlay }: Props) {
  const years = useMemo(() => [...new Set([FIRST_YEAR, ...snapshots.map((s) => s.year), currentYear])].sort((a, b) => a - b), [snapshots, currentYear]);
  const [input, setInput] = useState(String(year));
  const scaleRef = useRef<HTMLDivElement>(null);
  const [scaleWidth, setScaleWidth] = useState(320);
  useEffect(() => {
    const element = scaleRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setScaleWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => setInput(String(year)), [year]);
  const previous = [...years].reverse().find((value) => value < year);
  const next = years.find((value) => value > year);
  const nextIndex = years.findIndex((value) => value > year);
  const intervalIndex = nextIndex === -1 ? years.length - 2 : Math.max(0, nextIndex - 1);
  const start = years[intervalIndex];
  const end = years[intervalIndex + 1];
  const span = end - start - (start < 0 && end > 0 ? 1 : 0);
  const labelStep = Math.max(1, Math.ceil((years.length - 1) * 100 / scaleWidth));
  const scaleYear = (value: number) => `${Math.abs(value).toLocaleString('en-GB', { useGrouping: Math.abs(value) >= 10000 })}${value < 0 ? ' BCE' : ' CE'}`;
  return (
    <section className="tl" aria-label="Explore the timeline">
      <div className="tl__top">
        <div className="tl__controls">
          <button className="tl__btn" type="button" disabled={previous === undefined} aria-label="Previous historical snapshot" onClick={() => previous !== undefined && onYear(previous)}>‹</button>
          <button className="tl__btn tl__btn--play" type="button" aria-label={playing ? 'Pause timeline' : 'Play through snapshots'} onClick={onTogglePlay}>{playing ? 'Ⅱ' : '▶'}</button>
          <button className="tl__btn" type="button" disabled={next === undefined} aria-label="Next historical snapshot" onClick={() => next !== undefined && onYear(next)}>›</button>
        </div>
        <form className="tl__jump" onSubmit={(event) => { event.preventDefault(); const value = Number(input); if (input.trim() && Number.isFinite(value)) { const valid = clampYear(value, currentYear); setInput(String(valid)); onYear(valid); } }}>
          <label htmlFor="globe-year">Year <span>(− = BCE)</span></label>
          <input id="globe-year" type="number" min={FIRST_YEAR} max={currentYear} step="1" value={input} onChange={(event) => setInput(event.target.value)} />
          <button type="submit">Go</button>
        </form>
        <label className="tl__snapshot">Snapshot
          <select aria-label="Choose a historical snapshot" value={years.includes(year) ? year : ''} onChange={(event) => onYear(Number(event.target.value))}>
            {!years.includes(year) && <option value="">{formatYear(year)} · between snapshots</option>}
            {years.map((value) => <option value={value} key={value}>{formatYear(value)}{value === currentYear ? ' · today' : ''}</option>)}
          </select>
        </label>
      </div>
      <div className="tl__scale" ref={scaleRef}>
        <input className="tl__range" type="range" min="0" max="10000" step="1" value={Math.round(timelineX(years, year) * 10000)} aria-label="Historical year" aria-valuetext={scaleYear(year)} aria-describedby="timeline-scale-help timeline-interval" onChange={(event) => onYear(yearAtTimelineX(years, Number(event.target.value) / 10000))} onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); onYear(year === 1 ? -1 : year - 1); }
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); onYear(year === -1 ? 1 : year + 1); }
          if (event.key === 'PageDown') { event.preventDefault(); if (previous !== undefined) onYear(previous); }
          if (event.key === 'PageUp') { event.preventDefault(); if (next !== undefined) onYear(next); }
        }} />
        <div className="tl__ruler" aria-hidden="true">
          <span className="tl__interval" style={{ left: `${timelineX(years, start) * 100}%`, width: `${100 / (years.length - 1)}%` }} />
          {years.map((value, index) => {
            const labelled = index === 0 || index === years.length - 1 || (index % labelStep === 0 && years.length - 1 - index >= labelStep);
            return <span key={value} className="tl__tick" data-labelled={labelled || undefined} data-edge={index === 0 ? 'first' : index === years.length - 1 ? 'last' : undefined} style={{ left: `${timelineX(years, value) * 100}%` }}>
              {labelled && <span>{scaleYear(value)}</span>}
            </span>;
          })}
        </div>
        <div className="tl__detail" id="timeline-interval"><strong>{scaleYear(start)} – {scaleYear(end)}</strong></div>
      </div>
    </section>
  );
}
