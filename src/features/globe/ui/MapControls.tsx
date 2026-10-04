// Map controls (bottom left, above the timeline): zoom in, zoom out and reset view —
// three separate buttons in the globe's one button style. Ported from the Alex's Atlas
// reference site, apps/site/src/ui/map-controls.ts.
import type { JSX } from 'react';
import { IconButton } from './Icon';

export interface MapControlsProps {
  onZoomIn(): void;
  onZoomOut(): void;
  onReset(): void;
}

export function MapControls({ onZoomIn, onZoomOut, onReset }: MapControlsProps): JSX.Element {
  return (
    <div className="map-controls" role="group" aria-label="Map view">
      <IconButton icon="plus" label="Zoom in" onClick={() => onZoomIn()} />
      <IconButton icon="minus" label="Zoom out" onClick={() => onZoomOut()} />
      <IconButton icon="globe" label="Reset view" title="Reset view (R)" onClick={() => onReset()} />
    </div>
  );
}
