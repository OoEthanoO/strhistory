// Polity colours: a 12-slot muted palette, pre-blended over the land colour so
// fills are opaque (overlapping or stacked areas never mix into a third colour).
import { blendOver, mix, shade } from './color.js';
import type { GlobeTheme, PaletteOption, PolityProps } from './types.js';

/**
 * Default base colours, one per colour slot `PolityProps.c` (the pipeline gives
 * neighbours different slots and keeps a power's slot stable across years).
 *
 * Chosen for the dark navy theme by optimising OKLab distances of the colours
 * as drawn (pre-blended over `DEFAULT_THEME.land` #343a34 at `fillBlend` 0.85):
 * worst pair of all 66 ΔE 7.1 (normal vision); slots 0–5, which a greedy
 * colouring uses most, ΔE ≥ 10.7 normal and ≥ 8.5 under protan/deutan
 * simulation; every fill ΔE ≥ 20 from unclaimed land. Muted on purpose (OKLCH chroma ≈ 0.06–0.095), so identity never
 * relies on colour alone: borders and the hover tooltip carry it.
 */
export const DEFAULT_PALETTE: readonly string[] = Object.freeze([
  '#a87f40', // 0 ochre
  '#a15d6a', // 1 wine
  '#4ba691', // 2 jade
  '#afa8e6', // 3 lavender
  '#5e80b8', // 4 slate blue
  '#a1bd7a', // 5 sage
  '#79a0cc', // 6 steel blue
  '#85649e', // 7 plum
  '#8a9d5a', // 8 moss
  '#af729c', // 9 mauve
  '#c090a9', // 10 dusty pink
  '#5cc2c2', // 11 teal
]);

/** Opaque fill colours: every palette colour pre-blended over `land`. */
export function blendPalette(palette: readonly string[], theme: Pick<GlobeTheme, 'land' | 'fillBlend'>): string[] {
  return palette.map((c) => blendOver(c, theme.land, theme.fillBlend));
}

/** Hover variants of opaque fills (lightened towards white). */
export function hoverPalette(fills: readonly string[], theme: Pick<GlobeTheme, 'hoverLighten'>): string[] {
  return fills.map((c) => mix(c, '#ffffff', theme.hoverLighten));
}

/** Each polity's own outline (`theme.edge`): its opaque fill, a shade deeper. */
export function edgePalette(fills: readonly string[], theme: Pick<GlobeTheme, 'edge'>): string[] {
  return fills.map((c) => shade(c, theme.edge));
}

/** Outline colour of tier-1 overlays: their own colour, lightened for the dark map. */
export function overlayLinePalette(palette: readonly string[]): string[] {
  return palette.map((c) => mix(c, '#ffffff', 0.35));
}

/**
 * A MapLibre expression picking `colors[c % n]` by the feature's colour slot.
 * Slots outside the palette wrap around (a dataset with more slots than colours
 * still renders); a missing slot uses `fallback`.
 */
export function slotColorExpression(colors: readonly string[], fallback: string): unknown[] {
  if (colors.length === 0) return ['to-color', fallback];
  const expr: unknown[] = ['match', ['%', ['to-number', ['get', 'c'], -1], colors.length]];
  colors.forEach((c, i) => expr.push(i, c));
  expr.push(fallback);
  return expr;
}

/** Whether a palette option is a per-feature function (needs per-feature colours in JS). */
export function isPaletteFunction(p: PaletteOption | undefined): p is (props: PolityProps) => string {
  return typeof p === 'function';
}
