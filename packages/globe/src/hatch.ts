// Diagonal hatch pattern for tier-1 overlays, generated at runtime and added
// with `map.addImage` — no sprite sheet and no request.
//
// The pixels are rasterised directly (anti-aliased distance to the stripe
// centre lines) instead of through a <canvas>: same result, but deterministic,
// testable without a DOM and usable in a worker.
import { toRgba } from './color.js';

export interface HatchOptions {
  /** Stripe colour (alpha respected). */
  color: string;
  /** Distance between stripes in CSS px (measured horizontally). Default 6. */
  spacing?: number;
  /** Stripe width in CSS px. Default 1.25. */
  width?: number;
  /** Device pixel ratio of the bitmap. Default 2 (crisp on HiDPI, fine on 1×). */
  pixelRatio?: number;
}

export interface HatchImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
  pixelRatio: number;
}

/**
 * A square, seamlessly tiling RGBA bitmap with stripes at 45° (bottom-left to
 * top-right). The tile size is the stripe spacing, so the pattern tiles exactly.
 * Colour channels are straight (not premultiplied), as MapLibre's `addImage`
 * expects for raw image data.
 */
export function hatchImage(opts: HatchOptions): HatchImage {
  const pr = opts.pixelRatio ?? 2;
  const spacing = Math.max(2, opts.spacing ?? 6);
  const lineW = Math.max(0.25, opts.width ?? 1.25);
  const size = Math.max(2, Math.round(spacing * pr));
  const c = toRgba(opts.color);
  const data = new Uint8ClampedArray(size * size * 4);
  // Stripes are the lines x + y ≡ 0 (mod size). Their perpendicular distance from
  // a pixel centre is |((x + y) mod size) folded to ±size/2| / √2.
  const half = (lineW * pr) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let m = (x + 0.5 + y + 0.5) % size;
      if (m > size / 2) m -= size;
      const dist = Math.abs(m) / Math.SQRT2;
      // 1 inside the stripe, linear 1 px falloff at its edges (anti-aliasing).
      const cover = Math.max(0, Math.min(1, half + 0.5 - dist));
      const i = (y * size + x) * 4;
      data[i] = c.r;
      data[i + 1] = c.g;
      data[i + 2] = c.b;
      data[i + 3] = Math.round(255 * c.a * cover);
    }
  }
  return { width: size, height: size, data, pixelRatio: pr };
}
