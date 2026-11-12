import { luminance, SRGB8_TO_LINEAR as SRGB } from '../services/renderer/colorSpace';

/**
 * Moves light the intrinsic model left in an item's albedo into its shading
 * (npm run scenes:light, scripts/lightRefine.ts).
 *
 * Marigold works at 1024 px and splits light from colour by what it has learned. On a white tiled
 * splashback it keeps the under-cabinet light pools and the falloff toward the hood partly as the
 * tiles' own colour. On a marble top it does the same with the toaster's contact shadow and
 * reflection. A new finish replaces the albedo, so that light went with the old material. Here,
 * per item, the albedo's smooth brightness (a masked Gaussian blur of its log luminance, relative to
 * the item's median) is treated as light: the shading is multiplied by it, so the albedo left over
 * is flat at that scale. Detail finer than `sigma` (grain, grout, veins) stays the material's.
 * With `near`, only the band within that many px of the item's occluders (the objects standing on
 * it) is corrected, for a surface whose large-scale variation is real colour (marble veins).
 *
 * `contrast` then expands the item's whole light (shading × gain) around its median: the photo is
 * tone-mapped, so on near-white tile the bright end is compressed and the pools under the lights
 * were stronger than its pixels say; on a dark new finish they would read too faint.
 *
 * `gloss` is for a polished floor: its mirror reflections (the far doorway, the oven, cabinet edges)
 * are vertical streaks in the picture, which Marigold also keeps as the floor's colour. The
 * albedo blurred along the vertical (`along` px) keeps them and averages out the diagonal boards;
 * what stands brighter than that blurred again across (`across` px) is moved into the reflection
 * layer, which a glossy finish keeps (scaled by its gloss) and a matte one mostly drops.
 */
export interface LightRefine {
  // Gaussian sigma in photo px: variation broader than this is light
  sigma: number;
  // Only within this many px of the occluder, fading out
  near?: number;
  // Limit on the gain either way (default 3)
  maxGain?: number;
  // Exponent on the item's light relative to its median (1 = as measured)
  contrast?: number;
  // Polished floor: reflection streaks moved from the albedo into the reflection layer
  gloss?: { along: number; across: number };
}

// Per scene, per item. Only the Galley so far: the Classic kitchen's paints are fitted against its
// unrefined light (npm run finishes:fromref), and the Modern kitchen's light reads right as it is
export const LIGHT_REFINE: Record<string, Record<string, LightRefine>> = {
  'kitchen-galley': {
    // The light pools under the wall cabinets and the run darkening toward the hood, as strong as
    // they look on the white tile
    splashback: { sigma: 10, contrast: 1.8 },
    // The lit underside of the wall cabinets around its downlights
    'wall-cabinets': { sigma: 8 },
    // The toaster's, the vase's and the tap's contact shadows and reflections; the veins stay
    worktop: { sigma: 3, near: 18 },
    // The polished herringbone's reflections of the doorway, the oven and the cabinet edges
    floor: { sigma: 0, gloss: { along: 10, across: 16 } },
  },
};

export interface LightLayers {
  width: number;
  height: number;
  // The photo, 8-bit sRGB RGBA
  photo: ArrayLike<number>;
  // Linear RGB, 3 floats per pixel (1 = a white sheet's light)
  shading: Float32Array;
  reflection: Float32Array;
}

/** Separable Gaussian blur of `values` weighted by `weight` (normalised convolution); `sigmaY` defaults to `sigma`, 0 = none. */
export const maskedBlur = (values: Float32Array, weight: Float32Array, w: number, h: number, sigma: number, sigmaY = sigma): Float32Array => {
  const kernel = (sg: number) => {
    const r = sg > 0 ? Math.max(1, Math.ceil(sg * 3)) : 0;
    const k = new Float32Array(2 * r + 1);
    for (let i = -r; i <= r; i++) k[i + r] = sg > 0 ? Math.exp((-i * i) / (2 * sg * sg)) : 1;
    return { r, k };
  };
  const kx = kernel(sigma);
  const ky = kernel(sigmaY);
  const pass = (src: Float32Array, horizontal: boolean) => {
    const { r, k } = horizontal ? kx : ky;
    if (!r) return src;
    const out = new Float32Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let s = 0;
        for (let d = -r; d <= r; d++) {
          const xx = horizontal ? x + d : x;
          const yy = horizontal ? y : y + d;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          s += src[yy * w + xx] * k[d + r];
        }
        out[y * w + x] = s;
      }
    return out;
  };
  const wv = new Float32Array(w * h);
  for (let i = 0; i < wv.length; i++) wv[i] = values[i] * weight[i];
  const num = pass(pass(wv, true), false);
  const den = pass(pass(weight, true), false);
  const out = new Float32Array(w * h);
  for (let i = 0; i < out.length; i++) out[i] = den[i] > 1e-6 ? num[i] / den[i] : 0;
  return out;
};

/** Distance in px (chamfer 3-4, /3) from each pixel to the nearest pixel where `seed` ≥ 0.5. */
export const distanceTo = (seed: Float32Array, w: number, h: number): Float32Array => {
  const INF = 1e9;
  const d = new Float32Array(w * h);
  for (let i = 0; i < d.length; i++) d[i] = seed[i] >= 0.5 ? 0 : INF;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (x > 0) d[i] = Math.min(d[i], d[i - 1] + 3);
      if (y > 0) {
        d[i] = Math.min(d[i], d[i - w] + 3);
        if (x > 0) d[i] = Math.min(d[i], d[i - w - 1] + 4);
        if (x < w - 1) d[i] = Math.min(d[i], d[i - w + 1] + 4);
      }
    }
  for (let y = h - 1; y >= 0; y--)
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (x < w - 1) d[i] = Math.min(d[i], d[i + 1] + 3);
      if (y < h - 1) {
        d[i] = Math.min(d[i], d[i + w] + 3);
        if (x < w - 1) d[i] = Math.min(d[i], d[i + w + 1] + 4);
        if (x > 0) d[i] = Math.min(d[i], d[i + w - 1] + 4);
      }
    }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
};

/**
 * The item's light correction: per pixel the factor its shading is multiplied by (1 outside the
 * item). `mask` is where the item paints (parts × (1 − occluder), 0–1); `occluder` is what stands
 * in front of it (for `near`).
 */
/** Log luminance of the item's albedo ((photo − reflection) / shading) and where it is valid. */
const logAlbedo = (layers: LightLayers, mask: Float32Array) => {
  const { width: w, height: h, photo, shading, reflection } = layers;
  const n = w * h;
  const logA = new Float32Array(n);
  const weight = new Float32Array(n);
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (mask[i] < 0.5) continue;
    const p = luminance(SRGB[photo[i * 4]], SRGB[photo[i * 4 + 1]], SRGB[photo[i * 4 + 2]]);
    const r = luminance(reflection[i * 3], reflection[i * 3 + 1], reflection[i * 3 + 2]);
    const s = luminance(shading[i * 3], shading[i * 3 + 1], shading[i * 3 + 2]);
    const a = Math.max(p - r, 0) / Math.max(s, 1e-3);
    if (a <= 1e-4) continue;
    logA[i] = Math.log(a);
    weight[i] = 1;
    count++;
  }
  return { logA, weight, count };
};

/** Median of `values` where `weight` is set. */
const medianWhere = (values: Float32Array, weight: Float32Array) => {
  const samples: number[] = [];
  for (let i = 0; i < values.length; i++) if (weight[i]) samples.push(values[i]);
  samples.sort((a, b) => a - b);
  return samples[Math.floor(samples.length / 2)];
};

export const lightGain = (layers: LightLayers, mask: Float32Array, occluder: Float32Array | null, opts: LightRefine): Float32Array => {
  const { width: w, height: h, shading } = layers;
  const n = w * h;
  const gain = new Float32Array(n).fill(1);
  if (opts.sigma <= 0 && !opts.contrast) return gain;
  const { logA, weight, count } = logAlbedo(layers, mask);
  if (count < 16) return gain;
  // The reference level is the median of the smoothed albedo, on the same footing as what it is
  // compared with (a raw median of a two-tone grain would sit on one tone, the blur between them)
  const smooth = opts.sigma > 0 ? maskedBlur(logA, weight, w, h, opts.sigma) : new Float32Array(n);
  const median = opts.sigma > 0 ? medianWhere(smooth, weight) : 0;
  const near = opts.near && occluder ? distanceTo(occluder, w, h) : null;
  const max = Math.log(opts.maxGain ?? 3);
  for (let i = 0; i < n; i++) {
    if (mask[i] <= 0) continue;
    let k = mask[i];
    if (near) k *= Math.max(0, 1 - near[i] / opts.near!);
    if (k <= 0) continue;
    const g = Math.min(max, Math.max(-max, smooth[i] - median));
    gain[i] = Math.exp(g * k);
  }
  if (opts.contrast && opts.contrast !== 1) {
    // The item's whole light, log, its smooth part only (the shading is smooth already)
    const light = new Float32Array(n);
    for (let i = 0; i < n; i++)
      if (weight[i]) light[i] = Math.log(Math.max(1e-4, luminance(shading[i * 3], shading[i * 3 + 1], shading[i * 3 + 2]) * gain[i]));
    const mid = medianWhere(light, weight);
    for (let i = 0; i < n; i++) {
      if (mask[i] <= 0 || !weight[i]) continue;
      const e = Math.min(max, Math.max(-max, (opts.contrast - 1) * (light[i] - mid)));
      gain[i] *= Math.exp(e * mask[i]);
    }
  }
  return gain;
};

/**
 * A polished floor's reflection streaks, as linear light to add to the reflection layer (0
 * outside the item); the albedo they leave is the floor's own (see `gloss` above).
 */
export const glossStreaks = (layers: LightLayers, mask: Float32Array, gloss: { along: number; across: number }): Float32Array => {
  const { width: w, height: h, photo } = layers;
  const n = w * h;
  const extra = new Float32Array(n);
  const { logA, weight, count } = logAlbedo(layers, mask);
  if (count < 16) return extra;
  const vertical = maskedBlur(logA, weight, w, h, 1, gloss.along);
  const base = maskedBlur(vertical, weight, w, h, gloss.across, gloss.along);
  // Board-to-board tone left after the vertical blur is below this (log units)
  const FLOOR = 0.015;
  for (let i = 0; i < n; i++) {
    if (!weight[i] || mask[i] <= 0) continue;
    const s = vertical[i] - base[i] - FLOOR;
    if (s <= 0) continue;
    const p = luminance(SRGB[photo[i * 4]], SRGB[photo[i * 4 + 1]], SRGB[photo[i * 4 + 2]]);
    extra[i] = p * (1 - Math.exp(-s)) * mask[i];
  }
  return extra;
};

/** Multiplies the shading by the gain, in place. */
export const applyGain = (shading: Float32Array, gain: Float32Array) => {
  for (let i = 0; i < gain.length; i++) {
    if (gain[i] === 1) continue;
    for (let c = 0; c < 3; c++) shading[i * 3 + c] *= gain[i];
  }
};
