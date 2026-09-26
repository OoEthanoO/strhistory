import { useEffect, useMemo, useState } from 'react';
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
  useEffect(() => setInput(String(year)), [year]);
  const previous = [...years].reverse().find((value) => value < year);
  const next = years.find((value) => value > year);
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
      <div className="tl__scale">
        <input className="tl__range" type="range" min="0" max="10000" step="1" value={Math.round(timelineX(years, year) * 10000)} aria-label="Historical year" aria-valuetext={formatYear(year)} onChange={(event) => onYear(yearAtTimelineX(years, Number(event.target.value) / 10000))} onKeyDown={(event) => {
          if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') { event.preventDefault(); onYear(year === 1 ? -1 : year - 1); }
          if (event.key === 'ArrowRight' || event.key === 'ArrowUp') { event.preventDefault(); onYear(year === -1 ? 1 : year + 1); }
          if (event.key === 'PageDown') { event.preventDefault(); if (previous !== undefined) onYear(previous); }
          if (event.key === 'PageUp') { event.preventDefault(); if (next !== undefined) onYear(next); }
        }} />
        <div className="tl__labels" aria-hidden="true"><span>300,000 BCE</span><span>Explore human history · uneven time scale</span><span>{currentYear}</span></div>
      </div>
    </section>
  );
}
