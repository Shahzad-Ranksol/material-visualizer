import { AlphaMask, dilateDisc, emptyMask } from '../services/areaMaskOps';

// Pure blending maths for design styles (no DOM, unit-tested). An AI candidate is only ever
// taken inside the region; its colour is matched to the photo on a ring just outside the region,
// and its edge is feathered entirely *inside* the region, so every pixel outside is untouched.

export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const binary = (m: AlphaMask): AlphaMask => ({ ...m, alpha: m.alpha.map((a) => (a >= 128 ? 255 : 0)) });
const invert = (m: AlphaMask): AlphaMask => ({ ...m, alpha: m.alpha.map((a) => 255 - a) });
const erode = (m: AlphaMask, r: number): AlphaMask => invert(dilateDisc(invert(m), r));

// Separable box blur of an alpha mask
const boxBlur = (m: AlphaMask, r: number): AlphaMask => {
  if (r <= 0) return m;
  const { width: w, height: h } = m;
  const tmp = new Float32Array(w * h);
  const out = emptyMask(w, h);
  const n = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    let s = 0;
    for (let x = -r; x <= r; x++) s += m.alpha[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = s / n;
      s += m.alpha[y * w + Math.min(w - 1, x + r + 1)] - m.alpha[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = -r; y <= r; y++) s += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out.alpha[y * w + x] = Math.round(s / n);
      s += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return out;
};

/**
 * The blend weight of a region: 255 well inside, ramping to 0 at its edge over about `feather`
 * px — and exactly 0 everywhere outside the region.
 */
export const featherInside = (region: AlphaMask, feather: number): AlphaMask => {
  const r = Math.max(1, Math.round(feather / 2));
  const soft = boxBlur(erode(binary(region), r), r);
  const inside = binary(region);
  return { ...soft, alpha: soft.alpha.map((a, i) => (inside.alpha[i] ? a : 0)) };
};

/**
 * Per-channel gain bringing the candidate's colour to the photo's, measured on a ring of `ring`
 * px just outside the region (the AI was told not to change it, but image models drift a little
 * in white balance and exposure). Clamped so a bad candidate can't be pushed far.
 */
export const seamGain = (original: Rgba, candidate: Rgba, region: AlphaMask, ring = 6): [number, number, number] => {
  const inside = binary(region);
  const grown = dilateDisc(inside, ring);
  const so = [0, 0, 0];
  const sc = [0, 0, 0];
  for (let i = 0; i < inside.alpha.length; i++) {
    if (inside.alpha[i] || !grown.alpha[i]) continue;
    for (let c = 0; c < 3; c++) {
      so[c] += original.data[i * 4 + c];
      sc[c] += candidate.data[i * 4 + c];
    }
  }
  return [0, 1, 2].map((c) => (sc[c] > 0 ? Math.min(1.25, Math.max(0.8, so[c] / sc[c])) : 1)) as [number, number, number];
};

/** The blended scene: the photo, with the colour-matched candidate inside the region. */
export const blendStyle = (original: Rgba, candidate: Rgba, weight: AlphaMask, gain: [number, number, number]): Rgba => {
  const out = new Uint8ClampedArray(original.data);
  for (let i = 0; i < weight.alpha.length; i++) {
    const a = weight.alpha[i] / 255;
    if (!a) continue;
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(original.data[i * 4 + c] * (1 - a) + candidate.data[i * 4 + c] * gain[c] * a);
  }
  return { width: original.width, height: original.height, data: out };
};

/** Bounding box of a mask's non-zero pixels, or null if it is empty. */
export const maskBounds = (m: AlphaMask): Rect | null => {
  let x0 = m.width;
  let y0 = m.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < m.height; y++) {
    for (let x = 0; x < m.width; x++) {
      if (!m.alpha[y * m.width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};

/**
 * What ships: the colour-matched candidate cropped to the region's bounds, its alpha the blend
 * weight. Drawn over the photo at `rect` (source-over) it gives `blendStyle`'s result.
 */
export const stylePatch = (candidate: Rgba, weight: AlphaMask, gain: [number, number, number]): { rect: Rect; patch: Rgba } | null => {
  const rect = maskBounds(weight);
  if (!rect) return null;
  const data = new Uint8ClampedArray(rect.w * rect.h * 4);
  for (let y = 0; y < rect.h; y++) {
    for (let x = 0; x < rect.w; x++) {
      const si = (rect.y + y) * candidate.width + rect.x + x;
      const di = y * rect.w + x;
      for (let c = 0; c < 3; c++) data[di * 4 + c] = Math.round(candidate.data[si * 4 + c] * gain[c]);
      data[di * 4 + 3] = weight.alpha[si];
    }
  }
  return { rect, patch: { width: rect.w, height: rect.h, data } };
};
