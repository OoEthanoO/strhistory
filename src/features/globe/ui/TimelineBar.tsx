// The timeline bar along the bottom of the globe explorer: a React wrapper around the
// framework-free `Timeline` of @alexs-atlas/globe (packages/globe/src/timeline), set up
// as the bar the Alex's Atlas reference site uses — one-year back/forward buttons,
// play/pause, the typed-year field, a thick track with the selection's lifespan band and
// the 0.25×–2× speed menu (packages/globe/AGENTS.md §6.1).
//
// Ported from the Alex's Atlas reference site, apps/site/src/app.ts (onManifest, where
// the site creates its Timeline). Imported from '@alexs-atlas/globe/timeline', never
// from the package index, so the page's first load does not pull in MapLibre. The
// timeline's styles come with '@alexs-atlas/globe/style.css' (imported by the explorer).
//
// The Timeline is created once, in an effect (the server renders only the empty
// `.timeline-bar`), and re-created only if its scale changes (min, max, present or the
// stops); callbacks are read from a ref, so new callback props never re-create it.
// Later `value`, `frames` and `highlight` props are applied to the live instance.
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { Timeline } from '@alexs-atlas/globe/timeline';

export interface TimelineBarHandle {
  /** Moves the timeline without calling back (ignored while the user drags; seeks during playback). */
  setValue(y: number): void;
  togglePlay(): void;
  /** Stops playback (the timeline then commits the year reached with `onChange`). */
  pause(): void;
  isPlaying(): boolean;
  /** Jumps to the previous (−1) or next (+1) border change as the user would; null when there is none. */
  stepChange(d: 1 | -1): number | null;
  /** The `.timeline-bar` element (stable for the component's life; observe it for the bar's height). */
  readonly element: HTMLElement | null;
}

export interface TimelineBarProps {
  /** First and last year of the track (non-zero integers, min < max). */
  min: number;
  max: number;
  /** The year shown (applied to the timeline when it differs from the timeline's own value). */
  value: number;
  /** Present year (the last default scale stop). */
  present: number;
  /** Years in which borders change (`manifest.frames`): `[` and `]` jump between them. */
  frames: readonly number[] | null;
  /** Scale stops `[year, t][]` (piecewise-linear, strictly increasing). */
  stops: readonly (readonly [number, number])[];
  /** Lifespan band(s) of the selection, or null. */
  highlight: { from: number; to: number }[] | null;
  /** Live changes by the user (dragging, keys, buttons, playback). */
  onInput(y: number): void;
  /** A committed change (release, key press, button, typed year, playback stopping). */
  onChange(y: number): void;
  onPlayChange(playing: boolean): void;
}

/** The speed menu of the reference site (packages/globe AGENTS.md §6.1). */
const SPEEDS = [0.25, 0.5, 1, 2] as const;

export const TimelineBar = forwardRef<TimelineBarHandle, TimelineBarProps>(function TimelineBar(props, ref) {
  const host = useRef<HTMLDivElement>(null);
  const timeline = useRef<Timeline | null>(null);
  /** The latest committed props, for the timeline's callbacks and for (re-)creation. */
  const latest = useRef(props);
  /** What the live timeline was last given, so unchanged props are not re-applied. */
  const applied = useRef<{ frames: TimelineBarProps['frames']; highlight: TimelineBarProps['highlight'] }>({
    frames: null,
    highlight: null,
  });
  /** Playback speed, kept if the timeline is ever re-created. */
  const speed = useRef(1);

  useLayoutEffect(() => {
    latest.current = props;
  });

  const { min, max, present } = props;
  // The scale is fixed at construction: a change of the stops' values re-creates the
  // timeline, a new array with the same values does not.
  const stopsKey = props.stops.map(([y, t]) => `${y}:${t}`).join(',');

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const p = latest.current;
    let created: Timeline;
    try {
      created = new Timeline(el, {
        min,
        max,
        present,
        value: p.value,
        frames: p.frames,
        stops: p.stops,
        highlight: p.highlight,
        layout: 'bar',
        step: 1,
        yearField: 'input',
        changeButtons: false,
        speeds: SPEEDS,
        speed: speed.current,
        onInput: (y) => latest.current.onInput(y),
        onChange: (y) => latest.current.onChange(y),
        onPlayChange: (playing) => latest.current.onPlayChange(playing),
      });
    } catch (err) {
      // Invalid bounds or stops: leave the bar empty rather than break the explorer.
      console.error('TimelineBar: the timeline could not be created', err);
      return;
    }
    timeline.current = created;
    applied.current = { frames: p.frames, highlight: p.highlight };
    return () => {
      const wasPlaying = created.isPlaying();
      speed.current = created.getSpeed();
      created.destroy();
      if (timeline.current === created) timeline.current = null;
      // destroy() stops playback silently; tell the parent so its state does not stay "playing".
      if (wasPlaying) latest.current.onPlayChange(false);
    };
  }, [min, max, present, stopsKey]);

  // The year: applied before paint, so a stale value from an earlier render can never
  // pull the timeline back while the user scrubs or playback runs (the timeline has
  // already moved on by the time a passive effect would run).
  const { value } = props;
  useLayoutEffect(() => {
    const t = timeline.current;
    if (t && value !== t.getValue()) t.setValue(value);
  }, [value]);

  const { frames } = props;
  useEffect(() => {
    const t = timeline.current;
    if (!t || applied.current.frames === frames) return;
    applied.current.frames = frames;
    t.setFrames(frames);
  }, [frames]);

  const { highlight } = props;
  useEffect(() => {
    const t = timeline.current;
    if (!t || applied.current.highlight === highlight) return;
    applied.current.highlight = highlight;
    t.setHighlight(highlight);
  }, [highlight]);

  useImperativeHandle(
    ref,
    () => ({
      setValue: (y: number) => timeline.current?.setValue(y),
      togglePlay: () => timeline.current?.togglePlay(),
      pause: () => timeline.current?.pause(),
      isPlaying: () => timeline.current?.isPlaying() ?? false,
      stepChange: (d: 1 | -1) => timeline.current?.stepChange(d) ?? null,
      get element() {
        return host.current;
      },
    }),
    [],
  );

  return <div className="timeline-bar" ref={host} />;
});
