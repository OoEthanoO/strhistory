// Theme defaults (dark navy, AGENTS.md §7.5) and CSS custom-property theming.
import { normalizeColor } from './color.js';
import type { GlobeTheme } from './types.js';

/** The default dark theme. Colours are the ones the screenshots are tuned with. */
export const DEFAULT_THEME: Readonly<GlobeTheme> = Object.freeze({
  space: '#070b14',
  ocean: '#0e1b2d',
  // Unclaimed land: a neutral grey-green clearly lighter than the ocean (contrast ≈ 1.5:1),
  // so "no polity" never reads as water; fills pre-blend over it at fillBlend.
  land: '#343a34',
  lake: '#0e1b2d',
  lakeShore: 'rgba(120, 146, 170, 0.55)',
  border: 'rgba(9, 13, 21, 0.78)',
  approximate: 'rgba(230, 237, 246, 0.6)',
  coast: 'rgba(136, 162, 186, 0.75)',
  hatch: 'rgba(240, 244, 250, 0.5)',
  label: '#eef2f7',
  labelHalo: 'rgba(7, 11, 20, 0.85)',
  labelHaloWidth: null,
  labelHaloBlur: null,
  labelOverlay: '#f3e2bf',
  hover: '#f4f7fb',
  selection: '#e9b45f',
  fillBlend: 0.85,
  overlayTint: 0.3,
  hoverLighten: 0.16,
  edge: 0,
  atmosphere: 0.5,
  stars: true,
});

const COLOR_KEYS = [
  'space',
  'ocean',
  'land',
  'lake',
  'lakeShore',
  'border',
  'approximate',
  'coast',
  'hatch',
  'label',
  'labelHalo',
  'labelOverlay',
  'hover',
  'selection',
] as const satisfies readonly (keyof GlobeTheme)[];

const NUMBER_KEYS = ['fillBlend', 'overlayTint', 'hoverLighten', 'edge', 'atmosphere'] as const satisfies readonly (keyof GlobeTheme)[];

/** Pixel sizes (0..8), or null for the layer's own default. */
const PX_KEYS = ['labelHaloWidth', 'labelHaloBlur'] as const satisfies readonly (keyof GlobeTheme)[];

/** `labelHalo` → `--ca-label-halo`. */
export function cssVarName(key: keyof GlobeTheme): string {
  return `--ca-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

/**
 * Reads `--ca-*` custom properties from an element's computed style. Only keys
 * that are set (non-empty) are returned, so they can be layered over defaults.
 */
export function readCssTheme(el: Element): Partial<GlobeTheme> {
  if (typeof getComputedStyle !== 'function') return {};
  const cs = getComputedStyle(el);
  const out: Partial<Record<keyof GlobeTheme, unknown>> = {};
  for (const key of COLOR_KEYS) {
    const v = cs.getPropertyValue(cssVarName(key)).trim();
    if (v) out[key] = v;
  }
  for (const key of [...NUMBER_KEYS, ...PX_KEYS]) {
    const v = cs.getPropertyValue(cssVarName(key)).trim();
    if (v && Number.isFinite(parseFloat(v))) out[key] = parseFloat(v);
  }
  const stars = cs.getPropertyValue(cssVarName('stars')).trim();
  if (stars === '0' || stars === 'none' || stars === 'off' || stars === 'false') out.stars = false;
  return out as Partial<GlobeTheme>;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * Merges defaults < CSS custom properties < explicit options, validates numbers
 * and normalises every colour to hex/rgba so MapLibre can paint it.
 */
export function resolveTheme(...layers: (Partial<GlobeTheme> | undefined)[]): GlobeTheme {
  const merged: GlobeTheme = { ...DEFAULT_THEME };
  for (const layer of layers) {
    if (!layer) continue;
    for (const [k, v] of Object.entries(layer)) {
      if (v !== undefined && k in merged) (merged as unknown as Record<string, unknown>)[k] = v;
    }
  }
  for (const key of COLOR_KEYS) merged[key] = normalizeColor(merged[key]);
  for (const key of NUMBER_KEYS) {
    const n = Number(merged[key]);
    merged[key] = Number.isFinite(n) ? clamp01(n) : DEFAULT_THEME[key];
  }
  for (const key of PX_KEYS) {
    const n = merged[key] === null ? NaN : Number(merged[key]);
    merged[key] = Number.isFinite(n) ? Math.min(8, Math.max(0, n)) : null;
  }
  merged.stars = Boolean(merged.stars);
  return merged;
}
