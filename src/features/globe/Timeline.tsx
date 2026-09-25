import { useEffect, useMemo, useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { formatRange, packLanes, timelineX } from './era';
import type { GlobeSnapshot, GlobeTopic } from './types';

interface Props {
  snapshots: GlobeSnapshot[];
  index: number;
  onIndex(index: number): void;
  topics: GlobeTopic[];
  activeSet: Set<string>;
  selected: string | null;
  onSelectTopic(topic: GlobeTopic): void;
  onHoverTopic(topic: GlobeTopic | null): void;
  playing: boolean;
  onTogglePlay(): void;
}

const LANE_H = 7;

/**
 * Bottom timeline: snapshot ticks (evenly spaced), the current era shaded, and
 * each topic's date range drawn as a bar above the track.
 */
export default function Timeline({
  snapshots,
  index,
  onIndex,
  topics,
  activeSet,
  selected,
  onSelectTopic,
  onHoverTopic,
  playing,
  onTogglePlay,
}: Props) {
  const years = useMemo(() => snapshots.map((s) => s.year), [snapshots]);
  const n = snapshots.length;
  const trackRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const tickX = (i: number) => (n > 1 ? i / (n - 1) : 0);

  const bars = useMemo(() => {
    const spans = topics.map((t): [number, number] => [timelineX(years, t.start), timelineX(years, t.end + 1)]);
    const lanes = packLanes(spans);
    return topics.map((t, i) => ({ topic: t, x0: spans[i][0], x1: spans[i][1], lane: lanes[i] }));
  }, [topics, years]);
  const laneCount = Math.max(1, ...bars.map((b) => b.lane + 1));

  const clamp = (i: number) => Math.max(0, Math.min(n - 1, i));

  const indexAt = (clientX: number) => {
    const rect = trackRef.current!.getBoundingClientRect();
    return clamp(Math.round(((clientX - rect.left) / rect.width) * (n - 1)));
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    onIndex(indexAt(e.clientX));
  };
  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!e.currentTarget.hasPointerCapture(e.pointerId)) return;
    const i = indexAt(e.clientX);
    if (i !== index) onIndex(i);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const moves: Record<string, number> = {
      ArrowLeft: index - 1,
      ArrowDown: index - 1,
      ArrowRight: index + 1,
      ArrowUp: index + 1,
      PageDown: index - 3,
      PageUp: index + 3,
      Home: 0,
      End: n - 1,
    };
    if (e.key in moves) {
      e.preventDefault();
      onIndex(clamp(moves[e.key]));
    }
  };

  // Keep the current year in view when the timeline scrolls (narrow screens).
  useEffect(() => {
    const scroller = scrollerRef.current;
    const tick = scroller?.querySelector<HTMLElement>('.tl__tick.is-current');
    if (!scroller || !tick || scroller.scrollWidth <= scroller.clientWidth) return;
    const target = tick.offsetLeft - scroller.clientWidth / 2;
    scroller.scrollTo({ left: target, behavior: 'smooth' });
  }, [index]);

  const current = snapshots[index];

  return (
    <div className="tl" role="group" aria-label="Timeline">
      <div className="tl__controls">
        <button
          type="button"
          className="tl__btn"
          onClick={() => onIndex(clamp(index - 1))}
          disabled={index === 0}
          aria-label="Earlier snapshot"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="M14.5 6 8.5 12l6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
        <button
          type="button"
          className="tl__btn tl__btn--play"
          onClick={onTogglePlay}
          aria-label={playing ? 'Pause' : 'Play through time'}
          aria-pressed={playing}
        >
          {playing ? (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M8 6v12M16 6v12" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <path d="M8 5.5v13l10.5-6.5L8 5.5Z" fill="currentColor" />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="tl__btn"
          onClick={() => onIndex(clamp(index + 1))}
          disabled={index === n - 1}
          aria-label="Later snapshot"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path d="m9.5 6 6 6-6 6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      <div className="tl__scroller" ref={scrollerRef}>
        <div className="tl__inner" style={{ minWidth: `${n * 54}px` }}>
          <div className="tl__lanes" style={{ height: `${laneCount * LANE_H}px` }}>
            {bars.map(({ topic, x0, x1, lane }) => (
              <button
                key={topic.slug}
                type="button"
                className="tl__bar"
                data-active={activeSet.has(topic.slug) || undefined}
                data-selected={selected === topic.slug || undefined}
                style={{
                  left: `${x0 * 100}%`,
                  width: `max(8px, ${(x1 - x0) * 100}%)`,
                  top: `${lane * LANE_H}px`,
                }}
                title={`${topic.title} (${formatRange(topic.start, topic.end)})`}
                aria-label={`${topic.title}, ${formatRange(topic.start, topic.end)}`}
                onClick={() => onSelectTopic(topic)}
                onMouseEnter={() => onHoverTopic(topic)}
                onMouseLeave={() => onHoverTopic(null)}
                tabIndex={-1}
              />
            ))}
          </div>

          <div
            ref={trackRef}
            className="tl__track"
            role="slider"
            tabIndex={0}
            aria-label="Snapshot year"
            aria-valuemin={years[0]}
            aria-valuemax={years[n - 1]}
            aria-valuenow={current.year}
            aria-valuetext={`${current.year}: ${current.title}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onKeyDown={onKeyDown}
          >
            <div className="tl__rail" />
            <div
              className="tl__era"
              style={{
                left: `${tickX(index) * 100}%`,
                width: `${(index < n - 1 ? tickX(index + 1) - tickX(index) : 0) * 100}%`,
              }}
            />
            {snapshots.map((s, i) => (
              <div
                key={s.year}
                className={`tl__tick${i === index ? ' is-current' : ''}`}
                style={{ left: `${tickX(i) * 100}%` }}
              >
                <span className="tl__year">{s.year}</span>
              </div>
            ))}
            <div className="tl__thumb" style={{ left: `${tickX(index) * 100}%` }} />
          </div>
        </div>
      </div>
    </div>
  );
}
