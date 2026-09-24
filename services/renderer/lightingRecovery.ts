import { Vec3 } from '../../types';
import { SRGB8_TO_LINEAR, luminance } from './colorSpace';

/**
 * Light falling on a surface, recovered from the original photo in linear light.
 *
 * The photo's surface colour is (old paint) x (light). We estimate the old paint as the
 * surface's average colour and divide it out, leaving how light varies across the surface
 * (window falloff, shading) plus a fine "contact shadow" term (corners, shadows cast by
 * furniture). When the old paint is near-neutral (the usual white/grey wall), its tint is
 * attributed to the light, so warm or cool light carries onto the new material.
 */
export interface RecoveredLighting {
  // RGBA8 per pixel: rgb = illumination x 0.5 (linear), a = contact-shadow detail x 0.5
  texture: Uint8Array;
  // Linear colour of the original surface (old paint under average light)
  surfaceAverage: [number, number, number];
  // Camera-space direction towards the dominant light
  lightDir: Vec3;
}

// Old paint counts as neutral (its tint = the light's) when its chroma is below this
const NEUTRAL_CHROMA = 0.22;
// Linear luminance of typical neutral (white/grey) paint in a normally exposed photo — a
// brighter or darker surface means brighter or dimmer light than the material's catalogue photo
const NORMAL_EXPOSURE_LUMINANCE = 0.45;
// Fine shading kept from the original surface (1 = all of it)
const DETAIL_STRENGTH = 0.85;

export const recoverLighting = (
  room: Uint8ClampedArray,
  mask: Float32Array,
  occluder: Float32Array | null,
  w: number,
  h: number
): RecoveredLighting => {
  const n = w * h;
  const weight = new Float32Array(n);
  const lin = new Float32Array(n * 3);
  const avg = [0, 0, 0];
  let wSum = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < n; i++) {
    const o = i * 4;
    const r = SRGB8_TO_LINEAR[room[o]];
    const g = SRGB8_TO_LINEAR[room[o + 1]];
    const b = SRGB8_TO_LINEAR[room[o + 2]];
    lin[i * 3] = r;
    lin[i * 3 + 1] = g;
    lin[i * 3 + 2] = b;
    // Only trust clearly-surface pixels: edges and occluders would bias the estimate
    const wt = mask[i] > 0.5 ? mask[i] * (occluder ? 1 - occluder[i] : 1) : 0;
    weight[i] = wt;
    if (wt > 0) {
      avg[0] += r * wt;
      avg[1] += g * wt;
      avg[2] += b * wt;
      wSum += wt;
      cx += (i % w) * wt;
      cy += Math.floor(i / w) * wt;
    }
  }
  const texture = new Uint8Array(n * 4);
  if (wSum === 0) {
    texture.fill(128);
    return { texture, surfaceAverage: [0.5, 0.5, 0.5], lightDir: [0, -0.3, -1] };
  }
  const surfaceAverage: [number, number, number] = [avg[0] / wSum, avg[1] / wSum, avg[2] / wSum];
  cx /= wSum;
  cy /= wSum;

  // Coarse masked average grid → smooth low-frequency light (occluders excluded)
  const cell = Math.max(8, Math.round(Math.max(w, h) / 48));
  const gw = Math.ceil(w / cell);
  const gh = Math.ceil(h / cell);
  const grid = new Float32Array(gw * gh * 3);
  const gridW = new Float32Array(gw * gh);
  for (let i = 0; i < n; i++) {
    const wt = weight[i];
    if (wt === 0) continue;
    const g = Math.floor(Math.floor(i / w) / cell) * gw + Math.floor((i % w) / cell);
    grid[g * 3] += lin[i * 3] * wt;
    grid[g * 3 + 1] += lin[i * 3 + 1] * wt;
    grid[g * 3 + 2] += lin[i * 3 + 2] * wt;
    gridW[g] += wt;
  }
  const filled = new Uint8Array(gw * gh);
  for (let g = 0; g < gw * gh; g++) {
    if (gridW[g] > 0) {
      grid[g * 3] /= gridW[g];
      grid[g * 3 + 1] /= gridW[g];
      grid[g * 3 + 2] /= gridW[g];
      filled[g] = 1;
    }
  }
  // Grow values into empty cells so edges and gaps behind furniture get plausible light
  for (let pass = 0; pass < gw + gh; pass++) {
    let changed = false;
    const next = filled.slice();
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const g = gy * gw + gx;
        if (filled[g]) continue;
        let r = 0, gg = 0, b = 0, c = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const x = gx + dx;
          const y = gy + dy;
          if (x < 0 || y < 0 || x >= gw || y >= gh) continue;
          const k = y * gw + x;
          if (!filled[k]) continue;
          r += grid[k * 3];
          gg += grid[k * 3 + 1];
          b += grid[k * 3 + 2];
          c++;
        }
        if (c) {
          grid[g * 3] = r / c;
          grid[g * 3 + 1] = gg / c;
          grid[g * 3 + 2] = b / c;
          next[g] = 1;
          changed = true;
        }
      }
    }
    filled.set(next);
    if (!changed) break;
  }

  // Light colour & brightness: from neutral old paint, else assume white light at average level
  const avgLum = luminance(...surfaceAverage);
  const maxC = Math.max(...surfaceAverage);
  const minC = Math.min(...surfaceAverage);
  const neutral = maxC > 0 && (maxC - minC) / maxC < NEUTRAL_CHROMA;
  const exposure = neutral ? Math.min(1.1, Math.max(0.55, avgLum / NORMAL_EXPOSURE_LUMINANCE)) : 1;
  const lightTint = neutral
    ? surfaceAverage.map((c) => (avgLum > 0 ? c / avgLum : 1))
    : [1, 1, 1];

  // Dominant light: the brighter side of the surface, in front of it
  let lx = 0;
  let ly = 0;
  let lSum = 0;
  const low = [0, 0, 0];
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gh - 1.0001, Math.max(0, (y + 0.5) / cell - 0.5));
    const y0 = Math.floor(fy);
    const ty = fy - y0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const o = i * 4;
      if (mask[i] === 0) {
        texture[o] = texture[o + 1] = texture[o + 2] = 128;
        texture[o + 3] = 128;
        continue;
      }
      const fx = Math.min(gw - 1.0001, Math.max(0, (x + 0.5) / cell - 0.5));
      const x0 = Math.floor(fx);
      const tx = fx - x0;
      const g00 = y0 * gw + x0;
      const g10 = g00 + (x0 + 1 < gw ? 1 : 0);
      const g01 = g00 + (y0 + 1 < gh ? gw : 0);
      const g11 = g01 + (x0 + 1 < gw ? 1 : 0);
      for (let c = 0; c < 3; c++) {
        low[c] =
          (grid[g00 * 3 + c] * (1 - tx) + grid[g10 * 3 + c] * tx) * (1 - ty) +
          (grid[g01 * 3 + c] * (1 - tx) + grid[g11 * 3 + c] * tx) * ty;
      }
      const lowLum = luminance(low[0], low[1], low[2]);
      const pixLum = luminance(lin[i * 3], lin[i * 3 + 1], lin[i * 3 + 2]);
      const detail = 1 + (Math.min(1.2, Math.max(0.2, lowLum > 1e-5 ? pixLum / lowLum : 1)) - 1) * DETAIL_STRENGTH;
      for (let c = 0; c < 3; c++) {
        const illum = (surfaceAverage[c] > 1e-5 ? low[c] / surfaceAverage[c] : 1) * lightTint[c] * exposure;
        texture[o + c] = Math.round(Math.min(1, Math.max(0, illum * 0.5)) * 255);
      }
      texture[o + 3] = Math.round(Math.min(1, detail * 0.5) * 255);
      if (weight[i] > 0) {
        lx += x * lowLum;
        ly += y * lowLum;
        lSum += lowLum;
      }
    }
  }
  const span = Math.max(w, h) * 0.25;
  const dx = lSum > 0 ? (lx / lSum - cx) / span : 0;
  const dy = lSum > 0 ? (ly / lSum - cy) / span : 0;
  const len = Math.hypot(dx, dy - 0.3, 1);
  // Camera space: +x right, +y down, -z towards the camera; light usually a little above
  const lightDir: Vec3 = [dx / len, (dy - 0.3) / len, -1 / len];
  return { texture, surfaceAverage, lightDir };
};
