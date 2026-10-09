// @alexs-atlas/globe — public entry. Contract: root AGENTS.md §5.4–§5.5,
// details and recipes: packages/globe/AGENTS.md. No DOM access at import time.
// Styles are NOT imported here: hosts import '@alexs-atlas/globe/style.css'
// (built from src/style.css, which also pulls in the timeline styles).

export { ChronoGlobe, type GlobeState } from './chrono-globe.js';
export { BorderLayers, addBorderLayers, formatSpan, hoverLabel, pickOrder, type StepTiming } from './border-layers.js';
export { defineChronoGlobeElement, type ChronoGlobeElement } from './element.js';
export { DEFAULT_PALETTE, blendPalette, edgePalette, hoverPalette, overlayLinePalette, slotColorExpression } from './palette.js';
export { DEFAULT_THEME, cssVarName, readCssTheme, resolveTheme } from './theme.js';
export {
  DEFAULT_VIEW,
  bboxCenter,
  bboxOfCoordinates,
  bboxToLngLatBounds,
  fitZoom,
  normalizeView,
  roundView,
  scaleToZoom,
  unionBBoxes,
  wrapLon,
  zoomToScale,
  type BBox,
} from './view.js';
export { FrameScheduler, sameFrame, type FrameKey, type FrameSchedulerDeps } from './frames.js';
// For hosts that put bordersAt() output into their own MapLibre source (§8.7 path A):
// one feature per polygon part, or a sliver whose winding flips in tiling can unfill a polity.
export { splitParts } from './cull.js';
export { hatchImage, type HatchImage, type HatchOptions } from './hatch.js';
export {
  borderIds,
  borderLayers as borderLayerSpecs,
  borderSources,
  buildBaseStyle,
  externalUrls,
  layerOrder,
  skySpec,
  type BorderIds,
  type LayerSpec,
  type SourceSpec,
} from './style.js';
export { blendOver, contrastRatio, isTransparent, mix, normalizeColor, parseColor, shade } from './color.js';
export type {
  BorderLayersHandle,
  BorderLayersOptions,
  ChronoGlobeCallbacks,
  ChronoGlobeOptions,
  FailureReason,
  GlobeDataOption,
  GlobeTheme,
  GlobeView,
  HoverInfo,
  PaletteOption,
  ReliefOptions,
  PolityFeatureLike,
  SelectInfo,
} from './types.js';
export * from './timeline/index.js';
