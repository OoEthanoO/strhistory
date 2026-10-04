// Short, non-blocking messages ("No later border change in the data."). The stack is a
// polite status region, so screen readers read each toast once; errors use role="alert".
// At most three are shown; each fades out after 3.6 s or when dismissed, and a message
// shown again while it is still up replaces the earlier copy instead of stacking.
// Ported from the Alex's Atlas reference site, apps/site/src/ui/toasts.ts (`Toaster`;
// state lives in the `useToasts` hook here, the markup and class names are the same).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { JSX } from 'react';
import { Icon } from './Icon';

export interface ToastItem {
  id: number;
  text: string;
  kind: 'info' | 'error';
  /** Fading out (`toast--leaving`); removed shortly after. */
  leaving?: boolean;
}

const MAX_VISIBLE = 3;
const TIMEOUT_MS = 3600;
/** Length of the leaving transition before the toast is removed. */
const LEAVE_MS = 180;

export function useToasts(): {
  toasts: ToastItem[];
  show(text: string, o?: { kind?: 'info' | 'error' }): void;
  dismiss(id: number): void;
} {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  // The current list, readable synchronously by `show` and `dismiss` (stable callbacks).
  const items = useRef<ToastItem[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const nextId = useRef(0);

  const commit = useCallback((next: ToastItem[]) => {
    items.current = next;
    setToasts(next);
  }, []);

  const clearTimer = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t !== undefined) clearTimeout(t);
    timers.current.delete(id);
  }, []);

  const dismiss = useCallback(
    (id: number) => {
      const toast = items.current.find((t) => t.id === id);
      if (!toast || toast.leaving) return;
      clearTimer(id);
      commit(items.current.map((t) => (t.id === id ? { ...t, leaving: true } : t)));
      timers.current.set(
        id,
        setTimeout(() => {
          timers.current.delete(id);
          commit(items.current.filter((t) => t.id !== id));
        }, LEAVE_MS),
      );
    },
    [clearTimer, commit],
  );

  const show = useCallback(
    (text: string, o: { kind?: 'info' | 'error' } = {}) => {
      const kind = o.kind ?? 'info';
      // The same message again: drop the earlier copy, so it is not shown twice but the
      // new one is still announced and its time starts again.
      const kept = items.current.filter((t) => {
        if (t.text !== text) return true;
        clearTimer(t.id);
        return false;
      });
      const id = ++nextId.current;
      const next = [...kept, { id, text, kind }];
      while (next.length > MAX_VISIBLE) {
        const oldest = next.shift();
        if (oldest) clearTimer(oldest.id);
      }
      commit(next);
      timers.current.set(id, setTimeout(() => dismiss(id), TIMEOUT_MS));
    },
    [clearTimer, commit, dismiss],
  );

  // No timer outlives the component.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const t of pending.values()) clearTimeout(t);
      pending.clear();
    };
  }, []);

  return { toasts, show, dismiss };
}

const ICON = { info: 'info', error: 'alert' } as const;

export function Toasts({ toasts, onDismiss }: { toasts: ToastItem[]; onDismiss(id: number): void }): JSX.Element {
  return (
    <div className="toasts" role="status" aria-live="polite" aria-relevant="additions">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`toast toast--${t.kind}${t.leaving ? ' toast--leaving' : ''}`}
          role={t.kind === 'error' ? 'alert' : undefined}
        >
          <Icon name={ICON[t.kind]} className="icon toast__icon" />
          <span className="toast__text">{t.text}</span>
          <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => onDismiss(t.id)}>
            <Icon name="close" />
          </button>
        </div>
      ))}
    </div>
  );
}
