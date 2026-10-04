// Timeline component (root AGENTS.md §5.4, UX §7.2): framework-free DOM + CSS.
//
// A native <input type=range> carries the value for assistive technology (its value
// is the year: aria-valuenow = year, aria-valuetext = "500 BCE" / "1453 CE"); the
// visible track is custom so it can use the non-linear time scale. Everything the
// component creates lives under one `.ca-timeline` root inside the container.
//
// Value model: `onInput(year)` fires for every user-initiated change (at most once
// per animation frame while dragging or playing); `onChange(year)` fires when the
// user commits a value — pointer release, a key press (once per key, not per
// auto-repeat), a button, an applied typed year, or playback stopping. `setValue`
// never calls either.

import { DEFAULT_ERAS, type TimelineEra } from './eras.js';
import { ICONS } from './icons.js';
import { DEFAULT_TIMELINE_LABELS, type TimelineLabels } from './labels.js';
import {
  astroOf,
  createTimeScale,
  defaultStops,
  DEFAULT_PRESENT_YEAR,
  extendStops,
  yearsPerT,
  type TimeScale,
} from './scale.js';
import { adaptiveStep, gridStep, nextChange, normalizeFrames, prevChange } from './steps.js';
import { layoutMajorTicks, layoutMinorTicks } from './ticks.js';
import { addYears, clampYear, parseYear } from './years.js';

/** An inclusive span of years, e.g. a polity's lifespan. */
export interface TimelineSpan {
  from: number;
  to: number;
}

export interface TimelineOptions {
  /** First year of the track (historical numbering, non-zero integer). */
  min: number;
  /** Last year of the track. */
  max: number;
  /** Initial year (clamped to [min, max]; 0 becomes 1). */
  value: number;
  /** Scale stops `[year, t][]`. Default: {@link defaultStops} for `present`. */
  stops?: readonly (readonly [number, number])[];
  /** Present year for the default stops. Default: max(2026, `max`). */
  present?: number;
  /** Years in which borders change (`manifest.frames`): density strip and previous/next change. */
  frames?: readonly number[] | null;
  /** Era band. Default {@link DEFAULT_ERAS}; `false` hides the band. */
  eras?: readonly TimelineEra[] | false;
  /** Lifespan band(s) of the selected polity. */
  highlight?: TimelineSpan | readonly TimelineSpan[] | null;
  /** UI strings and year formatting (partial overrides of {@link DEFAULT_TIMELINE_LABELS}). */
  labels?: Partial<TimelineLabels>;
  /** Initial playback speed, 0.25–4. Default 1. */
  speed?: number;
  /** Entries of the speed menu, each clamped to 0.25–4. Default [0.5, 1, 2, 4]. */
  speeds?: readonly number[];
  /** Seconds a full sweep of the track takes at 1×. Default 120. */
  sweepSeconds?: number;
  /**
   * `'stacked'` (default): a controls row above the scale (density strip, track, tick
   * labels, era band). `'bar'`: one row of separate controls — transport, year, a thick
   * track with its tick lines drawn inside, speed menu — with the track on a row of its
   * own in narrow containers. The bar has no density strip, tick labels or era band
   * (`eras` is ignored).
   */
  layout?: 'stacked' | 'bar';
  /**
   * Step of the back/forward buttons: a whole number of years, or `'adaptive'`
   * (default: ≈ 1 % of the visible span, rounded). Page Up/Page Down stay adaptive.
   */
  step?: number | 'adaptive';
  /** The year in the controls: `'input'` (default, a typed-year field) or `'label'` (text only). */
  yearField?: 'input' | 'label';
  /** Previous/next border-change buttons (default true; hidden without frames). `[` and `]` work either way. */
  changeButtons?: boolean;
  /** Live value changes by the user (dragging, keys, buttons, playback). */
  onInput?(year: number): void;
  /** The user committed a value (release, key press, button, typed year, playback stop). */
  onChange?(year: number): void;
  /** Playback started (true) or stopped (false). */
  onPlayChange?(playing: boolean): void;
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const DEFAULT_SPEEDS = [0.5, 1, 2, 4];
const MIN_SPEED = 0.25;
const MAX_SPEED = 4;
/** Layout switches to the compact (phone) variant below this container width. */
const COMPACT_WIDTH = 640;
/**
 * Below this width the controls row also drops the step sizes from the step buttons
 * and tightens its padding (with the step sizes the compact row needs ≈ 379 px; 390 px
 * phones keep them).
 */
const NARROW_WIDTH = 380;
/**
 * Below this width the speed menu gives way too, so the typed-year field keeps room
 * for "3400 BCE" (320–359 px phones; playback keeps its speed).
 */
const TINY_WIDTH = 360;
/** Labelled ticks closer than this (px, centre to centre) are dropped by priority. */
const MIN_LABEL_SPACING = 56;
/** Seconds between playback updates when the user prefers reduced motion. */
const REDUCED_MOTION_INTERVAL = 0.5;
/** Longest frame time (s) counted during playback, so a stalled tab does not jump. */
const MAX_FRAME_TIME = 0.25;
/** Width (px) of the density strip's bins. */
const BIN_PX = 2;
/** Radius (px) over which the density strip averages changes per year. */
const DENSITY_RADIUS = 12;
/** Distance (px) within which pressing near the thumb grabs it instead of jumping. */
const GRAB_PX = { mouse: 10, touch: 22 };
/** Minimum distance (px) between minor tick lines inside the bar layout's track. */
const BAR_MINOR_SPACING = 9;
/**
 * Tick lines in the ticks SVG's 10-unit height: [major top, major bottom, minor top,
 * minor bottom]. Stacked: the ticks hang under the track. Bar: centred inside it.
 */
const TICK_GEOMETRY = { stacked: [0, 10, 5, 10], bar: [2.5, 7.5, 4, 6] } as const;

let instanceCount = 0;

// Animation frames, looked up at call time (so test fake timers apply) with a timer
// fallback for environments without requestAnimationFrame.
type FrameCallback = (ts: number) => void;
const g = globalThis as unknown as {
  requestAnimationFrame?: (cb: FrameCallback) => number;
  cancelAnimationFrame?: (id: number) => void;
};
function requestFrame(cb: FrameCallback): number {
  if (typeof g.requestAnimationFrame === 'function') return g.requestAnimationFrame(cb);
  return setTimeout(() => cb(typeof performance !== 'undefined' ? performance.now() : Date.now()), 16) as unknown as number;
}
function cancelFrame(id: number): void {
  if (typeof g.cancelAnimationFrame === 'function') g.cancelAnimationFrame(id);
  else clearTimeout(id);
}

/** A tick label's era suffix ("500 BCE" → "500" + "BCE"), drawn smaller. */
const ERA_SUFFIX = /^(.*?)\s+(BCE|BC|CE|AD)$/;

/** Font sizes (px) of tick labels and of their era suffix. Keep in sync with timeline.css. */
const TICK_FONT = { regular: { num: 11, era: 8.5 }, compact: { num: 10, era: 8 } } as const;
/** Space (px) between a tick label's number and its era suffix (CSS margin-left). */
const TICK_ERA_GAP = 2.5;

/**
 * Estimated rendered width (px) of a tick label. Calibrated on Inter with tabular
 * digits (0.65 em per digit, era capitals 0.71 em including letter-spacing, measured
 * in Edge) and rounded up slightly, so fallback UI fonts, which set narrower digits,
 * never render wider than estimated. Estimating instead of measuring keeps layout
 * free of forced reflows and independent of when web fonts finish loading.
 */
function estimateLabelWidth(text: string, font: { num: number; era: number }): number {
  const m = ERA_SUFFIX.exec(text);
  const num = m ? m[1]! : text;
  const era = m ? m[2]! : '';
  let em = 0;
  for (const ch of num) em += /[0-9]/.test(ch) ? 0.66 : ch === ' ' || ch === ',' || ch === '.' ? 0.3 : 0.7;
  let w = em * font.num;
  if (era) w += TICK_ERA_GAP + era.length * 0.73 * font.era;
  return Math.ceil(w);
}

export class Timeline {
  /** The timeline's root element (`.ca-timeline`), appended to the container. */
  readonly element: HTMLDivElement;

  private readonly doc: Document;
  private readonly labels: TimelineLabels;
  private readonly cb: Pick<TimelineOptions, 'onInput' | 'onChange' | 'onPlayChange'>;
  private readonly min: number;
  private readonly max: number;
  private readonly scale: TimeScale;
  private readonly tMin: number;
  private readonly tSpan: number;
  private readonly sweepSeconds: number;
  /** The one-row bar layout (no density strip, tick labels or eras). */
  private readonly bar: boolean;
  /** Fixed step of the back/forward buttons (years), or null for the adaptive step. */
  private readonly fixedStep: number | null;
  private readonly eraSpans: {
    from: number;
    to: number;
    /** Track fractions of the segment's ends. */
    left: number;
    right: number;
    era: TimelineEra;
    el: HTMLDivElement;
    text: HTMLSpanElement;
    /** Text that fits inside the segment ('' when none does). */
    fitted: string;
  }[] = [];
  private eraNow: HTMLSpanElement | null = null;
  private readonly listeners = new AbortController();

  private value: number;
  private frames: number[] = [];
  private spans: TimelineSpan[] = [];
  private speed = 1;
  private width = 0;
  private innerLeft = 0;
  private compact = false;
  private playing = false;
  private dragging = false;
  private editing = false;
  private uncommitted = false;
  private destroyed = false;
  private reducedMotion = false;
  private currentEra = -1;
  private stepBackSize = 0;
  private stepFwdSize = 0;

  // Drag and frame scheduling.
  private dragPointer = -1;
  private dragOffset = 0;
  private pendingYear: number | null = null;
  private frameHandle: number | null = null;
  // Playback.
  private playHandle: number | null = null;
  private playT = 0;
  private lastTs: number | null = null;
  private playAccum = 0;
  private resizeObserver: ResizeObserver | null = null;

  // Elements.
  private readonly prevBtn: HTMLButtonElement;
  private readonly backBtn: HTMLButtonElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly fwdBtn: HTMLButtonElement;
  private readonly nextBtn: HTMLButtonElement;
  private readonly backText: HTMLSpanElement;
  private readonly fwdText: HTMLSpanElement;
  private readonly yearWrap: HTMLDivElement;
  /** The typed-year field (`yearField: 'input'`), else null. */
  private readonly yearInput: HTMLInputElement | null;
  /** The year as text (`yearField: 'label'`), else null. */
  private readonly yearLabel: HTMLSpanElement | null;
  private readonly yearError: HTMLDivElement;
  private readonly speedSelect: HTMLSelectElement;
  private readonly scaleEl: HTMLDivElement;
  private readonly inner: HTMLDivElement;
  private readonly densitySvg: SVGSVGElement;
  private readonly densityPaths: SVGPathElement[];
  private readonly rangeEl: HTMLInputElement;
  private readonly highlightsEl: HTMLDivElement;
  private readonly thumb: HTMLDivElement;
  private readonly playhead: HTMLDivElement;
  private readonly hoverEl: HTMLDivElement;
  private readonly bubble: HTMLSpanElement;
  private readonly ticksSvg: SVGSVGElement;
  private readonly minorPath: SVGPathElement;
  private readonly majorPath: SVGPathElement;
  private readonly labelsEl: HTMLDivElement;
  private readonly erasEl: HTMLDivElement | null;
  private readonly helpEl: HTMLSpanElement;
  private readonly highlightDesc: HTMLSpanElement;
  private readonly ids: { help: string; highlight: string; year: string; error: string };

  constructor(container: HTMLElement, options: TimelineOptions) {
    if (!container || typeof container.appendChild !== 'function') {
      throw new TypeError('Timeline: container must be an element');
    }
    const { min, max } = options;
    for (const [name, y] of [['min', min], ['max', max]] as const) {
      if (!Number.isSafeInteger(y) || y === 0) throw new RangeError(`Timeline: ${name} must be a non-zero integer year (got ${String(y)})`);
    }
    if (!(min < max)) throw new RangeError(`Timeline: min (${min}) must be before max (${max})`);
    this.min = min;
    this.max = max;
    this.doc = container.ownerDocument;
    // Overrides that are undefined (e.g. spread from an optional config) keep the default.
    const overrides = Object.entries(options.labels ?? {}).filter(([, v]) => v !== undefined);
    this.labels = { ...DEFAULT_TIMELINE_LABELS, ...(Object.fromEntries(overrides) as Partial<TimelineLabels>) };
    this.cb = { onInput: options.onInput, onChange: options.onChange, onPlayChange: options.onPlayChange };
    this.sweepSeconds = options.sweepSeconds && options.sweepSeconds > 0 ? options.sweepSeconds : 120;

    // Scale: the stops (validated), continued past their ends if the track is wider.
    const present = options.present ?? Math.max(DEFAULT_PRESENT_YEAR, max);
    const base = createTimeScale(options.stops ?? defaultStops(present));
    this.scale =
      min < base.domain[0] || max > base.domain[1] ? createTimeScale(extendStops(base.stops, min, max)) : base;
    this.tMin = this.scale.toT(min);
    this.tSpan = this.scale.toT(max) - this.tMin;

    const uid = `ca-timeline-${++instanceCount}`;
    this.ids = { help: `${uid}-help`, highlight: `${uid}-highlight`, year: `${uid}-year`, error: `${uid}-error` };
    this.value = this.sanitize(options.value, min);
    this.speed = this.clampSpeed(options.speed ?? 1);
    this.bar = options.layout === 'bar';
    const step = options.step;
    this.fixedStep = typeof step === 'number' && Number.isSafeInteger(step) && step >= 1 ? step : null;

    // ---------------------------------------------------------------- DOM
    const L = this.labels;
    const root = this.h('div', 'ca-timeline');
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', L.timeline);
    root.setAttribute('dir', 'ltr');
    root.dataset.caPlaying = 'false';
    root.dataset.caLayout = this.bar ? 'bar' : 'stacked';
    root.dataset.caStep = this.fixedStep === null ? 'adaptive' : 'fixed';
    this.element = root;

    const controls = this.h('div', 'ca-timeline__controls');
    const transport = this.h('div', 'ca-timeline__transport');
    this.prevBtn = this.button('ca-timeline__btn ca-timeline__btn--change', ICONS.prevChange, L.prevChange, `${L.prevChange} ([)`);
    this.backBtn = this.button('ca-timeline__btn ca-timeline__btn--step ca-timeline__btn--back', ICONS.stepBack, '', '');
    this.backText = this.h('span', 'ca-timeline__step-n');
    this.backBtn.append(this.backText);
    this.playBtn = this.button('ca-timeline__btn ca-timeline__btn--play', ICONS.play, L.play, `${L.play} (Space)`);
    this.fwdBtn = this.button('ca-timeline__btn ca-timeline__btn--step ca-timeline__btn--fwd', '', '', '');
    this.fwdText = this.h('span', 'ca-timeline__step-n');
    this.fwdBtn.append(this.fwdText);
    this.fwdBtn.insertAdjacentHTML('beforeend', ICONS.stepForward);
    this.nextBtn = this.button('ca-timeline__btn ca-timeline__btn--change', ICONS.nextChange, L.nextChange, `${L.nextChange} (])`);
    // Without change buttons the [ and ] keys still jump (the buttons stay detached).
    if (options.changeButtons === false) transport.append(this.backBtn, this.playBtn, this.fwdBtn);
    else transport.append(this.prevBtn, this.backBtn, this.playBtn, this.fwdBtn, this.nextBtn);

    this.yearWrap = this.h('div', 'ca-timeline__year');
    this.yearError = this.h('div', 'ca-timeline__year-error');
    this.yearError.id = this.ids.error;
    this.yearError.setAttribute('role', 'alert');
    this.yearError.hidden = true;
    if (options.yearField === 'label') {
      // Visual only: the slider carries the value (aria-valuetext) for assistive technology.
      this.yearInput = null;
      this.yearLabel = this.h('span', 'ca-timeline__year-label');
      this.yearLabel.setAttribute('aria-hidden', 'true');
      this.yearWrap.append(this.yearLabel);
    } else {
      this.yearLabel = null;
      const input = this.h('input', 'ca-timeline__year-input');
      Object.assign(input, { type: 'text', id: this.ids.year, autocomplete: 'off', spellcheck: false });
      input.setAttribute('aria-label', L.yearField);
      input.setAttribute('enterkeyhint', 'go');
      input.setAttribute('autocapitalize', 'characters');
      input.setAttribute('aria-describedby', this.ids.error);
      this.yearInput = input;
      this.yearWrap.append(input, this.yearError);
    }

    const speedWrap = this.h('div', 'ca-timeline__speed');
    this.speedSelect = this.h('select', 'ca-timeline__speed-select');
    this.speedSelect.setAttribute('aria-label', L.speed);
    this.speedSelect.title = L.speed;
    const speeds = [...new Set((options.speeds ?? DEFAULT_SPEEDS).map((s) => this.clampSpeed(s)))].sort((a, b) => a - b);
    if (!speeds.includes(this.speed)) speeds.push(this.speed);
    for (const s of speeds.sort((a, b) => a - b)) {
      const opt = this.h('option', 'ca-timeline__speed-option');
      opt.value = String(s);
      opt.textContent = `${s}×`;
      this.speedSelect.append(opt);
    }
    this.speedSelect.value = String(this.speed);
    speedWrap.append(this.speedSelect);
    controls.append(transport, this.yearWrap, speedWrap);

    // Scale area: density strip, track (range + highlight + thumb), ticks, labels, eras.
    this.scaleEl = this.h('div', 'ca-timeline__scale');
    this.inner = this.h('div', 'ca-timeline__inner');
    this.densitySvg = this.svg('ca-timeline__density');
    this.densityPaths = [1, 2, 3].map((lvl) => {
      const p = this.doc.createElementNS(SVG_NS, 'path');
      p.setAttribute('class', `ca-timeline__density-bars ca-timeline__density-bars--${lvl}`);
      this.densitySvg.append(p);
      return p;
    });
    const track = this.h('div', 'ca-timeline__track');
    const rail = this.h('div', 'ca-timeline__rail');
    this.highlightsEl = this.h('div', 'ca-timeline__highlights');
    track.append(rail, this.highlightsEl);

    this.rangeEl = this.h('input', 'ca-timeline__range');
    Object.assign(this.rangeEl, { type: 'range', min: String(min), max: String(max), step: '1' });
    this.rangeEl.setAttribute('aria-label', L.slider);
    this.helpEl = this.h('span', 'ca-timeline__sr');
    this.helpEl.id = this.ids.help;
    this.helpEl.textContent = L.sliderHelp;
    this.highlightDesc = this.h('span', 'ca-timeline__sr');
    this.highlightDesc.id = this.ids.highlight;

    this.playhead = this.h('div', 'ca-timeline__playhead');
    this.thumb = this.h('div', 'ca-timeline__thumb');
    this.hoverEl = this.h('div', 'ca-timeline__hover');
    this.bubble = this.h('span', 'ca-timeline__bubble');
    this.hoverEl.append(this.bubble);
    for (const e of [this.playhead, this.thumb, this.hoverEl]) e.setAttribute('aria-hidden', 'true');

    this.ticksSvg = this.svg('ca-timeline__ticks');
    this.minorPath = this.doc.createElementNS(SVG_NS, 'path');
    this.minorPath.setAttribute('class', 'ca-timeline__ticks-minor');
    this.majorPath = this.doc.createElementNS(SVG_NS, 'path');
    this.majorPath.setAttribute('class', 'ca-timeline__ticks-major');
    this.ticksSvg.append(this.minorPath, this.majorPath);
    this.labelsEl = this.h('div', 'ca-timeline__labels');
    this.labelsEl.setAttribute('aria-hidden', 'true');

    // The range precedes the thumb so CSS can draw its focus ring on the thumb. The bar
    // draws its tick lines inside the track, under the thumb, and has no density strip
    // or tick labels.
    if (this.bar) this.inner.append(track, this.ticksSvg, this.playhead, this.rangeEl, this.thumb, this.hoverEl);
    else this.inner.append(this.densitySvg, track, this.playhead, this.rangeEl, this.thumb, this.hoverEl, this.ticksSvg, this.labelsEl);

    const eras = this.bar || options.eras === false ? [] : (options.eras ?? DEFAULT_ERAS);
    if (eras.length) {
      this.erasEl = this.h('div', 'ca-timeline__eras');
      this.erasEl.setAttribute('aria-hidden', 'true');
      this.buildEras(eras);
      this.inner.append(this.erasEl);
    } else {
      this.erasEl = null;
      root.dataset.caNoEras = 'true';
    }
    this.scaleEl.append(this.inner);
    if (this.bar) {
      // The bar's controls box is `display: contents`: its children are the bar's grid
      // items, kept in the order they are shown (transport, year, track, speed) so Tab
      // and the reading order follow the bar.
      controls.insertBefore(this.scaleEl, speedWrap);
      root.append(controls, this.helpEl, this.highlightDesc);
    } else {
      root.append(controls, this.scaleEl, this.helpEl, this.highlightDesc);
    }
    container.append(root);

    this.frames = normalizeFrames(options.frames, min, max);
    this.spans = this.normalizeSpans(options.highlight ?? null);
    this.bindEvents();
    this.renderFramesState();
    this.renderHighlight();
    this.renderValue();
    this.observeSize();
    this.layout();
  }

  // ------------------------------------------------------------------ public API

  /** Current year. */
  getValue(): number {
    return this.value;
  }

  /**
   * Moves the timeline to `year` without calling `onInput`/`onChange` (sanitised:
   * rounded, clamped, 0 → 1). Ignored while the user is dragging (the gesture wins).
   * During playback it seeks, and playback continues from there.
   */
  setValue(year: number): void {
    if (this.destroyed || this.dragging) return;
    const y = this.sanitize(year, this.value);
    if (y === this.value) return;
    this.value = y;
    if (this.playing) this.playT = this.frac(y);
    this.renderValue();
  }

  /** Shows the lifespan band(s) of the selected polity, or removes them with null. */
  setHighlight(span: TimelineSpan | readonly TimelineSpan[] | null): void {
    if (this.destroyed) return;
    this.spans = this.normalizeSpans(span);
    this.renderHighlight();
  }

  /** Replaces the border-change years (density strip, previous/next change). */
  setFrames(frames: readonly number[] | null): void {
    if (this.destroyed) return;
    this.frames = normalizeFrames(frames, this.min, this.max);
    this.renderFramesState();
    this.renderDensity();
    this.renderChangeButtons();
  }

  /** Starts playback at constant track speed; from the start if at the end. */
  play(): void {
    if (this.destroyed || this.playing) return;
    if (this.value >= this.max) this.setInternal(this.min, true);
    this.playing = true;
    this.playT = this.frac(this.value);
    this.lastTs = null;
    this.playAccum = 0;
    this.renderPlayState();
    this.cb.onPlayChange?.(true);
    this.playHandle = requestFrame(this.onPlayFrame);
  }

  /** Stops playback (and commits the year reached with `onChange`). */
  pause(): void {
    if (this.destroyed || !this.playing) return;
    this.stopPlayback();
    this.cb.onPlayChange?.(false);
    this.commit();
  }

  togglePlay(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** Playback speed multiplier (0.5–4). */
  getSpeed(): number {
    return this.speed;
  }

  setSpeed(speed: number): void {
    if (this.destroyed || !Number.isFinite(speed)) return;
    this.speed = this.clampSpeed(speed);
    if (![...this.speedSelect.options].some((o) => Number(o.value) === this.speed)) {
      const opt = this.h('option', 'ca-timeline__speed-option');
      opt.value = String(this.speed);
      opt.textContent = `${this.speed}×`;
      this.speedSelect.append(opt);
    }
    this.speedSelect.value = String(this.speed);
  }

  /** Jumps to the previous (−1) or next (+1) border change, as the user would. Returns the new year or null. */
  stepChange(dir: 1 | -1): number | null {
    if (this.destroyed) return null;
    const target = dir < 0 ? prevChange(this.frames, this.value) : nextChange(this.frames, this.value);
    if (target === null) return null;
    this.userSet(target, true);
    return this.value;
  }

  /**
   * Moves one step of the back/forward buttons (the `step` option; adaptive by default)
   * back (−1) or forward (+1), as the user would. Returns the new year.
   */
  stepBy(dir: 1 | -1): number {
    if (this.destroyed) return this.value;
    this.userSet(this.stepTarget(dir, this.buttonStep(dir)), true);
    return this.value;
  }

  /** Re-measures the track (call after layout changes when ResizeObserver is unavailable). */
  resize(): void {
    this.layout();
  }

  /** Removes the timeline's DOM and every listener; the instance is inert afterwards. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.playHandle !== null) cancelFrame(this.playHandle);
    if (this.frameHandle !== null) cancelFrame(this.frameHandle);
    this.playHandle = this.frameHandle = null;
    this.playing = this.dragging = false;
    this.listeners.abort();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.element.remove();
  }

  // ------------------------------------------------------------- value plumbing

  /** Track fraction 0..1 of a year. */
  private frac(year: number): number {
    return this.tSpan > 0 ? (this.scale.toT(year) - this.tMin) / this.tSpan : 0;
  }

  /** Year at a track fraction (clamped). */
  private yearAtFrac(f: number): number {
    const c = Math.min(1, Math.max(0, f));
    const y = this.scale.toYear(this.tMin + c * this.tSpan);
    return Math.min(this.max, Math.max(this.min, y));
  }

  /**
   * Year under a pointer at x px. Where one pixel spans several years the year is
   * rounded to a round number inside that pixel (2980 BCE rather than 2981 BCE).
   */
  private yearAtX(x: number): number {
    const w = this.width;
    if (!(w > 0)) return this.value;
    const y = this.yearAtFrac(x / w);
    const yearsPerPx = (yearsPerT(this.scale, y, 1) * this.tSpan) / w;
    let grain = 1;
    for (const g of [2, 5, 10, 20, 25, 50, 100]) if (g <= yearsPerPx) grain = g;
    if (grain === 1 || y === this.min || y === this.max) return y;
    let r = Math.round(y / grain) * grain;
    if (r === 0) r = y < 0 ? -1 : 1;
    return Math.min(this.max, Math.max(this.min, r));
  }

  private sanitize(year: number, fallback: number): number {
    if (typeof year !== 'number' || !Number.isFinite(year)) return fallback;
    return clampYear(year, this.min, this.max);
  }

  /**
   * Sets the value. `emit` = a user change: calls onInput and marks the value
   * uncommitted. `fromPlayback` keeps the fractional playback position.
   */
  private setInternal(year: number, emit: boolean, fromPlayback = false): void {
    const y = this.sanitize(year, this.value);
    if (y === this.value) return;
    this.value = y;
    if (this.playing && !fromPlayback) this.playT = this.frac(y);
    this.renderValue();
    if (emit) {
      this.uncommitted = true;
      this.cb.onInput?.(y);
    }
  }

  /** A discrete user change (button, key press, typed year): onInput, then onChange. */
  private userSet(year: number, commitNow: boolean): void {
    this.setInternal(year, true);
    if (commitNow) this.commit();
  }

  /** Calls onChange once for the user's uncommitted changes. */
  private commit(): void {
    if (!this.uncommitted || this.destroyed) return;
    this.uncommitted = false;
    this.cb.onChange?.(this.value);
  }

  /** The year one step away (default: the adaptive step, as Page Up/Page Down use). */
  private stepTarget(dir: 1 | -1, size = this.stepSize(dir)): number {
    return gridStep(this.value, size, dir, this.min, this.max);
  }

  /** Adaptive step (years): ≈ 1 % of the visible span in the direction of travel, rounded. */
  private stepSize(dir: 1 | -1): number {
    return adaptiveStep(this.scale, this.value, dir, this.tSpan);
  }

  /** Step of the back/forward buttons: the `step` option, else the adaptive step. */
  private buttonStep(dir: 1 | -1): number {
    return this.fixedStep ?? this.stepSize(dir);
  }

  private clampSpeed(s: number): number {
    return Number.isFinite(s) ? Math.min(MAX_SPEED, Math.max(MIN_SPEED, s)) : 1;
  }

  private normalizeSpans(span: TimelineSpan | readonly TimelineSpan[] | null): TimelineSpan[] {
    if (!span) return [];
    const list = (Array.isArray(span) ? span : [span]) as readonly TimelineSpan[];
    const out: TimelineSpan[] = [];
    for (const s of list) {
      if (!s || !Number.isFinite(s.from) || !Number.isFinite(s.to)) continue;
      const a = Math.round(Math.min(s.from, s.to));
      const b = Math.round(Math.max(s.from, s.to));
      if (b < this.min || a > this.max) continue;
      out.push({ from: this.sanitize(a, this.min), to: this.sanitize(b, this.max) });
    }
    return out.sort((p, q) => p.from - q.from);
  }

  // ------------------------------------------------------------------ playback

  private readonly onPlayFrame = (ts: number): void => {
    this.playHandle = null;
    if (!this.playing || this.destroyed) return;
    if (this.lastTs === null) {
      this.lastTs = ts;
    } else {
      const dt = Math.min(MAX_FRAME_TIME, Math.max(0, (ts - this.lastTs) / 1000));
      this.lastTs = ts;
      if (!this.dragging) {
        this.playAccum += dt;
        // With reduced motion the year advances in calmer jumps at the same average speed.
        if (this.playAccum >= (this.reducedMotion ? REDUCED_MOTION_INTERVAL : 0)) {
          this.playT = Math.min(1, this.playT + (this.playAccum * this.speed) / this.sweepSeconds);
          this.playAccum = 0;
          const y = this.playT >= 1 ? this.max : this.yearAtFrac(this.playT);
          this.setInternal(y, true, true);
          if (this.playT >= 1) {
            this.pause();
            return;
          }
        }
      }
    }
    this.playHandle = requestFrame(this.onPlayFrame);
  };

  private stopPlayback(): void {
    this.playing = false;
    if (this.playHandle !== null) cancelFrame(this.playHandle);
    this.playHandle = null;
    this.renderPlayState();
  }

  // -------------------------------------------------------------------- events

  private bindEvents(): void {
    const signal = this.listeners.signal;
    const on = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement,
      type: K,
      fn: (e: HTMLElementEventMap[K]) => void,
      opts: AddEventListenerOptions = {},
    ): void => target.addEventListener(type, fn as EventListener, { ...opts, signal });

    on(this.prevBtn, 'click', () => this.clickIfEnabled(this.prevBtn, () => this.stepChange(-1)));
    on(this.nextBtn, 'click', () => this.clickIfEnabled(this.nextBtn, () => this.stepChange(1)));
    on(this.backBtn, 'click', () => this.clickIfEnabled(this.backBtn, () => this.stepBy(-1)));
    on(this.fwdBtn, 'click', () => this.clickIfEnabled(this.fwdBtn, () => this.stepBy(1)));
    on(this.playBtn, 'click', () => this.togglePlay());
    on(this.speedSelect, 'change', () => this.setSpeed(Number(this.speedSelect.value)));

    // Typed year: focusing selects the whole year so typing replaces it. The click that
    // focuses the field would otherwise place the caret on mouseup and drop the selection.
    const yearInput = this.yearInput;
    if (yearInput) {
      let focusingClick = false;
      on(yearInput, 'pointerdown', () => {
        focusingClick = this.doc.activeElement !== yearInput;
      });
      on(yearInput, 'focus', () => yearInput.select());
      on(yearInput, 'mouseup', (e) => {
        if (focusingClick) e.preventDefault();
        focusingClick = false;
      });
      on(yearInput, 'input', () => {
        this.editing = true;
        this.clearYearError();
      });
      on(yearInput, 'keydown', (e) => this.onYearKeyDown(e, yearInput));
      on(yearInput, 'blur', () => {
        if (!this.editing) {
          // The year may have moved on while the field had focus (playback, the host).
          yearInput.value = this.labels.formatYear(this.value);
          return;
        }
        const y = this.parseTyped(yearInput);
        if (y !== null) this.applyTyped(y, yearInput);
        else this.revertTyped(yearInput);
      });
    }

    // Slider keyboard and assistive-technology input.
    on(this.rangeEl, 'keydown', (e) => this.onRangeKeyDown(e));
    on(this.rangeEl, 'keyup', () => this.commit());
    on(this.rangeEl, 'blur', () => this.commit());
    on(this.rangeEl, 'input', () => this.onRangeInput());
    on(this.rangeEl, 'change', () => this.commit());

    // Shortcuts on any other control inside the timeline.
    on(this.element, 'keydown', (e) => this.onRootKeyDown(e));

    // Pointer scrubbing over the whole scale area.
    on(this.scaleEl, 'pointerenter', () => this.measure());
    on(this.scaleEl, 'pointerdown', (e) => this.onPointerDown(e));
    on(this.scaleEl, 'pointermove', (e) => this.onPointerMove(e));
    on(this.scaleEl, 'pointerup', (e) => this.onPointerEnd(e));
    on(this.scaleEl, 'pointercancel', (e) => this.onPointerEnd(e));
    on(this.scaleEl, 'lostpointercapture', (e) => this.onPointerEnd(e));
    on(this.scaleEl, 'pointerleave', () => {
      if (!this.dragging) this.hideBubble();
    });

    // prefers-reduced-motion (live).
    const mq = typeof globalThis.matchMedia === 'function' ? globalThis.matchMedia('(prefers-reduced-motion: reduce)') : null;
    if (mq) {
      this.reducedMotion = mq.matches;
      mq.addEventListener?.('change', (e) => (this.reducedMotion = e.matches), { signal });
    }
  }

  private clickIfEnabled(btn: HTMLButtonElement, fn: () => void): void {
    if (btn.getAttribute('aria-disabled') === 'true') return;
    fn();
  }

  private onRangeKeyDown(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    let target: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        target = addYears(this.value, e.shiftKey ? 10 : 1);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        target = addYears(this.value, e.shiftKey ? -10 : -1);
        break;
      case 'PageUp':
        target = this.stepTarget(1);
        break;
      case 'PageDown':
        target = this.stepTarget(-1);
        break;
      case 'Home':
        target = this.min;
        break;
      case 'End':
        target = this.max;
        break;
      case '[':
        target = prevChange(this.frames, this.value);
        break;
      case ']':
        target = nextChange(this.frames, this.value);
        break;
      case ' ':
      case 'Spacebar':
      case 'k':
      case 'K':
        if (!e.repeat) this.togglePlay();
        e.preventDefault();
        return;
      default:
        return;
    }
    e.preventDefault();
    if (target === null) return;
    this.setInternal(target, true);
    // One onChange per key press; auto-repeat commits on keyup.
    if (!e.repeat) this.commit();
  }

  private onRootKeyDown(e: KeyboardEvent): void {
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey) return;
    const t = e.target;
    if (t === this.rangeEl || t === this.yearInput || t === this.speedSelect) return;
    if (e.key === '[' || e.key === ']') {
      e.preventDefault();
      this.stepChange(e.key === '[' ? -1 : 1);
    } else if ((e.key === 'k' || e.key === 'K') && !e.repeat) {
      e.preventDefault();
      this.togglePlay();
    }
  }

  /** Changes made by assistive technology (increment/decrement actions) arrive as input events. */
  private onRangeInput(): void {
    let y = Number(this.rangeEl.value);
    if (!Number.isFinite(y)) return;
    if (y === 0) y = this.value < 0 ? 1 : -1; // crossing the missing year 0
    this.setInternal(y, true);
    // Keep the native value equal to ours even when nothing changed.
    this.rangeEl.value = String(this.value);
  }

  private onYearKeyDown(e: KeyboardEvent, input: HTMLInputElement): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      const y = this.parseTyped(input);
      if (y === null) {
        this.showYearError(input);
        return;
      }
      this.applyTyped(y, input);
      input.select();
    } else if (e.key === 'Escape' || e.key === 'Esc') {
      // Only swallow Escape when there is something to revert, so a host can still
      // use Escape to close its panels.
      if (this.editing || !this.yearError.hidden) {
        e.preventDefault();
        e.stopPropagation();
        this.revertTyped(input);
        input.select();
      }
    }
  }

  private parseTyped(input: HTMLInputElement): number | null {
    const y = parseYear(input.value);
    if (y === null || !Number.isSafeInteger(y) || y === 0 || y < this.min || y > this.max) return null;
    return y;
  }

  private applyTyped(y: number, input: HTMLInputElement): void {
    this.editing = false;
    this.clearYearError();
    this.userSet(y, true);
    input.value = this.labels.formatYear(this.value);
  }

  private revertTyped(input: HTMLInputElement): void {
    this.editing = false;
    this.clearYearError();
    input.value = this.labels.formatYear(this.value);
  }

  private showYearError(input: HTMLInputElement): void {
    const L = this.labels;
    this.yearWrap.dataset.caInvalid = 'true';
    input.setAttribute('aria-invalid', 'true');
    this.yearError.textContent = L.invalidYear(L.formatYear(this.min), L.formatYear(this.max));
    this.yearError.hidden = false;
  }

  private clearYearError(): void {
    if (this.yearError.hidden) return;
    delete this.yearWrap.dataset.caInvalid;
    this.yearInput?.removeAttribute('aria-invalid');
    this.yearError.textContent = '';
    this.yearError.hidden = true;
  }

  private pointerX(e: PointerEvent): number {
    return e.clientX - this.innerLeft;
  }

  private onPointerDown(e: PointerEvent): void {
    if (this.dragging || (e.pointerType === 'mouse' && e.button !== 0)) return;
    this.measure();
    if (!(this.width > 0)) return;
    e.preventDefault();
    this.rangeEl.focus({ preventScroll: true });
    const x = this.pointerX(e);
    const thumbX = this.frac(this.value) * this.width;
    const grab = e.pointerType === 'touch' ? GRAB_PX.touch : GRAB_PX.mouse;
    // Pressing on the thumb drags it from where it was grabbed; elsewhere it jumps.
    this.dragOffset = Math.abs(x - thumbX) <= grab ? x - thumbX : 0;
    this.dragging = true;
    this.dragPointer = e.pointerId;
    this.element.dataset.caDragging = 'true';
    try {
      this.scaleEl.setPointerCapture?.(e.pointerId);
    } catch {
      /* capture is best effort (synthetic events have no active pointer) */
    }
    this.scheduleDrag(x - this.dragOffset);
  }

  private onPointerMove(e: PointerEvent): void {
    if (this.dragging) {
      if (e.pointerId === this.dragPointer) this.scheduleDrag(this.pointerX(e) - this.dragOffset);
    } else if (e.pointerType !== 'touch') {
      if (!(this.width > 0)) this.measure();
      if (!(this.width > 0)) return;
      const y = this.yearAtX(this.pointerX(e));
      this.showBubbleAt(y, true);
    }
  }

  private onPointerEnd(e: PointerEvent): void {
    if (!this.dragging || e.pointerId !== this.dragPointer) return;
    if (this.frameHandle !== null) {
      cancelFrame(this.frameHandle);
      this.frameHandle = null;
    }
    this.flushDrag();
    this.dragging = false;
    this.dragPointer = -1;
    delete this.element.dataset.caDragging;
    try {
      if (this.scaleEl.hasPointerCapture?.(e.pointerId)) this.scaleEl.releasePointerCapture(e.pointerId);
    } catch {
      /* already released */
    }
    if (e.type === 'pointerup' && e.pointerType !== 'touch') this.showBubbleAt(this.value, true);
    else this.hideBubble();
    if (this.playing) this.playT = this.frac(this.value);
    this.commit();
  }

  /** Coalesces pointer moves: at most one value change (and onInput) per animation frame. */
  private scheduleDrag(x: number): void {
    this.pendingYear = this.yearAtX(x);
    this.showBubbleAt(this.pendingYear, false);
    if (this.frameHandle === null) {
      this.frameHandle = requestFrame(() => {
        this.frameHandle = null;
        this.flushDrag();
      });
    }
  }

  private flushDrag(): void {
    if (this.pendingYear === null || this.destroyed) return;
    const y = this.pendingYear;
    this.pendingYear = null;
    this.setInternal(y, true);
  }

  // -------------------------------------------------------------------- layout

  private observeSize(): void {
    const RO = (this.doc.defaultView as (Window & { ResizeObserver?: typeof ResizeObserver }) | null)?.ResizeObserver ??
      (globalThis as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver;
    if (RO) {
      this.resizeObserver = new RO(() => this.layout());
      this.resizeObserver.observe(this.element);
    } else {
      this.doc.defaultView?.addEventListener('resize', () => this.layout(), { signal: this.listeners.signal });
    }
  }

  /** Reads the track's size and position (px). */
  private measure(): void {
    const r = this.inner.getBoundingClientRect();
    this.width = r.width;
    this.innerLeft = r.left;
  }

  private layout(): void {
    if (this.destroyed) return;
    const rootWidth = this.element.getBoundingClientRect().width;
    const compact = rootWidth > 0 && rootWidth < COMPACT_WIDTH;
    if (compact !== this.compact) {
      this.compact = compact;
      if (compact) this.element.dataset.caCompact = 'true';
      else delete this.element.dataset.caCompact;
    }
    // Very small phones: the step buttons drop their numbers (still in their labels);
    // below TINY_WIDTH the speed menu is hidden as well.
    if (rootWidth > 0 && rootWidth < NARROW_WIDTH) this.element.dataset.caNarrow = 'true';
    else delete this.element.dataset.caNarrow;
    if (rootWidth > 0 && rootWidth < TINY_WIDTH) this.element.dataset.caTiny = 'true';
    else delete this.element.dataset.caTiny;
    this.measure();
    this.renderTicks();
    this.renderDensity();
    this.renderEraLabels();
  }

  // ------------------------------------------------------------------ rendering

  private renderValue(): void {
    const y = this.value;
    const pct = `${(this.frac(y) * 100).toFixed(4)}%`;
    this.thumb.style.left = pct;
    this.playhead.style.left = pct;
    this.rangeEl.value = String(y);
    this.rangeEl.setAttribute('aria-valuenow', String(y));
    this.rangeEl.setAttribute('aria-valuetext', this.labels.spokenYear(y));
    if (this.yearLabel) this.yearLabel.textContent = this.labels.formatYear(y);
    // Not while the field has focus: writing .value collapses the select-all that focusing
    // applied, so typing during playback would append to the running year. Blur catches up.
    else if (this.yearInput && !this.editing && this.doc.activeElement !== this.yearInput) {
      this.yearInput.value = this.labels.formatYear(y);
    }
    this.renderSteps();
    this.renderChangeButtons();
    this.renderCurrentEra();
  }

  private renderSteps(): void {
    const L = this.labels;
    const back = this.buttonStep(-1);
    const fwd = this.buttonStep(1);
    if (back !== this.stepBackSize) {
      this.stepBackSize = back;
      this.backText.textContent = String(back);
      this.backBtn.setAttribute('aria-label', L.stepBack(back));
      this.backBtn.title = `${L.stepBack(back)}${this.stepKeyHint(-1)}`;
    }
    if (fwd !== this.stepFwdSize) {
      this.stepFwdSize = fwd;
      this.fwdText.textContent = String(fwd);
      this.fwdBtn.setAttribute('aria-label', L.stepForward(fwd));
      this.fwdBtn.title = `${L.stepForward(fwd)}${this.stepKeyHint(1)}`;
    }
    this.setDisabled(this.backBtn, this.value <= this.min);
    this.setDisabled(this.fwdBtn, this.value >= this.max);
  }

  /** The slider key that does what a step button does, for its tooltip (' (Page Up)'). */
  private stepKeyHint(dir: 1 | -1): string {
    if (this.fixedStep === null) return dir < 0 ? ' (Page Down)' : ' (Page Up)';
    // Arrows move exactly one year; other fixed steps land on multiples, like no key does.
    return this.fixedStep === 1 ? ` (${dir < 0 ? '←' : '→'})` : '';
  }

  private renderChangeButtons(): void {
    this.setDisabled(this.prevBtn, prevChange(this.frames, this.value) === null);
    this.setDisabled(this.nextBtn, nextChange(this.frames, this.value) === null);
  }

  private renderFramesState(): void {
    if (this.frames.length) delete this.element.dataset.caNoFrames;
    else this.element.dataset.caNoFrames = 'true';
  }

  private setDisabled(btn: HTMLButtonElement, disabled: boolean): void {
    // aria-disabled keeps the button focusable, so focus is not lost at the ends.
    if (disabled) btn.setAttribute('aria-disabled', 'true');
    else btn.removeAttribute('aria-disabled');
  }

  private renderPlayState(): void {
    const L = this.labels;
    const label = this.playing ? L.pause : L.play;
    this.element.dataset.caPlaying = String(this.playing);
    this.playBtn.setAttribute('aria-label', label);
    this.playBtn.title = `${label} (Space)`;
    this.playBtn.innerHTML = this.playing ? ICONS.pause : ICONS.play;
  }

  private showBubbleAt(year: number, hover: boolean): void {
    const f = this.frac(year);
    this.hoverEl.style.left = `${(f * 100).toFixed(4)}%`;
    this.bubble.textContent = this.labels.formatYear(year);
    const x = f * this.width;
    // Keep the bubble inside the timeline near the ends of the track.
    const edge = x < 28 ? 'start' : this.width - x < 28 ? 'end' : '';
    if (edge) this.hoverEl.dataset.caEdge = edge;
    else delete this.hoverEl.dataset.caEdge;
    this.hoverEl.dataset.caVisible = hover ? 'hover' : 'drag';
  }

  private hideBubble(): void {
    delete this.hoverEl.dataset.caVisible;
  }

  private renderTicks(): void {
    const w = this.width;
    while (this.labelsEl.firstChild) this.labelsEl.firstChild.remove();
    if (!(w > 0)) {
      this.minorPath.setAttribute('d', '');
      this.majorPath.setAttribute('d', '');
      return;
    }
    this.ticksSvg.setAttribute('viewBox', `0 0 ${w.toFixed(2)} 10`);
    const xOf = (y: number): number => this.frac(y) * w;
    const font = this.compact ? TICK_FONT.compact : TICK_FONT.regular;
    // Labels may reach into the side padding (not past the timeline's edge), so the
    // first and last labels can stay centred on their ticks.
    const overhang = Math.max(0, this.innerLeft - this.element.getBoundingClientRect().left - 2);
    const majors = layoutMajorTicks({
      min: this.min,
      max: this.max,
      width: w,
      xOf,
      labelWidth: (y) => estimateLabelWidth(this.labels.formatYear(y), font),
      anchors: this.scale.stops.map((s) => s[0]),
      minSpacing: MIN_LABEL_SPACING,
      overhang,
    });
    const majorYears = new Set(majors.map((t) => t.year));
    const minors = layoutMinorTicks({
      min: this.min,
      max: this.max,
      breaks: this.scale.stops.map((s) => s[0]),
      xOf,
      exclude: majorYears,
      ...(this.bar ? { minSpacing: BAR_MINOR_SPACING } : {}),
    });
    const [majTop, majBottom, minTop, minBottom] = this.bar ? TICK_GEOMETRY.bar : TICK_GEOMETRY.stacked;
    const line = (x: number, top: number, bottom: number): string => `M${x.toFixed(2)} ${top}V${bottom}`;
    this.majorPath.setAttribute('d', majors.map((t) => line(t.x, majTop, majBottom)).join(''));
    this.minorPath.setAttribute('d', minors.map((y) => line(xOf(y), minTop, minBottom)).join(''));
    // The bar shows the major ticks as lines only (placed as if labelled, so they stay regular).
    if (this.bar) return;

    const frag = this.doc.createDocumentFragment();
    for (const t of majors) {
      const label = this.h('span', 'ca-timeline__tick-label');
      label.style.left = `${((t.x / w) * 100).toFixed(4)}%`;
      label.dataset.year = String(t.year);
      const text = this.labels.formatYear(t.year);
      const m = ERA_SUFFIX.exec(text);
      if (m) {
        const num = this.h('span', 'ca-timeline__tick-num');
        num.textContent = m[1]!;
        const era = this.h('span', 'ca-timeline__tick-era');
        era.textContent = m[2]!;
        label.append(num, era);
      } else {
        label.textContent = text;
      }
      // Always centred on the tick: the layout only places labels that fit centred.
      frag.append(label);
    }
    this.labelsEl.append(frag);
  }

  /**
   * The change-density strip: a bar wherever borders change (one per 2 px bin), drawn
   * at one of three levels by how often they change there — changes per year within
   * ±DENSITY_RADIUS px, relative to the busiest stretches of the track. (Changes per
   * bin would mostly show where the scale compresses time, making the busy but
   * expanded recent centuries look quiet.)
   */
  private renderDensity(): void {
    if (this.bar) return; // the bar has no density strip
    const w = this.width;
    const empty = !(w > 0) || this.frames.length === 0;
    if (empty) {
      for (const p of this.densityPaths) p.setAttribute('d', '');
      return;
    }
    this.densitySvg.setAttribute('viewBox', `0 0 ${w.toFixed(2)} 10`);
    const bins = Math.max(1, Math.ceil(w / BIN_PX));
    const counts = new Uint16Array(bins);
    for (const f of this.frames) {
      const b = Math.min(bins - 1, Math.max(0, Math.floor((this.frac(f) * w) / BIN_PX)));
      counts[b] = counts[b]! + 1;
    }
    const prefix = new Uint32Array(bins + 1);
    for (let b = 0; b < bins; b++) prefix[b + 1] = prefix[b]! + counts[b]!;
    // Astronomical year at x px (continuous across the missing year 0).
    const astroAt = (x: number): number => astroOf(this.yearAtFrac(x / w));
    const radius = Math.max(1, Math.round(DENSITY_RADIUS / BIN_PX));
    const density = new Float64Array(bins);
    const observed: number[] = [];
    for (let b = 0; b < bins; b++) {
      if (!counts[b]) continue;
      const lo = Math.max(0, b - radius);
      const hi = Math.min(bins - 1, b + radius);
      const years = Math.max(1, astroAt(Math.min(w, (hi + 1) * BIN_PX)) - astroAt(lo * BIN_PX));
      density[b] = (prefix[hi + 1]! - prefix[lo]!) / years;
      observed.push(density[b]!);
    }
    // Reference: the 95th percentile, so one exceptional cluster does not flatten the rest.
    observed.sort((a, b) => a - b);
    const ref = observed[Math.floor(0.95 * (observed.length - 1))]!;
    // One path per level, drawn taller and brighter: ≥ ½ of the reference, ≥ ⅙, below.
    const heights = [4.5, 7.5, 10];
    const bar = 1.3;
    const d = ['', '', ''];
    for (let b = 0; b < bins; b++) {
      if (!counts[b]) continue;
      const v = density[b]!;
      const lvl = v >= ref / 2 ? 2 : v >= ref / 6 ? 1 : 0;
      const x = b * BIN_PX + (BIN_PX - bar) / 2;
      d[lvl] += `M${x.toFixed(2)} ${10 - heights[lvl]!}h${bar}V10h-${bar}z`;
    }
    this.densityPaths.forEach((p, i) => p.setAttribute('d', d[i]!));
  }

  private renderHighlight(): void {
    while (this.highlightsEl.firstChild) this.highlightsEl.firstChild.remove();
    const L = this.labels;
    const described = [this.ids.help];
    for (const s of this.spans) {
      const left = this.frac(s.from);
      const right = s.to >= this.max ? 1 : this.frac(addYears(s.to, 1));
      const band = this.h('div', 'ca-timeline__highlight');
      band.style.left = `${(left * 100).toFixed(4)}%`;
      band.style.width = `${(Math.max(0, right - left) * 100).toFixed(4)}%`;
      band.dataset.from = String(s.from);
      band.dataset.to = String(s.to);
      this.highlightsEl.append(band);
    }
    if (this.spans.length) {
      const text = this.spans.map((s) => `${L.formatYear(s.from)} – ${L.formatYear(s.to)}`).join(', ');
      this.highlightDesc.textContent = L.highlight(text);
      this.element.dataset.caHighlight = 'true';
      described.unshift(this.ids.highlight);
    } else {
      this.highlightDesc.textContent = '';
      delete this.element.dataset.caHighlight;
    }
    this.rangeEl.setAttribute('aria-describedby', described.join(' '));
  }

  private buildEras(eras: readonly TimelineEra[]): void {
    let alt = false;
    for (const era of eras) {
      const from = Math.max(this.min, era.from ?? this.min);
      const to = Math.min(this.max, era.to ?? this.max);
      if (!Number.isFinite(from) || !Number.isFinite(to) || from > to || !era.label) continue;
      const a = this.sanitize(from, this.min);
      const b = this.sanitize(to, this.max);
      const el = this.h('div', 'ca-timeline__era');
      const left = this.frac(a);
      const right = b >= this.max ? 1 : this.frac(addYears(b, 1));
      el.style.left = `${(left * 100).toFixed(4)}%`;
      el.style.width = `${(Math.max(0, right - left) * 100).toFixed(4)}%`;
      el.title = era.title ?? `${era.label} · ${this.labels.formatYear(a)} – ${this.labels.formatYear(b)}`;
      if (alt) el.dataset.caAlt = 'true';
      alt = !alt;
      const text = this.h('span', 'ca-timeline__era-label');
      text.textContent = era.label;
      el.append(text);
      this.erasEl!.append(el);
      this.eraSpans.push({ from: a, to: b, left, right, era, el, text, fitted: era.label });
    }
    // The current era's name, floated over its neighbours when it does not fit its segment.
    this.eraNow = this.h('span', 'ca-timeline__era-now');
    this.erasEl!.append(this.eraNow);
  }

  /** Estimated width (px) of an era label: 9 px capitals with letter-spacing, plus padding. */
  private static eraTextWidth(s: string): number {
    return s.length * 6.9 + 14;
  }

  private renderEraLabels(): void {
    const w = this.width;
    if (!(w > 0)) return;
    for (const s of this.eraSpans) {
      const px = (s.right - s.left) * w;
      const fits = (t: string): boolean => Timeline.eraTextWidth(t) <= px;
      s.fitted = fits(s.era.label) ? s.era.label : s.era.short && fits(s.era.short) ? s.era.short : '';
    }
    this.renderEraNow();
  }

  private renderCurrentEra(): void {
    const i = this.eraSpans.findIndex((s) => this.value >= s.from && this.value <= s.to);
    if (i === this.currentEra) return;
    if (this.currentEra >= 0) delete this.eraSpans[this.currentEra]?.el.dataset.caCurrent;
    if (i >= 0) this.eraSpans[i]!.el.dataset.caCurrent = 'true';
    this.currentEra = i;
    this.renderEraNow();
  }

  /**
   * Era labels: each segment shows its label when it fits. The current era is always
   * named — in place when its full label fits, otherwise by a floating label centred
   * on its segment and kept inside the track.
   */
  private renderEraNow(): void {
    const now = this.eraNow;
    if (!now) return;
    const w = this.width;
    const cur = this.eraSpans[this.currentEra];
    const float = !!cur && w > 0 && cur.fitted !== cur.era.label;
    for (const s of this.eraSpans) {
      const text = float && s === cur ? '' : s.fitted;
      if (s.text.textContent !== text) s.text.textContent = text;
    }
    if (!float || !cur) {
      delete now.dataset.caVisible;
      return;
    }
    const half = Timeline.eraTextWidth(cur.era.label) / 2;
    const centre = Math.min(Math.max(((cur.left + cur.right) / 2) * w, half), Math.max(half, w - half));
    now.textContent = cur.era.label;
    now.style.left = `${((centre / w) * 100).toFixed(4)}%`;
    now.dataset.caVisible = 'true';
  }

  // ------------------------------------------------------------------- helpers

  private h<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
    const e = this.doc.createElement(tag);
    e.className = cls;
    return e;
  }

  private svg(cls: string): SVGSVGElement {
    const s = this.doc.createElementNS(SVG_NS, 'svg');
    s.setAttribute('class', cls);
    s.setAttribute('aria-hidden', 'true');
    s.setAttribute('focusable', 'false');
    s.setAttribute('preserveAspectRatio', 'none');
    return s;
  }

  private button(cls: string, icon: string, label: string, title: string): HTMLButtonElement {
    const b = this.h('button', cls);
    b.type = 'button';
    if (icon) b.innerHTML = icon;
    if (label) b.setAttribute('aria-label', label);
    if (title) b.title = title;
    return b;
  }
}
