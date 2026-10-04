/**
 * The context of the year shown, under the large year: the title of the nearest
 * earlier snapshot (src/content/snapshots) as a small button that opens a card with
 * that snapshot's summary and highlights and what the map shows for the year.
 */
import { useEffect, useRef } from 'react';
import { formatYear } from '../era';
import type { GlobeSnapshot } from '../types';
import { Icon } from './Icon';

export interface EraCaptionProps {
  year: number;
  snapshot: GlobeSnapshot | undefined;
  /** What the map shows: "Political borders as of 1789" and so on. */
  status: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}

export function EraCaption({ year, snapshot, status, open, onOpenChange }: EraCaptionProps) {
  const root = useRef<HTMLDivElement>(null);
  const toggle = useRef<HTMLButtonElement>(null);
  const close = useRef(onOpenChange);
  close.current = onOpenChange;

  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (root.current && e.target instanceof Node && !root.current.contains(e.target)) close.current(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open]);

  if (!snapshot) return null;
  return (
    <div className="era" ref={root}>
      <button
        ref={toggle}
        type="button"
        className="era__toggle"
        aria-expanded={open}
        aria-controls="gx-era-card"
        onClick={() => onOpenChange(!open)}
      >
        <span className="era__title">{snapshot.title}</span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} />
      </button>
      <section
        className="era__card"
        id="gx-era-card"
        aria-label={`The world in ${formatYear(year)}`}
        hidden={!open}
        onKeyDown={(e) => {
          if (e.key !== 'Escape') return;
          e.preventDefault();
          e.stopPropagation();
          onOpenChange(false);
          toggle.current?.focus({ preventScroll: true });
        }}
      >
        {snapshot.year !== year && <p className="era__context">Context from {formatYear(snapshot.year)}</p>}
        <p className="era__summary">{snapshot.summary}</p>
        {snapshot.highlights.length > 0 && (
          <ul className="era__highlights">
            {snapshot.highlights.map((highlight) => (
              <li key={highlight}>{highlight}</li>
            ))}
          </ul>
        )}
        <p className="era__status">{status}</p>
        <p className="era__caveat">Modern coastlines are a reference; historical borders and early dates are approximate.</p>
      </section>
    </div>
  );
}
