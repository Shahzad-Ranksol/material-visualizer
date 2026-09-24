import { SRGB8_TO_LINEAR, linearToSrgb } from './colorSpace';

/**
 * Optional "Studio Lighting" (Phase 3 of the rendering plan). A self-hosted worker (e.g.
 * MatSwap on a private NVIDIA GPU) produces an AI render; only its LOW-FREQUENCY lighting
 * difference is kept, inside the surface, clamped. The exact product detail and every pixel
 * outside the surface always come from the exact render. Disabled unless a provider is set.
 */
// A provider returns either the raw AI render (harmonised here) or a result its worker already
// harmonised and drift-checked server-side (returned as-is, never harmonised twice)
export type StudioLightingProvider = (request: {
  original: ImageData;
  exact: ImageData;
  mask: Float32Array;
  materialUrl: string;
}) => Promise<{ image: ImageData; harmonized: boolean }>;

let provider: StudioLightingProvider | null = null;

/** Registered by the app when the server reports a Studio Lighting worker; null disables it. */
export const setStudioLightingProvider = (p: StudioLightingProvider | null) => {
  provider = p;
};

export const isStudioLightingAvailable = () => provider !== null;

const EPS = 1e-3;
// Largest lighting change (in log space) the AI is allowed to make
const MAX_LOG_CHANGE = 0.25;
// Mean colour change above this means the AI altered the product, not the light → discard
const MAX_MEAN_DRIFT = 0.18;
const LOW_PASS_CELLS = 40;

/**
 * H = lowPass(log(ai + eps) - log(exact + eps)), clamped to ±0.25;
 * final = exp(log(exact + eps) + strength * H) inside the mask, exact elsewhere.
 * Returns null when the AI result drifted too far from the exact render.
 */
export const applyLowFrequencyHarmonization = (
  exact: ImageData,
  ai: ImageData,
  mask: Float32Array,
  strength = 1
): ImageData | null => {
  const { width: w, height: h } = exact;
  if (ai.width !== w || ai.height !== h) return null;
  const cell = Math.max(4, Math.round(Math.max(w, h) / LOW_PASS_CELLS));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const sum = new Float32Array(gw * gh * 3);
  const cnt = new Float32Array(gw * gh);
  let drift = 0;
  let driftN = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (mask[i] < 0.5) continue;
      const g = Math.floor(y / cell) * gw + Math.floor(x / cell);
      for (let c = 0; c < 3; c++) {
        const d = Math.log(SRGB8_TO_LINEAR[ai.data[i * 4 + c]] + EPS) - Math.log(SRGB8_TO_LINEAR[exact.data[i * 4 + c]] + EPS);
        sum[g * 3 + c] += d;
      }
      cnt[g]++;
    }
  }
  for (let g = 0; g < gw * gh; g++) {
    if (!cnt[g]) continue;
    const mean = [0, 1, 2].map((c) => sum[g * 3 + c] / cnt[g]);
    // Hue drift: channels changing differently means the colour changed, not just the light
    const avg = (mean[0] + mean[1] + mean[2]) / 3;
    drift += (Math.abs(mean[0] - avg) + Math.abs(mean[1] - avg) + Math.abs(mean[2] - avg)) * cnt[g];
    driftN += cnt[g];
    for (let c = 0; c < 3; c++) sum[g * 3 + c] = Math.max(-MAX_LOG_CHANGE, Math.min(MAX_LOG_CHANGE, mean[c]));
  }
  if (driftN === 0 || drift / driftN > MAX_MEAN_DRIFT) return null;

  const out = new Uint8ClampedArray(exact.data);
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1.0001, Math.max(0, (y + 0.5) / cell - 0.5));
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const a = mask[i];
      if (a <= 0) continue;
      const fx = Math.min(gw - 1.0001, Math.max(0, (x + 0.5) / cell - 0.5));
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const g00 = y0 * gw + x0;
      const g10 = g00 + (x0 + 1 < gw ? 1 : 0);
      const g01 = g00 + (y0 + 1 < gh ? gw : 0);
      const g11 = g01 + (x0 + 1 < gw ? 1 : 0);
      for (let c = 0; c < 3; c++) {
        const H =
          (sum[g00 * 3 + c] * (1 - tx) + sum[g10 * 3 + c] * tx) * (1 - ty) +
          (sum[g01 * 3 + c] * (1 - tx) + sum[g11 * 3 + c] * tx) * ty;
        const e = SRGB8_TO_LINEAR[exact.data[i * 4 + c]];
        const harmonized = Math.exp(Math.log(e + EPS) + strength * H) - EPS;
        const blended = e * (1 - a) + harmonized * a;
        out[i * 4 + c] = Math.round(linearToSrgb(blended) * 255);
      }
    }
  }
  return new ImageData(out, w, h);
};

/** Runs the optional worker; null (keep the exact render) when disabled, failing or drifting. */
export const harmonizeStudioLighting = async (original: ImageData, exact: ImageData, mask: Float32Array, materialUrl: string): Promise<ImageData | null> => {
  if (!provider) return null;
  try {
    const { image, harmonized } = await provider({ original, exact, mask, materialUrl });
    return harmonized ? image : applyLowFrequencyHarmonization(exact, image, mask);
  } catch (err) {
    console.warn('Studio Lighting failed; keeping the exact render', err);
    return null;
  }
};
