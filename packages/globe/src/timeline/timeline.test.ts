// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// The timeline imports its year helpers from @alexs-atlas/borders. Use the built
// package when it resolves (as in `npm run check`, after `tsc -b`); otherwise fall
// back to the package's TypeScript sources so the tests also run before a build.
// (A non-literal specifier keeps tsc from pulling those sources into this project.)
vi.mock('@alexs-atlas/borders', async (importOriginal) => {
  try {
    return await importOriginal();
  } catch {
    const sources = '../../../borders/src/index.js';
    return (await import(/* @vite-ignore */ sources)) as Record<string, unknown>;
  }
});

import { DEFAULT_TIMELINE_LABELS } from './labels.js';
import { createTimeScale, DEFAULT_STOPS } from './scale.js';
import { Timeline, type TimelineOptions } from './timeline.js';

const MIN = -3400;
const MAX = 2026;
const FRAMES = [-3400, -2000, -1200, -500, 1, 1453, 1500, 1900, 1914, 1945, 2000, 2025];
const scale = createTimeScale(DEFAULT_STOPS);

// Track geometry used when layout is stubbed: the track starts 20 px into the page.
const TRACK_LEFT = 20;

interface Harness {
  tl: Timeline;
  container: HTMLDivElement;
  root: HTMLElement;
  range: HTMLInputElement;
  year: HTMLInputElement;
  scaleEl: HTMLElement;
  onInput: ReturnType<typeof vi.fn>;
  onChange: ReturnType<typeof vi.fn>;
  onPlayChange: ReturnType<typeof vi.fn>;
  $<T extends Element = HTMLElement>(sel: string): T;
  $$<T extends Element = HTMLElement>(sel: string): T[];
}

const live: Timeline[] = [];

function setup(opts: Partial<TimelineOptions> = {}): Harness {
  const container = document.createElement('div');
  document.body.append(container);
  const onInput = vi.fn();
  const onChange = vi.fn();
  const onPlayChange = vi.fn();
  const tl = new Timeline(container, { min: MIN, max: MAX, value: 1453, frames: FRAMES, onInput, onChange, onPlayChange, ...opts });
  live.push(tl);
  const root = container.firstElementChild as HTMLElement;
  const $ = <T extends Element = HTMLElement>(sel: string): T => {
    const el = root.querySelector<T>(sel);
    if (!el) throw new Error(`missing ${sel}`);
    return el;
  };
  const $$ = <T extends Element = HTMLElement>(sel: string): T[] => [...root.querySelectorAll<T>(sel)];
  return {
    tl,
    container,
    root,
    range: $<HTMLInputElement>('.ca-timeline__range'),
    year: $<HTMLInputElement>('.ca-timeline__year-input'),
    scaleEl: $('.ca-timeline__scale'),
    onInput,
    onChange,
    onPlayChange,
    $,
    $$,
  };
}

function rect(left: number, width: number): DOMRect {
  return { left, width, x: left, y: 0, top: 0, bottom: 60, right: left + width, height: 60, toJSON: () => ({}) } as DOMRect;
}

/** Makes the track `trackWidth` px wide (root 40 px wider) and re-lays out the timeline. */
function stubLayout(tl: Timeline, trackWidth = 1000, rootWidth = trackWidth + 40): void {
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.classList.contains('ca-timeline__inner')) return rect(TRACK_LEFT, trackWidth);
    if (this.classList.contains('ca-timeline')) return rect(0, rootWidth);
    return rect(0, 0);
  });
  tl.resize();
}

/** clientX of a year on a stubbed 1000 px track. */
const clientXOf = (year: number, trackWidth = 1000): number => TRACK_LEFT + scale.toT(year) * trackWidth;

function press(el: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const down = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  el.dispatchEvent(down);
  el.dispatchEvent(new KeyboardEvent('keyup', { key, bubbles: true, cancelable: true, ...init }));
  return down;
}

// jsdom has no PointerEvent: a MouseEvent with the pointer fields the component reads.
function pointer(target: Element, type: string, clientX: number, init: { pointerId?: number; pointerType?: string; button?: number } = {}): MouseEvent {
  const e = new MouseEvent(type, { bubbles: true, cancelable: true, clientX, button: init.button ?? 0 });
  Object.defineProperty(e, 'pointerId', { value: init.pointerId ?? 1 });
  Object.defineProperty(e, 'pointerType', { value: init.pointerType ?? 'mouse' });
  target.dispatchEvent(e);
  return e;
}

function typeYear(h: Harness, text: string, key = 'Enter'): void {
  h.year.focus();
  h.year.value = text;
  h.year.dispatchEvent(new Event('input', { bubbles: true }));
  press(h.year, key);
}

const calls = (fn: ReturnType<typeof vi.fn>): unknown[] => fn.mock.calls.map((c) => c[0]);

afterEach(() => {
  while (live.length) live.pop()!.destroy();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
  vi.useRealTimers();
});

// ------------------------------------------------------------------------------

describe('DOM and accessibility', () => {
  it('renders one .ca-timeline root using only ca-timeline classes', () => {
    const h = setup();
    expect(h.container.children).toHaveLength(1);
    expect(h.root.className).toBe('ca-timeline');
    expect(h.root.getAttribute('role')).toBe('group');
    expect(h.root.getAttribute('aria-label')).toBe('Timeline');
    expect(h.root.getAttribute('dir')).toBe('ltr');
    for (const el of h.$$('[class]')) {
      for (const cls of (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)) {
        expect(cls.startsWith('ca-timeline')).toBe(true);
      }
    }
  });

  it('exposes the year on a native range input', () => {
    const h = setup();
    expect(h.range.type).toBe('range');
    expect(h.range.min).toBe('-3400');
    expect(h.range.max).toBe('2026');
    expect(h.range.step).toBe('1');
    expect(h.range.value).toBe('1453');
    expect(h.range.getAttribute('aria-valuenow')).toBe('1453');
    expect(h.range.getAttribute('aria-valuetext')).toBe('1453 CE');
    expect(h.range.getAttribute('aria-label')).toBe('Year');
    const help = document.getElementById(h.range.getAttribute('aria-describedby')!.split(' ').at(-1)!);
    expect(help?.textContent).toMatch(/Arrow keys/);
    expect(h.year.value).toBe('1453');
  });

  it('setValue updates every view of the year without calling back', () => {
    const h = setup();
    h.tl.setValue(-500);
    expect(h.tl.getValue()).toBe(-500);
    expect(h.range.value).toBe('-500');
    expect(h.range.getAttribute('aria-valuenow')).toBe('-500');
    expect(h.range.getAttribute('aria-valuetext')).toBe('500 BCE');
    expect(h.year.value).toBe('500 BCE');
    h.tl.setValue(33);
    expect(h.year.value).toBe('33 CE');
    expect(h.range.getAttribute('aria-valuetext')).toBe('33 CE');
    expect(h.onInput).not.toHaveBeenCalled();
    expect(h.onChange).not.toHaveBeenCalled();
  });

  it('never holds year 0 and clamps to the range', () => {
    const h = setup();
    h.tl.setValue(0);
    expect(h.tl.getValue()).toBe(1);
    h.tl.setValue(-0.3);
    expect(h.tl.getValue()).toBe(-1);
    h.tl.setValue(99999);
    expect(h.tl.getValue()).toBe(MAX);
    h.tl.setValue(-99999);
    expect(h.tl.getValue()).toBe(MIN);
    h.tl.setValue(Number.NaN);
    expect(h.tl.getValue()).toBe(MIN);
    expect(setup({ value: 0 }).tl.getValue()).toBe(1);
  });

  it('validates its range', () => {
    const c = document.createElement('div');
    expect(() => new Timeline(c, { min: 0, max: 10, value: 1 })).toThrow(RangeError);
    expect(() => new Timeline(c, { min: 10, max: 10, value: 10 })).toThrow(RangeError);
    expect(() => new Timeline(c, { min: 1.5, max: 10, value: 2 })).toThrow(RangeError);
    expect(() => new Timeline(c, { min: 1, max: 10, value: 2, stops: [[5, 1], [1, 0]] })).toThrow(RangeError);
  });

  it('accepts labels for other languages', () => {
    const h = setup({ labels: { slider: 'Jahr', play: 'Abspielen', spokenYear: (y) => `Jahr ${y}`, pause: undefined } });
    expect(h.range.getAttribute('aria-label')).toBe('Jahr');
    expect(h.range.getAttribute('aria-valuetext')).toBe('Jahr 1453');
    expect(h.$('.ca-timeline__btn--play').getAttribute('aria-label')).toBe('Abspielen');
    // An override left undefined keeps the default.
    h.tl.play();
    expect(h.$('.ca-timeline__btn--play').getAttribute('aria-label')).toBe('Pause');
    h.tl.pause();
  });
});

describe('keyboard', () => {
  it('←/→ and ↑/↓ move one year and skip year 0', () => {
    const h = setup({ value: -1 });
    press(h.range, 'ArrowRight');
    expect(h.tl.getValue()).toBe(1);
    press(h.range, 'ArrowLeft');
    expect(h.tl.getValue()).toBe(-1);
    press(h.range, 'ArrowUp');
    expect(h.tl.getValue()).toBe(1);
    press(h.range, 'ArrowDown');
    expect(h.tl.getValue()).toBe(-1);
    expect(calls(h.onInput)).toEqual([1, -1, 1, -1]);
    expect(calls(h.onChange)).toEqual([1, -1, 1, -1]);
    expect(h.range.getAttribute('aria-valuetext')).toBe('1 BCE');
  });

  it('Shift+arrows move ten years (still skipping 0)', () => {
    const h = setup();
    press(h.range, 'ArrowRight', { shiftKey: true });
    expect(h.tl.getValue()).toBe(1463);
    h.tl.setValue(5);
    press(h.range, 'ArrowLeft', { shiftKey: true });
    expect(h.tl.getValue()).toBe(-6);
  });

  it('PageUp/PageDown move by the adaptive step onto round years', () => {
    const h = setup();
    press(h.range, 'PageUp');
    expect(h.tl.getValue()).toBe(1500);
    h.tl.setValue(1453);
    press(h.range, 'PageDown');
    expect(h.tl.getValue()).toBe(1450);
    h.tl.setValue(2000);
    press(h.range, 'PageUp');
    expect(h.tl.getValue()).toBe(2005);
    h.tl.setValue(-2000);
    press(h.range, 'PageDown');
    expect(h.tl.getValue()).toBe(-2200);
    h.tl.setValue(-100);
    press(h.range, 'PageUp');
    expect(h.tl.getValue()).toBe(1);
  });

  it('Home/End jump to the ends', () => {
    const h = setup();
    press(h.range, 'Home');
    expect(h.tl.getValue()).toBe(MIN);
    press(h.range, 'End');
    expect(h.tl.getValue()).toBe(MAX);
    expect(calls(h.onChange)).toEqual([MIN, MAX]);
  });

  it('[ and ] jump to the previous and next border change', () => {
    const h = setup();
    press(h.range, ']');
    expect(h.tl.getValue()).toBe(1500);
    press(h.range, '[');
    press(h.range, '[');
    expect(h.tl.getValue()).toBe(1);
    h.tl.setValue(MIN);
    h.onInput.mockClear();
    const e = press(h.range, '[');
    expect(e.defaultPrevented).toBe(true);
    expect(h.onInput).not.toHaveBeenCalled();
  });

  it('Space and K toggle playback', () => {
    vi.useFakeTimers();
    const h = setup();
    const e = press(h.range, ' ');
    expect(e.defaultPrevented).toBe(true);
    expect(h.tl.isPlaying()).toBe(true);
    press(h.range, ' ');
    expect(h.tl.isPlaying()).toBe(false);
    press(h.range, 'k');
    expect(h.tl.isPlaying()).toBe(true);
    press(h.range, 'K');
    expect(h.tl.isPlaying()).toBe(false);
    expect(calls(h.onPlayChange)).toEqual([true, false, true, false]);
  });

  it('commits once per key press: auto-repeat fires onInput live and onChange on release', () => {
    const h = setup();
    const down = (repeat: boolean): void => {
      h.range.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', repeat, bubbles: true, cancelable: true }));
    };
    down(false);
    down(true);
    down(true);
    down(true);
    expect(calls(h.onInput)).toEqual([1454, 1455, 1456, 1457]);
    expect(calls(h.onChange)).toEqual([1454]);
    h.range.dispatchEvent(new KeyboardEvent('keyup', { key: 'ArrowRight', bubbles: true }));
    expect(calls(h.onChange)).toEqual([1454, 1457]);
  });

  it('leaves modified keys to the browser', () => {
    const h = setup();
    const e = press(h.range, 'ArrowRight', { ctrlKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(h.tl.getValue()).toBe(1453);
  });

  it('[ ] and K also work while another timeline control has focus', () => {
    const h = setup();
    const play = h.$('.ca-timeline__btn--play');
    play.focus();
    press(play, ']');
    expect(h.tl.getValue()).toBe(1500);
  });

  it('assistive-technology increments skip year 0', () => {
    const h = setup({ value: -1 });
    h.range.value = '0';
    h.range.dispatchEvent(new Event('input', { bubbles: true }));
    expect(h.tl.getValue()).toBe(1);
    expect(h.range.value).toBe('1');
    h.range.dispatchEvent(new Event('change', { bubbles: true }));
    expect(calls(h.onInput)).toEqual([1]);
    expect(calls(h.onChange)).toEqual([1]);
    h.range.value = '0';
    h.range.dispatchEvent(new Event('input', { bubbles: true }));
    expect(h.tl.getValue()).toBe(-1);
  });
});

describe('typed year (parseYear semantics)', () => {
  it.each([
    ['1453', 1453, '1453'],
    ['-500', -500, '500 BCE'],
    ['500 BC', -500, '500 BCE'],
    ['AD 33', 33, '33 CE'],
    ['  2,000  ', 2000, '2000'],
  ])('applies %j on Enter', (text, year, shown) => {
    const h = setup({ value: 1900 });
    typeYear(h, text);
    expect(h.tl.getValue()).toBe(year);
    expect(h.year.value).toBe(shown);
    expect(calls(h.onInput)).toEqual([year]);
    expect(calls(h.onChange)).toEqual([year]);
    expect(h.year.getAttribute('aria-invalid')).toBeNull();
  });

  it.each(['0', 'abc', '3500 BC', '2100', '1453.5', '', '-500 BC'])('rejects %j with an error state', (text) => {
    const h = setup();
    typeYear(h, text);
    expect(h.tl.getValue()).toBe(1453);
    expect(h.onInput).not.toHaveBeenCalled();
    expect(h.year.getAttribute('aria-invalid')).toBe('true');
    expect(h.$('.ca-timeline__year').dataset.caInvalid).toBe('true');
    const error = h.$('.ca-timeline__year-error');
    expect(error.hidden).toBe(false);
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('3400 BCE');
    expect(error.textContent).toContain('2026');
    expect(h.year.getAttribute('aria-describedby')).toBe(error.id);
  });

  it('editing clears the error; Escape reverts and only then stops propagation', () => {
    const h = setup();
    const outer = vi.fn();
    h.container.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') outer();
    });
    typeYear(h, 'nonsense');
    expect(h.year.getAttribute('aria-invalid')).toBe('true');
    h.year.value = 'nonsense!';
    h.year.dispatchEvent(new Event('input', { bubbles: true }));
    expect(h.year.getAttribute('aria-invalid')).toBeNull();
    press(h.year, 'Escape');
    expect(h.year.value).toBe('1453');
    expect(outer).not.toHaveBeenCalled();
    // Nothing left to revert: Escape reaches the host (e.g. to close a panel).
    press(h.year, 'Escape');
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('blur applies a valid edit and reverts an invalid one', () => {
    const h = setup();
    h.year.focus();
    h.year.value = '1066';
    h.year.dispatchEvent(new Event('input', { bubbles: true }));
    h.year.blur();
    expect(h.tl.getValue()).toBe(1066);
    expect(calls(h.onChange)).toEqual([1066]);
    h.year.focus();
    h.year.value = 'soon';
    h.year.dispatchEvent(new Event('input', { bubbles: true }));
    h.year.blur();
    expect(h.tl.getValue()).toBe(1066);
    expect(h.year.value).toBe('1066');
  });

  it('keeps what the user is typing while the value changes', () => {
    const h = setup();
    h.year.focus();
    h.year.value = '17';
    h.year.dispatchEvent(new Event('input', { bubbles: true }));
    h.tl.setValue(1800);
    expect(h.year.value).toBe('17');
  });
});

describe('buttons', () => {
  it('step buttons show the adaptive step and land on round years', () => {
    const h = setup();
    const back = h.$<HTMLButtonElement>('.ca-timeline__btn--back');
    const fwd = h.$<HTMLButtonElement>('.ca-timeline__btn--fwd');
    expect(back.getAttribute('aria-label')).toBe('Back 50 years');
    expect(fwd.getAttribute('aria-label')).toBe('Forward 50 years');
    expect(fwd.textContent).toBe('50');
    fwd.click();
    expect(h.tl.getValue()).toBe(1500);
    expect(fwd.getAttribute('aria-label')).toBe('Forward 20 years');
    expect(back.getAttribute('aria-label')).toBe('Back 50 years');
    h.tl.setValue(2000);
    expect(fwd.getAttribute('aria-label')).toBe('Forward 5 years');
    back.click();
    expect(h.tl.getValue()).toBe(1995);
    expect(calls(h.onChange)).toEqual([1500, 1995]);
  });

  it('previous/next change buttons follow the frames', () => {
    const h = setup();
    const prev = h.$<HTMLButtonElement>('.ca-timeline__btn--change');
    const next = h.$$<HTMLButtonElement>('.ca-timeline__btn--change')[1]!;
    expect(prev.getAttribute('aria-label')).toBe('Previous border change');
    next.click();
    expect(h.tl.getValue()).toBe(1500);
    prev.click();
    expect(h.tl.getValue()).toBe(1453);
    h.tl.setValue(MAX);
    expect(next.getAttribute('aria-disabled')).toBe('true');
    next.click();
    expect(h.tl.getValue()).toBe(MAX);
    h.tl.setValue(MIN);
    expect(prev.getAttribute('aria-disabled')).toBe('true');
    expect(next.getAttribute('aria-disabled')).toBeNull();
  });

  it('hides the change buttons without frames and shows them after setFrames', () => {
    const h = setup({ frames: null });
    expect(h.root.dataset.caNoFrames).toBe('true');
    expect(h.tl.stepChange(1)).toBeNull();
    h.tl.setFrames([1600, 1700]);
    expect(h.root.dataset.caNoFrames).toBeUndefined();
    expect(h.tl.stepChange(1)).toBe(1600);
  });

  it('disables stepping past the ends without losing focus', () => {
    const h = setup({ value: MAX });
    const fwd = h.$<HTMLButtonElement>('.ca-timeline__btn--fwd');
    expect(fwd.getAttribute('aria-disabled')).toBe('true');
    expect(fwd.disabled).toBe(false);
    fwd.click();
    expect(h.onInput).not.toHaveBeenCalled();
  });
});

describe('playback', () => {
  it('moves at constant track speed: a full sweep takes 120 s at 1×', () => {
    vi.useFakeTimers();
    const h = setup({ value: 1900 });
    h.tl.play();
    expect(h.root.dataset.caPlaying).toBe('true');
    expect(h.$('.ca-timeline__btn--play').getAttribute('aria-label')).toBe('Pause');
    vi.advanceTimersByTime(12_000);
    // 12 s = 10 % of the track: from t 0.80 (1900) to t 0.90.
    expect(Math.abs(h.tl.getValue() - scale.toYear(0.9))).toBeLessThanOrEqual(1);
    const years = calls(h.onInput) as number[];
    expect(years.length).toBeGreaterThan(50);
    expect(years.every((y, i) => i === 0 || y > years[i - 1]!)).toBe(true);
    expect(h.onChange).not.toHaveBeenCalled();
    h.tl.pause();
    expect(calls(h.onChange)).toEqual([h.tl.getValue()]);
    expect(calls(h.onPlayChange)).toEqual([true, false]);
    expect(h.root.dataset.caPlaying).toBe('false');
  });

  it('speed multiplies the pace (0.25–4×)', () => {
    vi.useFakeTimers();
    const h = setup({ value: -3000 });
    h.tl.setSpeed(2);
    expect((h.$<HTMLSelectElement>('.ca-timeline__speed-select')).value).toBe('2');
    h.tl.play();
    vi.advanceTimersByTime(6_000);
    const expected = scale.toYear(scale.toT(-3000) + 0.1);
    expect(Math.abs(h.tl.getValue() - expected)).toBeLessThanOrEqual(25); // ≈ 22 years per pixel-frame here
    h.tl.setSpeed(10);
    expect(h.tl.getSpeed()).toBe(4);
    h.tl.setSpeed(0.1);
    expect(h.tl.getSpeed()).toBe(0.25);
  });

  it('the speed menu changes the speed', () => {
    const h = setup();
    const select = h.$<HTMLSelectElement>('.ca-timeline__speed-select');
    expect([...select.options].map((o) => o.value)).toEqual(['0.5', '1', '2', '4']);
    select.value = '4';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.tl.getSpeed()).toBe(4);
  });

  it('takes the speed menu from `speeds` (the site: 0.25×–2×)', () => {
    const h = setup({ speeds: [2, 0.25, 1, 0.5, 0.1] });
    const select = h.$<HTMLSelectElement>('.ca-timeline__speed-select');
    // Sorted, clamped (0.1 → 0.25), de-duplicated; the current speed (1) is among them.
    expect([...select.options].map((o) => o.value)).toEqual(['0.25', '0.5', '1', '2']);
    expect([...select.options].map((o) => o.textContent)).toEqual(['0.25×', '0.5×', '1×', '2×']);
    expect(select.value).toBe('1');
    select.value = '0.25';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    expect(h.tl.getSpeed()).toBe(0.25);
  });

  it('stops at the end and commits', () => {
    vi.useFakeTimers();
    const h = setup({ value: 2020 });
    h.tl.play();
    vi.advanceTimersByTime(30_000);
    expect(h.tl.getValue()).toBe(MAX);
    expect(h.tl.isPlaying()).toBe(false);
    expect(calls(h.onChange)).toEqual([MAX]);
    expect(calls(h.onPlayChange)).toEqual([true, false]);
  });

  it('restarts from the beginning when played at the end', () => {
    vi.useFakeTimers();
    const h = setup({ value: MAX });
    h.tl.play();
    expect(h.tl.getValue()).toBe(MIN);
    expect(calls(h.onInput)[0]).toBe(MIN);
  });

  it('continues from where the user seeks', () => {
    vi.useFakeTimers();
    const h = setup({ value: 1900 });
    h.tl.play();
    vi.advanceTimersByTime(1_000);
    press(h.range, 'Home');
    expect(h.tl.getValue()).toBe(MIN);
    expect(h.tl.isPlaying()).toBe(true);
    vi.advanceTimersByTime(12_000);
    expect(Math.abs(h.tl.getValue() - scale.toYear(0.1))).toBeLessThanOrEqual(25);
  });

  it('respects prefers-reduced-motion: calmer jumps at the same average pace', () => {
    vi.useFakeTimers();
    vi.stubGlobal('matchMedia', (q: string) => ({
      matches: q.includes('reduce'),
      media: q,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    try {
      const h = setup({ value: 1900 });
      h.tl.play();
      vi.advanceTimersByTime(400);
      expect(h.onInput).not.toHaveBeenCalled();
      vi.advanceTimersByTime(300);
      expect(h.onInput).toHaveBeenCalledTimes(1);
      vi.advanceTimersByTime(11_300);
      expect(Math.abs(h.tl.getValue() - scale.toYear(0.9))).toBeLessThanOrEqual(3);
      expect(h.onInput.mock.calls.length).toBeLessThanOrEqual(25);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('pointer scrubbing', () => {
  it('click-to-jump: onInput on the next frame, onChange on release, focus on the slider', () => {
    vi.useFakeTimers();
    const h = setup();
    stubLayout(h.tl);
    pointer(h.scaleEl, 'pointerdown', clientXOf(1800));
    expect(h.onInput).not.toHaveBeenCalled();
    vi.advanceTimersByTime(20);
    expect(calls(h.onInput)).toEqual([1800]);
    expect(document.activeElement).toBe(h.range);
    expect(h.root.dataset.caDragging).toBe('true');
    pointer(h.scaleEl, 'pointerup', clientXOf(1800));
    expect(calls(h.onChange)).toEqual([1800]);
    expect(h.root.dataset.caDragging).toBeUndefined();
  });

  it('dragging coalesces moves to one onInput per animation frame', () => {
    vi.useFakeTimers();
    const h = setup();
    stubLayout(h.tl);
    pointer(h.scaleEl, 'pointerdown', clientXOf(1453)); // on the thumb: no jump
    pointer(h.scaleEl, 'pointermove', clientXOf(1850));
    pointer(h.scaleEl, 'pointermove', clientXOf(1880));
    pointer(h.scaleEl, 'pointermove', clientXOf(1900));
    vi.advanceTimersByTime(20);
    expect(calls(h.onInput)).toEqual([1900]);
    pointer(h.scaleEl, 'pointermove', clientXOf(1950));
    pointer(h.scaleEl, 'pointerup', clientXOf(1950));
    // The pending move is flushed before the release commits.
    expect(calls(h.onInput)).toEqual([1900, 1950]);
    expect(calls(h.onChange)).toEqual([1950]);
  });

  it('grabbing the thumb off-centre does not make it jump', () => {
    vi.useFakeTimers();
    const h = setup({ value: -2000 });
    stubLayout(h.tl);
    // 6 px right of the thumb is ≈ 130 years here; grabbing keeps the year.
    pointer(h.scaleEl, 'pointerdown', clientXOf(-2000) + 6);
    vi.advanceTimersByTime(20);
    expect(h.onInput).not.toHaveBeenCalled();
    pointer(h.scaleEl, 'pointerup', clientXOf(-2000) + 6);
    expect(h.onChange).not.toHaveBeenCalled();
  });

  it('gives touch a 44 px thumb: a touch within 22 px grabs it, one farther out jumps', () => {
    vi.useFakeTimers();
    const h = setup({ value: 1800 });
    stubLayout(h.tl);
    const x = clientXOf(1800); // ≈ 0.7 years per pixel here
    pointer(h.scaleEl, 'pointerdown', x - 21, { pointerType: 'touch' });
    vi.advanceTimersByTime(20);
    pointer(h.scaleEl, 'pointerup', x - 21, { pointerType: 'touch' });
    expect(h.onInput).not.toHaveBeenCalled();
    expect(h.tl.getValue()).toBe(1800);
    pointer(h.scaleEl, 'pointerdown', x + 30, { pointerType: 'touch', pointerId: 2 });
    vi.advanceTimersByTime(20);
    pointer(h.scaleEl, 'pointerup', x + 30, { pointerType: 'touch', pointerId: 2 });
    expect(h.tl.getValue()).toBe(scale.toYear(scale.toT(1800) + 30 / 1000));
    // A mouse is precise: its grab zone is 10 px.
    const y = h.tl.getValue();
    pointer(h.scaleEl, 'pointerdown', clientXOf(y) + 14);
    pointer(h.scaleEl, 'pointerup', clientXOf(y) + 14);
    expect(h.tl.getValue()).toBeGreaterThan(y);
  });

  it('rounds to a round year where one pixel spans many years', () => {
    vi.useFakeTimers();
    const h = setup();
    stubLayout(h.tl);
    pointer(h.scaleEl, 'pointerdown', TRACK_LEFT + 37.3); // ≈ 22 years per pixel here
    pointer(h.scaleEl, 'pointerup', TRACK_LEFT + 37.3);
    const y = h.tl.getValue();
    expect(y).toBeLessThan(0);
    expect(y % 20 === 0).toBe(true);
    expect(Math.abs(scale.toT(y) * 1000 - 37.3)).toBeLessThan(0.6);
  });

  it('shows the year under a hovering mouse', () => {
    const h = setup();
    stubLayout(h.tl);
    const hover = h.$('.ca-timeline__hover');
    pointer(h.scaleEl, 'pointermove', clientXOf(1914));
    expect(hover.dataset.caVisible).toBe('hover');
    expect(h.$('.ca-timeline__bubble').textContent).toBe('1914');
    expect(h.onInput).not.toHaveBeenCalled();
    h.scaleEl.dispatchEvent(new MouseEvent('pointerleave'));
    expect(hover.dataset.caVisible).toBeUndefined();
  });

  it('ignores secondary mouse buttons', () => {
    vi.useFakeTimers();
    const h = setup();
    stubLayout(h.tl);
    pointer(h.scaleEl, 'pointerdown', clientXOf(1800), { button: 2 });
    vi.advanceTimersByTime(20);
    expect(h.onInput).not.toHaveBeenCalled();
  });
});

describe('highlight', () => {
  const pct = (el: HTMLElement, prop: 'left' | 'width'): number => parseFloat(el.style[prop]);

  it('draws the lifespan band of a span, inclusive of its last year', () => {
    const h = setup();
    h.tl.setHighlight({ from: 1299, to: 1922 });
    const bands = h.$$('.ca-timeline__highlight');
    expect(bands).toHaveLength(1);
    expect(pct(bands[0]!, 'left')).toBeCloseTo(scale.toT(1299) * 100, 3);
    expect(pct(bands[0]!, 'width')).toBeCloseTo((scale.toT(1923) - scale.toT(1299)) * 100, 3);
    expect(h.root.dataset.caHighlight).toBe('true');
    const desc = document.getElementById(h.range.getAttribute('aria-describedby')!.split(' ')[0]!);
    expect(desc?.textContent).toBe('Highlighted on the timeline: 1299 – 1922');
  });

  it('takes several spans, clamps them and drops ones outside the range', () => {
    const h = setup({ highlight: [{ from: -5000, to: -3000 }, { from: 1922, to: 1299 }, { from: 2100, to: 2200 }] });
    const bands = h.$$('.ca-timeline__highlight');
    expect(bands).toHaveLength(2);
    expect(pct(bands[0]!, 'left')).toBe(0);
    expect(bands[1]!.dataset.from).toBe('1299');
    expect(bands[1]!.dataset.to).toBe('1922');
    h.tl.setHighlight(null);
    expect(h.$$('.ca-timeline__highlight')).toHaveLength(0);
    expect(h.root.dataset.caHighlight).toBeUndefined();
    expect(h.range.getAttribute('aria-describedby')!.split(' ')).toHaveLength(1);
  });

  it('runs to the end of the track for a polity alive at present', () => {
    const h = setup({ highlight: { from: 1923, to: MAX } });
    const band = h.$('.ca-timeline__highlight');
    expect(pct(band, 'left') + pct(band, 'width')).toBeCloseTo(100, 6);
  });
});

describe('layout', () => {
  it('renders labelled ticks at least 56 px apart once measured', () => {
    const h = setup();
    expect(h.$$('.ca-timeline__tick-label')).toHaveLength(0); // jsdom: 0 px until measured
    stubLayout(h.tl, 1000);
    const labels = h.$$('.ca-timeline__tick-label');
    expect(labels.length).toBeGreaterThanOrEqual(10);
    const xs = labels.map((l) => parseFloat(l.style.left) * 10);
    for (let i = 1; i < xs.length; i++) expect(xs[i]! - xs[i - 1]!).toBeGreaterThanOrEqual(56);
    const years = labels.map((l) => Number(l.dataset.year));
    expect(years).not.toContain(0);
    const ce = labels.find((l) => l.dataset.year === '1')!;
    expect(ce.querySelector('.ca-timeline__tick-era')?.textContent).toBe('CE');
    expect(h.$('.ca-timeline__ticks-minor').getAttribute('d')).toMatch(/^M/);
  });

  it('recomputes ticks and the compact layout on resize', () => {
    const h = setup();
    stubLayout(h.tl, 1000, 1040);
    const wide = h.$$('.ca-timeline__tick-label').length;
    expect(h.root.dataset.caCompact).toBeUndefined();
    vi.restoreAllMocks();
    stubLayout(h.tl, 340, 370);
    expect(h.$$('.ca-timeline__tick-label').length).toBeLessThan(wide);
    expect(h.root.dataset.caCompact).toBe('true');
  });

  it('draws the change-density strip: a bar where borders change, levelled by changes per year', () => {
    // 1914–1918 change every year; 1500 is a lone change and -2000 one in a compressed
    // stretch (≈ 16 years per pixel), which per-pixel counting would have made look busy.
    const h = setup({ frames: [-2010, -2000, -1990, 1500, 1914, 1915, 1916, 1917, 1918] });
    stubLayout(h.tl, 1000);
    const bars = h.$$('.ca-timeline__density-bars').map((p) =>
      [...(p.getAttribute('d') ?? '').matchAll(/M([\d.]+) /g)].map((m) => Number(m[1])),
    );
    const near = (year: number) => (x: number) => Math.abs(x - scale.toT(year) * 1000) < 3;
    // Level 3 (tallest): only the yearly changes of 1914–1918, one bar per 2 px bin.
    expect(bars[2]!.length).toBeGreaterThanOrEqual(3);
    expect(bars[2]!.every((x) => x > scale.toT(1913) * 1000 && x < scale.toT(1919) * 1000)).toBe(true);
    // Level 1: the sparse changes, even where several share a pixel (-2010…-1990).
    expect(bars[0]!.some(near(1500))).toBe(true);
    expect(bars[0]!.some(near(-2000))).toBe(true);
    expect(bars[1]).toEqual([]);
    h.tl.setFrames([]);
    expect(h.$$('.ca-timeline__density-bars').every((p) => !p.getAttribute('d'))).toBe(true);
  });

  it('shows the era band and marks the current era', () => {
    const h = setup();
    stubLayout(h.tl, 1000);
    const eras = h.$$('.ca-timeline__era');
    expect(eras).toHaveLength(6);
    const current = (): string | null | undefined => h.root.querySelector('[data-ca-current] .ca-timeline__era-label')?.textContent;
    expect(current()).toBe('Early modern');
    h.tl.setValue(1000);
    expect(current()).toBe('Post-classical');
    h.tl.setValue(-3400);
    expect(current()).toBe('Early civilizations');
    expect(eras[0]!.title).toBe('Early civilizations · to c. 600 BCE');
  });

  it('always names the current era, floating its label when the segment is too narrow', () => {
    const h = setup();
    stubLayout(h.tl, 340, 370);
    const now = h.$('.ca-timeline__era-now');
    // 1453 is in "Early modern", a 49 px segment on a 340 px track: too narrow for the label.
    expect(now.dataset.caVisible).toBe('true');
    expect(now.textContent).toBe('Early modern');
    const left = parseFloat(now.style.left);
    expect(left).toBeGreaterThan(0);
    expect(left).toBeLessThan(100);
    // No abbreviations by default: segments either show their whole label or nothing.
    const texts = h.$$('.ca-timeline__era-label').map((e) => e.textContent);
    for (const t of texts) expect(['', 'Early civilizations', 'Classical', 'Post-classical', 'Industrial', 'Contemporary']).toContain(t);
    // The floating label stays inside the track at the ends.
    h.tl.setValue(2020);
    const est = 'Contemporary'.length * 6.9 + 14;
    expect(parseFloat(now.style.left)).toBeLessThanOrEqual(((340 - est / 2) / 340) * 100 + 1e-6);
    // On a wide track every label fits in place and nothing floats.
    vi.restoreAllMocks();
    stubLayout(h.tl, 1200, 1240);
    expect(now.dataset.caVisible).toBeUndefined();
    expect(h.root.querySelector('[data-ca-current] .ca-timeline__era-label')?.textContent).toBe('Contemporary');
  });

  it('marks small phones as narrow (step sizes hidden from the buttons)', () => {
    const h = setup();
    stubLayout(h.tl, 330, 360);
    expect(h.root.dataset.caCompact).toBe('true');
    expect(h.root.dataset.caNarrow).toBe('true');
    expect(h.$('.ca-timeline__btn--fwd').getAttribute('aria-label')).toBe('Forward 50 years');
    expect(h.root.dataset.caTiny).toBeUndefined(); // a 360 px phone keeps the speed menu
    vi.restoreAllMocks();
    stubLayout(h.tl, 292, 320); // a 320 px phone hides the speed menu as well
    expect(h.root.dataset.caNarrow).toBe('true');
    expect(h.root.dataset.caTiny).toBe('true');
    vi.restoreAllMocks();
    stubLayout(h.tl, 362, 390); // a 390 px phone keeps the step sizes
    expect(h.root.dataset.caCompact).toBe('true');
    expect(h.root.dataset.caNarrow).toBeUndefined();
    expect(h.root.dataset.caTiny).toBeUndefined();
  });

  it('takes custom eras or none', () => {
    const custom = setup({ eras: [{ from: 1500, to: 1800, label: 'Test era' }] });
    expect(custom.$$('.ca-timeline__era')).toHaveLength(1);
    expect(custom.$('.ca-timeline__era').title).toBe('Test era · 1500 – 1800');
    const none = setup({ eras: false });
    expect(none.root.querySelector('.ca-timeline__eras')).toBeNull();
    expect(none.root.dataset.caNoEras).toBe('true');
  });

  it('observes its size with ResizeObserver when available', () => {
    const observe = vi.fn();
    const disconnect = vi.fn();
    let callback: (() => void) | null = null;
    vi.stubGlobal(
      'ResizeObserver',
      class {
        constructor(cb: () => void) {
          callback = cb;
        }
        observe = observe;
        disconnect = disconnect;
        unobserve = vi.fn();
      },
    );
    try {
      const h = setup();
      expect(observe).toHaveBeenCalledWith(h.root);
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('ca-timeline__inner') ? rect(TRACK_LEFT, 800) : rect(0, 840);
      });
      callback!();
      expect(h.$$('.ca-timeline__tick-label').length).toBeGreaterThan(5);
      h.tl.destroy();
      expect(disconnect).toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('destroy', () => {
  it('removes the DOM and every listener; the instance becomes inert', () => {
    const h = setup();
    const range = h.range;
    h.tl.destroy();
    expect(h.container.children).toHaveLength(0);
    press(range, 'ArrowRight');
    range.dispatchEvent(new Event('input'));
    expect(h.onInput).not.toHaveBeenCalled();
    expect(() => {
      h.tl.setValue(1000);
      h.tl.setHighlight({ from: 1, to: 2 });
      h.tl.setFrames([1]);
      h.tl.play();
      h.tl.pause();
      h.tl.resize();
      h.tl.destroy();
    }).not.toThrow();
    expect(h.tl.isPlaying()).toBe(false);
    expect(h.tl.getValue()).toBe(1453);
  });

  it('cancels playback and pending frames', () => {
    vi.useFakeTimers();
    const h = setup({ value: 1900 });
    stubLayout(h.tl);
    h.tl.play();
    vi.advanceTimersByTime(100);
    pointer(h.scaleEl, 'pointerdown', clientXOf(1700));
    const before = h.onInput.mock.calls.length;
    h.tl.destroy();
    vi.advanceTimersByTime(5_000);
    expect(h.onInput.mock.calls.length).toBe(before);
    expect(h.onPlayChange.mock.calls.at(-1)?.[0]).toBe(true); // no callbacks after destroy
  });
});

// ------------------------------------------------------------------------------
// Opt-in options: layout 'bar', step, yearField, changeButtons. The reference site
// (apps/site/src/app.ts) uses all four; left out, the timeline is the stacked one above.

/** The reference site's timeline options. */
const SITE = { layout: 'bar', step: 1, yearField: 'input', changeButtons: false } as const satisfies Partial<TimelineOptions>;

/** Like setup(), for a timeline without the typed-year field (`yearField: 'label'`). */
function setupLabel(opts: Partial<TimelineOptions> = {}): Omit<Harness, 'year'> & { label: HTMLElement } {
  const container = document.createElement('div');
  document.body.append(container);
  const onInput = vi.fn();
  const onChange = vi.fn();
  const onPlayChange = vi.fn();
  const tl = new Timeline(container, {
    min: MIN,
    max: MAX,
    value: 1453,
    frames: FRAMES,
    onInput,
    onChange,
    onPlayChange,
    ...opts,
    yearField: 'label',
  });
  live.push(tl);
  const root = container.firstElementChild as HTMLElement;
  const $ = <T extends Element = HTMLElement>(sel: string): T => {
    const el = root.querySelector<T>(sel);
    if (!el) throw new Error(`missing ${sel}`);
    return el;
  };
  const $$ = <T extends Element = HTMLElement>(sel: string): T[] => [...root.querySelectorAll<T>(sel)];
  return {
    tl,
    container,
    root,
    range: $<HTMLInputElement>('.ca-timeline__range'),
    scaleEl: $('.ca-timeline__scale'),
    label: $('.ca-timeline__year-label'),
    onInput,
    onChange,
    onPlayChange,
    $,
    $$,
  };
}

const CONTROL_NAMES: Record<string, string> = {
  'ca-timeline__btn--back': 'back',
  'ca-timeline__btn--play': 'play',
  'ca-timeline__btn--fwd': 'forward',
  'ca-timeline__year-input': 'year',
  'ca-timeline__range': 'slider',
  'ca-timeline__speed-select': 'speed',
};

/** Short names of the timeline's focusable controls in document (= Tab) order. */
function tabOrder(root: HTMLElement): string[] {
  return [...root.querySelectorAll<HTMLElement>('button, input, select')].map((el) => {
    if (el.classList.contains('ca-timeline__btn--change')) {
      return el.getAttribute('aria-label') === 'Previous border change' ? 'previous change' : 'next change';
    }
    const cls = [...el.classList].find((c) => c in CONTROL_NAMES);
    return cls ? CONTROL_NAMES[cls]! : el.className;
  });
}

/** Class of every element child, in order. */
const childClasses = (el: Element): (string | null)[] => [...el.children].map((c) => c.getAttribute('class'));

interface TickLine {
  x: number;
  top: number;
  bottom: number;
}

/** The vertical lines of a ticks path ("M12.34 2.5V7.5M…"); fails on anything else. */
function tickLines(path: Element): TickLine[] {
  const d = path.getAttribute('d') ?? '';
  const re = /M(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)V(-?\d+(?:\.\d+)?)/g;
  expect(d.replace(re, '')).toBe('');
  return [...d.matchAll(re)].map((m) => ({ x: Number(m[1]), top: Number(m[2]), bottom: Number(m[3]) }));
}

describe('bar layout (layout: "bar")', () => {
  it('marks its root and has no density strip, tick labels or era band, even with eras given', () => {
    for (const eras of [undefined, [{ from: 1500, to: 1800, label: 'Test era' }]]) {
      const h = setup({ layout: 'bar', eras });
      expect(h.root.dataset.caLayout).toBe('bar');
      expect(h.root.dataset.caNoEras).toBe('true');
      stubLayout(h.tl, 1000);
      h.tl.setFrames([1600, 1700, 1800]);
      h.tl.setValue(1650);
      for (const sel of [
        '.ca-timeline__density',
        '.ca-timeline__density-bars',
        '.ca-timeline__labels',
        '.ca-timeline__tick-label',
        '.ca-timeline__eras',
        '.ca-timeline__era',
        '.ca-timeline__era-now',
      ]) {
        expect(h.root.querySelector(sel), sel).toBeNull();
      }
      // Still one root using only ca-timeline classes.
      expect(h.container.children).toHaveLength(1);
      for (const el of h.$$('[class]')) {
        for (const cls of (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean)) expect(cls.startsWith('ca-timeline')).toBe(true);
      }
      vi.restoreAllMocks();
    }
  });

  it('draws its tick lines inside the track: majors where the stacked layout labels its ticks, minors ≥ 9 px apart', () => {
    const bar = setup({ layout: 'bar' });
    const stacked = setup();
    stubLayout(bar.tl, 1000);
    stacked.tl.resize();
    const majors = tickLines(bar.$('.ca-timeline__ticks-major'));
    const minors = tickLines(bar.$('.ca-timeline__ticks-minor'));
    expect(majors.length).toBeGreaterThanOrEqual(10);
    expect(minors.length).toBeGreaterThan(majors.length);
    // Bar geometry (in the SVG's 10 units): centred inside the track, majors longer.
    for (const t of majors) expect([t.top, t.bottom]).toEqual([2.5, 7.5]);
    for (const t of minors) expect([t.top, t.bottom]).toEqual([4, 6]);
    // The stacked layout keeps hanging its ticks under the track.
    for (const t of tickLines(stacked.$('.ca-timeline__ticks-major'))) expect([t.top, t.bottom]).toEqual([0, 10]);
    for (const t of tickLines(stacked.$('.ca-timeline__ticks-minor'))) expect([t.top, t.bottom]).toEqual([5, 10]);
    // Major lines sit where the stacked layout puts its labels, so they stay regular.
    const labelled = stacked.$$('.ca-timeline__tick-label').map((l) => Number(l.dataset.year));
    expect(majors).toHaveLength(labelled.length);
    majors.forEach((t, i) => expect(t.x).toBeCloseTo(scale.toT(labelled[i]!) * 1000, 1));
    // Minor lines: at least 9 px apart within each linear stretch of the scale (7 px in
    // the stacked layout), so the bar has fewer of them.
    const stopX = DEFAULT_STOPS.map(([, t]) => t * 1000);
    const stretch = (x: number): number => stopX.findIndex((s, i) => x >= s - 0.01 && (i === stopX.length - 1 || x < stopX[i + 1]! - 0.01));
    let compared = 0;
    for (let i = 1; i < minors.length; i++) {
      const a = minors[i - 1]!;
      const b = minors[i]!;
      if (stretch(a.x) !== stretch(b.x)) continue;
      expect(b.x - a.x).toBeGreaterThanOrEqual(9 - 0.02);
      compared++;
    }
    expect(compared).toBeGreaterThan(20);
    expect(minors.length).toBeLessThan(tickLines(stacked.$('.ca-timeline__ticks-minor')).length);
    // The tick lines lie in the track, under the playhead and thumb; the range still
    // precedes the thumb (its focus ring is drawn on the thumb with ~).
    expect(childClasses(bar.$('.ca-timeline__inner'))).toEqual([
      'ca-timeline__track',
      'ca-timeline__ticks',
      'ca-timeline__playhead',
      'ca-timeline__range',
      'ca-timeline__thumb',
      'ca-timeline__hover',
    ]);
  });

  it('orders its controls in the DOM as they are shown: transport, year, track, speed', () => {
    const h = setup(SITE);
    const parts = ['.ca-timeline__transport', '.ca-timeline__year', '.ca-timeline__scale', '.ca-timeline__speed'].map((s) => h.$(s));
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i - 1]!.compareDocumentPosition(parts[i]!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    // So Tab (and a screen reader's reading order) follows the bar from left to right.
    expect(tabOrder(h.root)).toEqual(['back', 'play', 'forward', 'year', 'slider', 'speed']);
    expect(tabOrder(setup({ ...SITE, changeButtons: true }).root)).toEqual([
      'previous change',
      'back',
      'play',
      'forward',
      'next change',
      'year',
      'slider',
      'speed',
    ]);
  });

  it('keeps the native range slider, operable from the keyboard and the pointer as in the stacked layout', () => {
    vi.useFakeTimers();
    const bar = setup(SITE);
    const stacked = setup();
    expect(bar.range.type).toBe('range');
    expect(bar.range.tabIndex).toBe(0);
    expect(bar.range.disabled).toBe(false);
    expect(bar.range.getAttribute('aria-label')).toBe('Year');
    expect(bar.range.getAttribute('aria-valuetext')).toBe('1453 CE');
    const keys: [string, KeyboardEventInit?][] = [
      ['ArrowRight'],
      ['ArrowUp', { shiftKey: true }],
      ['PageUp'],
      ['PageDown'],
      [']'],
      ['['],
      ['ArrowLeft'],
      ['ArrowDown', { shiftKey: true }],
      ['End'],
      ['Home'],
    ];
    const run = (h: Harness): number[] =>
      keys.map(([key, init]) => {
        press(h.range, key, init);
        return h.tl.getValue();
      });
    const years = run(bar);
    expect(years).toEqual(run(stacked));
    expect(years).toEqual([1454, 1464, 1500, 1450, 1453, 1, -1, -11, MAX, MIN]);
    expect(calls(bar.onChange)).toEqual(years);
    expect(bar.range.getAttribute('aria-valuetext')).toBe('3400 BCE');
    press(bar.range, ' ');
    expect(bar.tl.isPlaying()).toBe(true);
    press(bar.range, ' ');
    expect(bar.tl.isPlaying()).toBe(false);
    // Click-to-jump on the thick track.
    stubLayout(bar.tl);
    pointer(bar.scaleEl, 'pointerdown', clientXOf(1800));
    vi.advanceTimersByTime(20);
    pointer(bar.scaleEl, 'pointerup', clientXOf(1800));
    expect(bar.tl.getValue()).toBe(1800);
    expect(document.activeElement).toBe(bar.range);
  });

  it('shows the year under a hovering mouse and the lifespan band inside the track', () => {
    const h = setup(SITE);
    stubLayout(h.tl);
    const hover = h.$('.ca-timeline__hover');
    pointer(h.scaleEl, 'pointermove', clientXOf(1914));
    expect(hover.dataset.caVisible).toBe('hover');
    expect(h.$('.ca-timeline__bubble').textContent).toBe('1914');
    expect(h.onInput).not.toHaveBeenCalled();
    h.scaleEl.dispatchEvent(new MouseEvent('pointerleave'));
    expect(hover.dataset.caVisible).toBeUndefined();
    h.tl.setHighlight({ from: 1299, to: 1922 });
    const band = h.$('.ca-timeline__track .ca-timeline__highlight');
    expect([band.dataset.from, band.dataset.to]).toEqual(['1299', '1922']);
    expect(h.root.dataset.caHighlight).toBe('true');
    expect(h.range.getAttribute('aria-describedby')!.split(' ')).toHaveLength(2);
  });

  it('flags compact and tiny containers as the stacked layout does (its CSS lays the bar out by them)', () => {
    const h = setup(SITE);
    stubLayout(h.tl, 900, 1040);
    expect(h.root.dataset.caCompact).toBeUndefined();
    vi.restoreAllMocks();
    stubLayout(h.tl, 600, 639);
    expect(h.root.dataset.caCompact).toBe('true');
    expect(h.root.dataset.caTiny).toBeUndefined();
    vi.restoreAllMocks();
    stubLayout(h.tl, 290, 320);
    expect(h.root.dataset.caCompact).toBe('true');
    expect(h.root.dataset.caTiny).toBe('true');
  });
});

describe('step option', () => {
  it('a step of 1 moves exactly one year with the buttons and stepBy, skipping year 0', () => {
    const h = setup({ step: 1, value: -2 });
    expect(h.root.dataset.caStep).toBe('fixed');
    const back = h.$<HTMLButtonElement>('.ca-timeline__btn--back');
    const fwd = h.$<HTMLButtonElement>('.ca-timeline__btn--fwd');
    const seen: number[] = [];
    for (const btn of [fwd, fwd, fwd, back, back]) {
      btn.click();
      seen.push(h.tl.getValue());
    }
    expect(seen).toEqual([-1, 1, 2, 1, -1]);
    expect(h.tl.stepBy(1)).toBe(1);
    expect(h.tl.stepBy(-1)).toBe(-1);
    expect(calls(h.onInput)).toEqual([-1, 1, 2, 1, -1, 1, -1]);
    expect(calls(h.onChange)).toEqual([-1, 1, 2, 1, -1, 1, -1]);
  });

  it('a larger step moves that many years on its grid (grid point 0 is 1 CE)', () => {
    const h = setup({ step: 10, value: 1450 });
    const back = h.$<HTMLButtonElement>('.ca-timeline__btn--back');
    const fwd = h.$<HTMLButtonElement>('.ca-timeline__btn--fwd');
    fwd.click();
    expect(h.tl.getValue()).toBe(1460);
    expect(h.tl.stepBy(1)).toBe(1470);
    back.click();
    expect(h.tl.getValue()).toBe(1460);
    // Off the grid, a step lands on the next multiple (as Page Up/Page Down do).
    h.tl.setValue(1453);
    fwd.click();
    expect(h.tl.getValue()).toBe(1460);
    h.tl.setValue(1453);
    back.click();
    expect(h.tl.getValue()).toBe(1450);
    h.tl.setValue(-10);
    expect([h.tl.stepBy(1), h.tl.stepBy(1), h.tl.stepBy(-1), h.tl.stepBy(-1)]).toEqual([1, 10, 1, -10]);
    // The step is fixed: the buttons' names do not follow the scale.
    h.tl.setValue(2020);
    expect(back.getAttribute('aria-label')).toBe('Back 10 years');
    expect(fwd.getAttribute('aria-label')).toBe('Forward 10 years');
  });

  it('stops at the ends', () => {
    const h = setup({ step: 1, value: MAX - 1 });
    const back = h.$<HTMLButtonElement>('.ca-timeline__btn--back');
    const fwd = h.$<HTMLButtonElement>('.ca-timeline__btn--fwd');
    fwd.click();
    expect(h.tl.getValue()).toBe(MAX);
    expect(fwd.getAttribute('aria-disabled')).toBe('true');
    fwd.click();
    expect(h.tl.stepBy(1)).toBe(MAX);
    expect(calls(h.onInput)).toEqual([MAX]);
    h.tl.setValue(MIN + 1);
    back.click();
    expect(h.tl.getValue()).toBe(MIN);
    expect(back.getAttribute('aria-disabled')).toBe('true');
    back.click();
    expect(h.tl.stepBy(-1)).toBe(MIN);
    expect(calls(h.onInput)).toEqual([MAX, MIN]);
    // A step past an end stops at the end.
    expect(setup({ step: 100, value: 2000 }).tl.stepBy(1)).toBe(MAX);
    expect(setup({ step: 1000, value: -3000 }).tl.stepBy(-1)).toBe(MIN);
  });

  it('Page Up and Page Down keep the adaptive step', () => {
    const h = setup({ step: 1 });
    press(h.range, 'PageUp');
    expect(h.tl.getValue()).toBe(1500);
    h.tl.setValue(1453);
    press(h.range, 'PageDown');
    expect(h.tl.getValue()).toBe(1450);
    h.tl.setValue(2000);
    press(h.range, 'PageUp');
    expect(h.tl.getValue()).toBe(2005);
    h.tl.setValue(-2000);
    press(h.range, 'PageDown');
    expect(h.tl.getValue()).toBe(-2200);
  });

  it('names the buttons by the step; their titles hint ← and → only for a one-year step', () => {
    const buttons = (h: Harness): HTMLButtonElement[] => [h.$('.ca-timeline__btn--back'), h.$('.ca-timeline__btn--fwd')];
    const [back1, fwd1] = buttons(setup({ step: 1 }));
    expect([back1!.getAttribute('aria-label'), fwd1!.getAttribute('aria-label')]).toEqual(['Back 1 year', 'Forward 1 year']);
    expect([back1!.title, fwd1!.title]).toEqual(['Back 1 year (←)', 'Forward 1 year (→)']);
    const [back10, fwd10] = buttons(setup({ step: 10 }));
    expect([back10!.getAttribute('aria-label'), fwd10!.getAttribute('aria-label')]).toEqual(['Back 10 years', 'Forward 10 years']);
    expect([back10!.title, fwd10!.title]).toEqual(['Back 10 years', 'Forward 10 years']);
    const [backA, fwdA] = buttons(setup());
    expect([backA!.title, fwdA!.title]).toEqual(['Back 50 years (Page Down)', 'Forward 50 years (Page Up)']);
  });

  it.each([0, -5, 2.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53, '5', null, 'adaptive'])(
    'falls back to the adaptive step for %s',
    (step) => {
      const h = setup({ step: step as TimelineOptions['step'] });
      expect(h.root.dataset.caStep).toBe('adaptive');
      const fwd = h.$<HTMLButtonElement>('.ca-timeline__btn--fwd');
      expect(h.$('.ca-timeline__btn--back').getAttribute('aria-label')).toBe('Back 50 years');
      expect(fwd.title).toBe('Forward 50 years (Page Up)');
      fwd.click();
      expect(h.tl.getValue()).toBe(1500);
    },
  );
});

describe('yearField: "label"', () => {
  it('shows the year as aria-hidden text instead of the typed-year field', () => {
    for (const layout of ['bar', 'stacked'] as const) {
      const h = setupLabel({ layout });
      expect(h.root.querySelector('.ca-timeline__year-input')).toBeNull();
      expect(h.root.querySelector('.ca-timeline__year-error')).toBeNull();
      expect(h.$$('input').map((i) => i.className)).toEqual(['ca-timeline__range']);
      expect(childClasses(h.$('.ca-timeline__year'))).toEqual(['ca-timeline__year-label']);
      expect(h.label.tagName).toBe('SPAN');
      expect(h.label.getAttribute('aria-hidden')).toBe('true');
      expect(h.label.textContent).toBe('1453');
      // The slider carries the year for assistive technology; nothing points at a
      // field or error message that is not there.
      expect(h.range.getAttribute('aria-valuetext')).toBe('1453 CE');
      for (const el of h.$$('[aria-describedby], [aria-labelledby], [aria-controls]')) {
        for (const attr of ['aria-describedby', 'aria-labelledby', 'aria-controls']) {
          for (const id of (el.getAttribute(attr) ?? '').split(/\s+/).filter(Boolean)) expect(document.getElementById(id), id).not.toBeNull();
        }
      }
    }
  });

  it('follows setValue, keys, buttons, drags and playback', () => {
    vi.useFakeTimers();
    const h = setupLabel(SITE);
    const shown = (): string | null => h.label.textContent;
    h.tl.setValue(-500);
    expect(shown()).toBe('500 BCE');
    press(h.range, 'ArrowRight');
    expect(shown()).toBe('499 BCE');
    h.tl.setValue(33);
    expect(shown()).toBe('33 CE');
    h.$('.ca-timeline__btn--fwd').click();
    expect(shown()).toBe('34 CE');
    stubLayout(h.tl);
    pointer(h.scaleEl, 'pointerdown', clientXOf(1800));
    vi.advanceTimersByTime(20);
    expect(shown()).toBe('1800');
    pointer(h.scaleEl, 'pointermove', clientXOf(1900));
    vi.advanceTimersByTime(20);
    expect(shown()).toBe('1900');
    pointer(h.scaleEl, 'pointerup', clientXOf(1900));
    h.tl.play();
    vi.advanceTimersByTime(3_000);
    h.tl.pause();
    expect(h.tl.getValue()).toBeGreaterThan(1900);
    expect(shown()).toBe(DEFAULT_TIMELINE_LABELS.formatYear(h.tl.getValue()));
  });

  it('leaves Escape to the host', () => {
    const h = setupLabel(SITE);
    const outer = vi.fn();
    h.container.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') outer(e.defaultPrevented);
    });
    press(h.range, 'Escape');
    const play = h.$('.ca-timeline__btn--play');
    play.focus();
    press(play, 'Escape');
    expect(calls(outer)).toEqual([false, false]);
    expect(h.tl.getValue()).toBe(1453);
  });
});

describe('typed year in the bar layout (the reference site: yearField "input")', () => {
  it('leaves a focused field alone while the year moves (playback), and catches up on blur', () => {
    const h = setup(SITE);
    h.year.focus();
    h.year.select();
    h.tl.setValue(1501); // playback ticks and host changes while the field has focus
    h.tl.setValue(1508);
    // The select-all survives, so typed digits replace the year instead of appending to it.
    expect(h.year.value).toBe('1453');
    expect([h.year.selectionStart, h.year.selectionEnd]).toEqual([0, 4]);
    h.year.blur();
    expect(h.year.value).toBe('1508');
  });

  it('is the field in the year slot, named and described by its error message', () => {
    const h = setup(SITE);
    expect(childClasses(h.$('.ca-timeline__year'))).toEqual(['ca-timeline__year-input', 'ca-timeline__year-error']);
    expect(h.year.type).toBe('text');
    expect(h.year.getAttribute('aria-label')).toBe('Go to year');
    expect(h.year.getAttribute('aria-describedby')).toBe(h.$('.ca-timeline__year-error').id);
    expect(h.year.value).toBe('1453');
  });

  it.each([
    ['1453', 1453, '1453'],
    ['-500', -500, '500 BCE'],
    ['500 BC', -500, '500 BCE'],
    ['AD 33', 33, '33 CE'],
    ['  2,000  ', 2000, '2000'],
  ])('applies %j on Enter', (text, year, shown) => {
    const h = setup({ ...SITE, value: 1900 });
    typeYear(h, text);
    expect(h.tl.getValue()).toBe(year);
    expect(h.year.value).toBe(shown);
    expect(calls(h.onInput)).toEqual([year]);
    expect(calls(h.onChange)).toEqual([year]);
    expect(h.year.getAttribute('aria-invalid')).toBeNull();
  });

  it.each(['0', 'abc', '3500 BC', '2100', '1453.5', '', '-500 BC'])('rejects %j with an error state', (text) => {
    const h = setup(SITE);
    typeYear(h, text);
    expect(h.tl.getValue()).toBe(1453);
    expect(h.onInput).not.toHaveBeenCalled();
    expect(h.year.getAttribute('aria-invalid')).toBe('true');
    expect(h.$('.ca-timeline__year').dataset.caInvalid).toBe('true');
    const error = h.$('.ca-timeline__year-error');
    expect(error.hidden).toBe(false);
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('3400 BCE');
    expect(error.textContent).toContain('2026');
  });

  it('editing clears the error; Escape reverts and only then stops propagation', () => {
    const h = setup(SITE);
    const outer = vi.fn();
    h.container.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') outer();
    });
    typeYear(h, 'nonsense');
    expect(h.year.getAttribute('aria-invalid')).toBe('true');
    h.year.value = 'nonsense!';
    h.year.dispatchEvent(new Event('input', { bubbles: true }));
    expect(h.year.getAttribute('aria-invalid')).toBeNull();
    expect(h.$('.ca-timeline__year-error').hidden).toBe(true);
    press(h.year, 'Escape');
    expect(h.year.value).toBe('1453');
    expect(outer).not.toHaveBeenCalled();
    // An error shown and nothing typed since: Escape reverts and is swallowed too.
    typeYear(h, '99999');
    press(h.year, 'Escape');
    expect(h.$('.ca-timeline__year-error').hidden).toBe(true);
    expect(h.year.value).toBe('1453');
    expect(outer).not.toHaveBeenCalled();
    // Nothing left to revert: Escape reaches the host.
    press(h.year, 'Escape');
    expect(outer).toHaveBeenCalledTimes(1);
  });

  it('blur applies a valid edit and reverts an invalid one', () => {
    const h = setup(SITE);
    h.year.focus();
    h.year.value = '1066';
    h.year.dispatchEvent(new Event('input', { bubbles: true }));
    h.year.blur();
    expect(h.tl.getValue()).toBe(1066);
    expect(calls(h.onChange)).toEqual([1066]);
    h.year.focus();
    h.year.value = 'soon';
    h.year.dispatchEvent(new Event('input', { bubbles: true }));
    h.year.blur();
    expect(h.tl.getValue()).toBe(1066);
    expect(h.year.value).toBe('1066');
  });

  it('keeps what the user types while the value changes, and its keys never trigger shortcuts', () => {
    vi.useFakeTimers();
    const h = setup(SITE);
    h.year.focus();
    h.year.value = '17';
    h.year.dispatchEvent(new Event('input', { bubbles: true }));
    h.tl.setValue(1800);
    expect(h.year.value).toBe('17');
    for (const key of ['[', ']', 'k', 'K', ' ']) press(h.year, key);
    expect(h.tl.getValue()).toBe(1800);
    expect(h.tl.isPlaying()).toBe(false);
    expect(h.onInput).not.toHaveBeenCalled();
  });
});

describe('changeButtons: false', () => {
  it('leaves the previous/next change buttons out of the DOM', () => {
    for (const opts of [{ changeButtons: false }, SITE] as Partial<TimelineOptions>[]) {
      const h = setup(opts);
      expect(h.$$('.ca-timeline__btn--change')).toHaveLength(0);
      expect(childClasses(h.$('.ca-timeline__transport'))).toEqual([
        'ca-timeline__btn ca-timeline__btn--step ca-timeline__btn--back',
        'ca-timeline__btn ca-timeline__btn--play',
        'ca-timeline__btn ca-timeline__btn--step ca-timeline__btn--fwd',
      ]);
    }
  });

  it('[ and ] still jump to the previous and next border change', () => {
    const h = setup(SITE);
    press(h.range, ']');
    expect(h.tl.getValue()).toBe(1500);
    press(h.range, '[');
    press(h.range, '[');
    expect(h.tl.getValue()).toBe(1);
    // Also while another timeline control has focus.
    const play = h.$('.ca-timeline__btn--play');
    play.focus();
    press(play, ']');
    expect(h.tl.getValue()).toBe(1453);
    expect(h.tl.stepChange(1)).toBe(1500);
    expect(calls(h.onChange)).toEqual([1500, 1453, 1, 1453, 1500]);
  });

  it('works without frames and picks them up from setFrames', () => {
    const h = setup({ ...SITE, frames: null });
    expect(h.tl.stepChange(1)).toBeNull();
    press(h.range, ']');
    expect(h.tl.getValue()).toBe(1453);
    h.tl.setFrames([1600, 1700]);
    press(h.range, ']');
    expect(h.tl.getValue()).toBe(1600);
  });
});

describe('defaults (the new options left out)', () => {
  it('build the stacked timeline: the same DOM as the explicit defaults', () => {
    const shape = (h: Harness): string =>
      h.$$('*').map((el) => `${el.tagName.toLowerCase()}.${el.getAttribute('class') ?? ''}`).join(' ');
    const implicit = setup();
    const explicit = setup({ layout: 'stacked', step: 'adaptive', yearField: 'input', changeButtons: true });
    expect(shape(explicit)).toBe(shape(implicit));
    expect(shape(setup({ layout: 'grid' as TimelineOptions['layout'] }))).toBe(shape(implicit));
    expect(implicit.root.dataset.caLayout).toBe('stacked');
    expect(implicit.root.dataset.caStep).toBe('adaptive');
    expect(childClasses(implicit.root)).toEqual(['ca-timeline__controls', 'ca-timeline__scale', 'ca-timeline__sr', 'ca-timeline__sr']);
    expect(childClasses(implicit.$('.ca-timeline__controls'))).toEqual(['ca-timeline__transport', 'ca-timeline__year', 'ca-timeline__speed']);
    expect(childClasses(implicit.$('.ca-timeline__inner'))).toEqual([
      'ca-timeline__density',
      'ca-timeline__track',
      'ca-timeline__playhead',
      'ca-timeline__range',
      'ca-timeline__thumb',
      'ca-timeline__hover',
      'ca-timeline__ticks',
      'ca-timeline__labels',
      'ca-timeline__eras',
    ]);
    expect(tabOrder(implicit.root)).toEqual(['previous change', 'back', 'play', 'forward', 'next change', 'year', 'speed', 'slider']);
  });
});
