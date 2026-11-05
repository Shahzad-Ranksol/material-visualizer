import { linearToSrgb, SRGB8_TO_LINEAR } from './colorSpace';
import type { Intrinsics } from './intrinsics';

/**
 * Recolours a surface in place of laying a texture on it — for a fence (its real boards, gaps and
 * grain are the fence; a plank scan never lines up with them) and for an AI-designed item, whose
 * own structure is the design. Like a stain or paint on real timber, the finish changes the
 * colour, not the shape.
 *
 * With the scene's baked light (`Intrinsics`): the surface's own albedo is (photo − residual) /
 * shading, and the new pixel is target × shading + residual, where the target keeps a share of
 * the albedo's own variation (grain, weathered boards). A board in the sun shows the swatch under
 * that sun, one in shade the swatch in shade — the swatch is the new albedo, exactly.
 *
 * Without it (fallback): each pixel keeps its brightness relative to the surface's median
 * brightness, out = target × L / Lref, so a typically lit board shows the swatch's own colour.
 *
 * Either way only a quarter of the old colour's local hue variation carries over (so old cedar's
 * orange doesn't tint a grey or blue finish, yet the boards don't look printed flat).
 */

// Share of each pixel's own hue variation (relative to the surface's average colour) kept
const CHROMA_DETAIL = 0.25;
// With baked light: share of the albedo's own brightness variation (grain, board-to-board) kept.
// The light's variation is all kept — it is in the shading, not the albedo
export const ALBEDO_DETAIL = 0.35;

const lum = (r: number, g: number, b: number) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export interface RecolorReference {
  // Median linear luminance of the surface's clearly-surface pixels (of its albedo, with baked light)
  luminance: number;
  // Average linear colour divided by its luminance (the old colour's chromaticity)
  chroma: [number, number, number];
}

// The surface colour a pixel's recolour starts from: its albedo with baked light, else the photo
const surfaceColour = (original: ArrayLike<number>, i: number, intrinsics: Intrinsics | null | undefined, out: number[]) => {
  for (let c = 0; c < 3; c++) {
    const p = SRGB8_TO_LINEAR[original[i * 4 + c]];
    if (!intrinsics) {
      out[c] = p;
      continue;
    }
    const s = intrinsics.shading[i * 3 + c];
    out[c] = s > 1e-3 ? Math.min(1, Math.max(0, p - intrinsics.reflection[i * 3 + c]) / s) : 0;
  }
  return out;
};

/**
 * The reference for recolouring: over every given mask together (all parts of one item, so a run
 * in the sun stays brighter than a run in the shade), occluded pixels excluded.
 */
export const recolorReference = (
  original: Uint8ClampedArray,
  masks: Float32Array[],
  occluder: Float32Array | null,
  intrinsics?: Intrinsics | null
): RecolorReference | null => {
  const hist = new Float64Array(1024);
  const sum = [0, 0, 0];
  const px = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < original.length / 4; i++) {
    let m = 0;
    for (const mask of masks) m = Math.max(m, mask[i]);
    const w = m > 0.5 ? m * (occluder ? 1 - occluder[i] : 1) : 0;
    if (w <= 0) continue;
    const [r, g, b] = surfaceColour(original, i, intrinsics, px);
    hist[Math.min(1023, Math.floor(lum(r, g, b) * 1024))] += w;
    sum[0] += r * w;
    sum[1] += g * w;
    sum[2] += b * w;
    n += w;
  }
  if (!n) return null;
  let acc = 0;
  let k = 0;
  while (k < 1023 && acc + hist[k] < n / 2) acc += hist[k++];
  const luminance = Math.max(1e-4, (k + 0.5) / 1024);
  const avgL = Math.max(1e-6, lum(sum[0] / n, sum[1] / n, sum[2] / n));
  return { luminance, chroma: [sum[0] / n / avgL, sum[1] / n / avgL, sum[2] / n / avgL] };
};

/** Writes the recoloured surface into `out` (RGBA8), blended by mask × (1 − occluder). */
export const recolorSurface = (
  original: Uint8ClampedArray,
  out: Uint8ClampedArray,
  mask: Float32Array,
  occluder: Float32Array | null,
  target: [number, number, number],
  reference: RecolorReference | null = recolorReference(original, [mask], occluder),
  intrinsics?: Intrinsics | null
): void => {
  if (!reference) return;
  const px = [0, 0, 0];
  for (let i = 0; i < mask.length; i++) {
    const a = mask[i] * (occluder ? 1 - occluder[i] : 1);
    if (a <= 0) continue;
    const p = i * 4;
    surfaceColour(original, i, intrinsics, px);
    const L = lum(px[0], px[1], px[2]);
    const rel = L / reference.luminance;
    for (let c = 0; c < 3; c++) {
      // The pixel's own chromaticity against the surface's average one (1 = the usual colour)
      const chroma = L > 1e-5 ? px[c] / L / reference.chroma[c] : 1;
      const tint = Math.max(0, 1 + CHROMA_DETAIL * (Math.min(3, chroma) - 1));
      let lin: number;
      if (intrinsics) {
        const albedo = Math.min(1, target[c] * Math.max(0, 1 + ALBEDO_DETAIL * (Math.min(3, rel) - 1)) * tint);
        lin = albedo * intrinsics.shading[i * 3 + c] + intrinsics.reflection[i * 3 + c];
      } else {
        lin = target[c] * rel * tint;
      }
      const v = Math.round(linearToSrgb(Math.min(1, lin)) * 255);
      out[p + c] = Math.round(out[p + c] * (1 - a) + v * a);
    }
  }
};

/** The mean colour of an image in linear light (a material's albedo, for recolouring). */
export const meanLinear = (rgba: Uint8ClampedArray): [number, number, number] => {
  const s = [0, 0, 0];
  const n = rgba.length / 4;
  for (let i = 0; i < n; i++) for (let c = 0; c < 3; c++) s[c] += SRGB8_TO_LINEAR[rgba[i * 4 + c]];
  return [s[0] / n, s[1] / n, s[2] / n];
};
