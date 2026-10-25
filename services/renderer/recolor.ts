import { linearToSrgb, SRGB8_TO_LINEAR } from './colorSpace';

/**
 * Recolours a surface in place of laying a texture on it — for an AI-designed item (a new fence
 * style), whose own structure (slats, gaps, panel shadows, grain) is the design and must survive.
 * In linear light each pixel keeps its relation to the surface's average and takes the target
 * colour: out = pixel × target / average, per channel. Like a stain or paint on real timber, the
 * finish changes the colour, not the shape. Writes into `out` (RGBA8) blended by mask × (1 − occluder).
 */
export const recolorSurface = (
  original: Uint8ClampedArray,
  out: Uint8ClampedArray,
  mask: Float32Array,
  occluder: Float32Array | null,
  target: [number, number, number]
): void => {
  // The surface's average colour, from its clearly-surface pixels
  const avg = [0, 0, 0];
  let n = 0;
  for (let i = 0; i < mask.length; i++) {
    const w = mask[i] > 0.5 ? mask[i] * (occluder ? 1 - occluder[i] : 1) : 0;
    if (w <= 0) continue;
    for (let c = 0; c < 3; c++) avg[c] += SRGB8_TO_LINEAR[original[i * 4 + c]] * w;
    n += w;
  }
  if (!n) return;
  const gain = avg.map((s, c) => (s > 1e-6 ? target[c] / (s / n) : 1));
  for (let i = 0; i < mask.length; i++) {
    const a = mask[i] * (occluder ? 1 - occluder[i] : 1);
    if (a <= 0) continue;
    const p = i * 4;
    for (let c = 0; c < 3; c++) {
      const lin = Math.min(1, SRGB8_TO_LINEAR[original[p + c]] * gain[c]);
      const v = Math.round(linearToSrgb(lin) * 255);
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
