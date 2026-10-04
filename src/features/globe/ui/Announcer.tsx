// Polite live region for screen readers: the year after scrubbing settles, the selected
// polity or note, list and search result counts. Each message is debounced per channel
// (latest wins), so dragging the timeline does not read out every year.
// Ported from the Alex's Atlas reference site, apps/site/src/ui/announcer.ts (an
// imperative DOM class there, a component with an imperative handle here).
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

export interface AnnouncerHandle {
  /**
   * Announces `text` after `delay` ms unless another message on the same `channel`
   * arrives first. Repeating the previous message re-announces it.
   */
  say(text: string, o?: { channel?: string; delay?: number }): void;
  /** Drops a pending message (e.g. the year announcement when playback starts). */
  cancel(channel: string): void;
}

export const Announcer = forwardRef<AnnouncerHandle, {}>(function Announcer(_props, ref) {
  const region = useRef<HTMLDivElement>(null);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const frames = useRef(new Set<number>());
  const last = useRef('');

  useImperativeHandle(ref, () => {
    const cancel = (channel = 'default') => {
      const t = timers.current.get(channel);
      if (t !== undefined) clearTimeout(t);
      timers.current.delete(channel);
    };
    const say = (text: string, { channel = 'default', delay = 0 }: { channel?: string; delay?: number } = {}) => {
      cancel(channel);
      const run = () => {
        timers.current.delete(channel);
        const el = region.current;
        if (!el) return;
        // Clearing first makes identical consecutive messages audible again.
        if (text === last.current) el.textContent = '';
        last.current = text;
        const frame = requestAnimationFrame(() => {
          frames.current.delete(frame);
          el.textContent = text;
        });
        frames.current.add(frame);
      };
      if (delay > 0) timers.current.set(channel, setTimeout(run, delay));
      else run();
    };
    return { say, cancel };
  }, []);

  // No timer or frame outlives the component.
  useEffect(() => {
    const pendingTimers = timers.current;
    const pendingFrames = frames.current;
    return () => {
      for (const t of pendingTimers.values()) clearTimeout(t);
      pendingTimers.clear();
      for (const f of pendingFrames) cancelAnimationFrame(f);
      pendingFrames.clear();
    };
  }, []);

  // React renders no children here: the text is set directly, so it never reconciles it.
  return <div ref={region} className="sr-only" aria-live="polite" aria-atomic="true" data-announcer="" />;
});
