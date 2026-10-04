// The body of the "Keyboard shortcuts" dialog: a definition list of keys and what they
// do on the globe page. Ported from the Alex's Atlas reference site,
// apps/site/src/ui/dialogs.ts (`shortcutsContent`), plus N for the history notes.
import { Fragment } from 'react';
import type { JSX } from 'react';

const SHORTCUTS: [string[], string][] = [
  [['/'], 'Search places, powers and notes (an empty search lists the polities on the map)'],
  [['L'], 'List the polities on the map'],
  [['N'], 'Open the history notes panel'],
  [['Space'], 'Play or pause the timeline'],
  [['←', '→'], 'One year back or forward (timeline focused; Shift: 10 years)'],
  [['Page Up', 'Page Down'], 'A larger step (timeline focused)'],
  [['Home', 'End'], 'First or last year (timeline focused)'],
  [['['], 'Previous border change'],
  [[']'], 'Next border change'],
  [['F'], 'Fit the map to the selected polity or note'],
  [['R'], 'Reset the view'],
  [['+', '−'], 'Zoom in or out (map focused; arrow keys pan)'],
  [['Esc'], 'Close the open panel or dialog, then clear the selection'],
  [['?'], 'Show these shortcuts'],
];

export function ShortcutsContent(): JSX.Element {
  return (
    <dl className="shortcuts">
      {SHORTCUTS.map(([keys, what]) => (
        <Fragment key={keys.join(' ')}>
          <dt>
            {keys.map((k, i) => (
              <Fragment key={k}>
                {i > 0 ? <span className="shortcuts__or"> / </span> : null}
                <kbd>{k}</kbd>
              </Fragment>
            ))}
          </dt>
          <dd>{what}</dd>
        </Fragment>
      ))}
    </dl>
  );
}
