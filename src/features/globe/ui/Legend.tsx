// Map key (top left, under the history notes button): a button that opens a card to its
// right. Swatches use the globe's map colours as the globe draws them (map-colors.ts),
// so the key matches the map exactly; one extra row explains the history-note pins.
// Esc or a press elsewhere closes it. Ported from the Alex's Atlas reference site,
// apps/site/src/ui/legend.ts.
import { useEffect, useId, useRef } from 'react';
import type { CSSProperties, JSX, KeyboardEvent, ReactNode } from 'react';
import { KEY_COLORS, MAP_THEME_RESOLVED, fillColor } from '../map-colors';
import { IconButton } from './Icon';

export interface LegendProps {
  open: boolean;
  onOpenChange(open: boolean): void;
}

// A polity in slot `c` with no identity colour, as drawn.
const slot = (c: number): string => fillColor({ power: '', pid: '', c });

/** Custom properties for a swatch (`--sw-fill`, `--sw-hatch`, `--sw-line`). */
const vars = (v: Record<string, string>): CSSProperties => v as CSSProperties;

function Swatch({ cls, style, children }: { cls: string; style?: CSSProperties; children?: ReactNode }): JSX.Element {
  return (
    <span className={`legend__sw ${cls}`} style={style} aria-hidden="true">
      {children}
    </span>
  );
}

function Row({ swatch, children }: { swatch: ReactNode; children: string }): JSX.Element {
  return (
    <li className="legend__row">
      {swatch}
      <span>{children}</span>
    </li>
  );
}

export function Legend({ open, onOpenChange }: LegendProps): JSX.Element {
  const t = MAP_THEME_RESOLVED;
  const id = `legend-${useId().replace(/[^A-Za-z0-9_-]/g, '')}`;
  const titleId = `${id}-title`;
  const rootRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const onOpenChangeRef = useRef(onOpenChange);
  useEffect(() => {
    onOpenChangeRef.current = onOpenChange;
  });

  // A press anywhere else (the globe, another control) closes the card.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent): void => {
      const root = rootRef.current;
      if (!(e.target instanceof Node && root?.contains(e.target))) onOpenChangeRef.current(false);
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => document.removeEventListener('pointerdown', onPointerDown, true);
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if ((e.key === 'Escape' || e.key === 'Esc') && open) {
      e.preventDefault();
      e.stopPropagation();
      onOpenChange(false);
      toggleRef.current?.focus({ preventScroll: true });
    }
  };

  return (
    <div className="hud__item legend" ref={rootRef} onKeyDown={onKeyDown}>
      <IconButton
        ref={toggleRef}
        icon="layers"
        label="Map key"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => onOpenChange(!open)}
      />
      <div className="popover legend__card" id={id} role="group" aria-labelledby={titleId} hidden={!open}>
        <h2 className="popover__title" id={titleId}>
          Map key
        </h2>
        <ul className="legend__list">
          <Row
            swatch={
              <Swatch cls="legend__sw--multi">
                {KEY_COLORS.map((c, i) => (
                  <span key={i} style={{ background: c }} />
                ))}
              </Swatch>
            }
          >
            Major powers in their traditional colours; a colony shares its ruler’s colour
          </Row>
          <Row
            swatch={
              <Swatch cls="legend__sw--multi">
                {[0, 2, 1, 4].map((c) => (
                  <span key={c} style={{ background: slot(c) }} />
                ))}
              </Swatch>
            }
          >
            Other countries in a colour from their flag; neighbours differ
          </Row>
          <Row swatch={<Swatch cls="legend__sw--hatch" style={vars({ '--sw-fill': slot(3), '--sw-hatch': t.hatch })} />}>
            Hatched: indigenous nations and disputed areas (approximate extent)
          </Row>
          <Row swatch={<Swatch cls="legend__sw--dashed" style={vars({ '--sw-fill': slot(5), '--sw-line': t.approximate })} />}>
            Dashed outline: approximate extent
          </Row>
          <Row swatch={<Swatch cls="legend__sw--plain" style={{ background: t.land }} />}>Land no polity held</Row>
          <Row swatch={<Swatch cls="legend__sw--plain" style={{ background: t.ocean }} />}>Sea</Row>
          <Row swatch={<Swatch cls="legend__sw--select" style={vars({ '--sw-fill': slot(0), '--sw-line': t.selection })} />}>
            Selected polity: a white outline
          </Row>
          <Row
            swatch={
              <Swatch cls="legend__sw--pin">
                <span className="globe-pin__dot" />
              </Swatch>
            }
          >
            History note — open it to read the study notes
          </Row>
        </ul>
      </div>
    </div>
  );
}
