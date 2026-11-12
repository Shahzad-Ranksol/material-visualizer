/**
 * Clean edges where an object stands in front of a painted surface (a toaster before a tiled
 * splashback).
 *
 * A baked occluder is hard-edged and grown a pixel past the object (SAM's cut, `dilateDisc(…, 1)`),
 * so its rim holds pixels that are the old surface, or a mix of object and old surface. Restored
 * as they are, they leave a ring of the old material (white tile) around the object on the new
 * one (dark concrete). Here, in a thin band at the occluder's edge, each pixel is explained as
 * alpha × object + (1 − alpha) × old surface, from the mean colours of the object's interior and
 * the visible surface close by. The occluder there becomes that alpha (never more than it was),
 * and `background` gives the old surface's colour, so the composite can swap exactly the old
 * surface's share for the new finish: out = photo + (1 − occluder) × (new − background).
 */
export interface OccluderMatte {
  occluder: Float32Array;
  // Per pixel RGB (0–255) of the old surface behind a band pixel; NaN where not estimated
  background: Float32Array;
}

// Band width (px into the occluder from its edge) and the window the colours are averaged over
const BAND = 3;
const RADIUS = 5;
// Object and surface must differ by this much (RGB distance) for an estimate
const MIN_CONTRAST = 24;
// Bias toward keeping the object (a highlight on chrome resembles a white wall)
const KEEP_BIAS = 1.25;

export const matteOccluder = (rgba: ArrayLike<number>, mask: Float32Array, occluder: Float32Array, w: number, h: number): OccluderMatte => {
  const n = w * h;
  const out = new Float32Array(occluder);
  const background = new Float32Array(n * 3).fill(NaN);
  // Distance (in px steps, 4-connected) from the visible surface into the occluder, up to BAND + RADIUS
  const LIMIT = BAND + RADIUS;
  const dist = new Uint8Array(n).fill(255);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) {
    if (mask[i] >= 0.5 && occluder[i] < 0.5) {
      dist[i] = 0;
      frontier.push(i);
    }
  }
  for (let d = 1; d <= LIMIT && frontier.length; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= n || dist[j] !== 255 || occluder[j] < 0.5) continue;
        dist[j] = d;
        next.push(j);
      }
    }
    frontier = next;
  }
  for (let i = 0; i < n; i++) {
    if (dist[i] === 0 || dist[i] > BAND || mask[i] < 0.5) continue;
    const x = i % w;
    const y = (i - x) / w;
    let fr = 0, fg = 0, fb = 0, fn = 0;
    let br = 0, bg = 0, bb = 0, bn = 0;
    for (let yy = Math.max(0, y - RADIUS); yy <= Math.min(h - 1, y + RADIUS); yy++)
      for (let xx = Math.max(0, x - RADIUS); xx <= Math.min(w - 1, x + RADIUS); xx++) {
        const j = yy * w + xx;
        const p = j * 4;
        if (dist[j] === 0 && mask[j] >= 0.9 && occluder[j] <= 0.05) {
          br += rgba[p]; bg += rgba[p + 1]; bb += rgba[p + 2]; bn++;
        } else if (occluder[j] >= 0.95 && dist[j] > BAND) {
          fr += rgba[p]; fg += rgba[p + 1]; fb += rgba[p + 2]; fn++;
        }
      }
    if (!bn || !fn) continue;
    const B = [br / bn, bg / bn, bb / bn];
    const F = [fr / fn, fg / fn, fb / fn];
    const d = [F[0] - B[0], F[1] - B[1], F[2] - B[2]];
    const dd = d[0] * d[0] + d[1] * d[1] + d[2] * d[2];
    if (dd < MIN_CONTRAST * MIN_CONTRAST) continue;
    const p = i * 4;
    const alpha = ((rgba[p] - B[0]) * d[0] + (rgba[p + 1] - B[1]) * d[1] + (rgba[p + 2] - B[2]) * d[2]) / dd;
    out[i] = Math.min(occluder[i], Math.max(0, Math.min(1, alpha * KEEP_BIAS)));
    background[i * 3] = B[0];
    background[i * 3 + 1] = B[1];
    background[i * 3 + 2] = B[2];
  }
  return { occluder: out, background };
};
