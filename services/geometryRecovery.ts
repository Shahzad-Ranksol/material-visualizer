import { CameraIntrinsics } from '../types';

/**
 * MoGe predicts camera-space points up to an unknown depth shift. Like MoGe's own
 * `recover_focal_shift`, find the shift s (and the focal length f, in pixels) that make the
 * points project back onto their pixels:  (px - w/2, py - h/2) ≈ f · (x, y) / (z + s).
 * For a fixed s the best f has a closed form, so s is a 1-D golden-section search.
 * Pure maths (no DOM) — runs in the analysis worker and in tests.
 */
export const recoverFocalShift = (
  points: Float32Array, // xyz per pixel
  valid: Uint8Array,
  w: number,
  h: number,
  stride = 4
): { shift: number; focalPx: number; error: number } => {
  const xs: number[] = [];
  const ys: number[] = [];
  const zs: number[] = [];
  const us: number[] = [];
  const vs: number[] = [];
  for (let y = 0; y < h; y += stride) {
    for (let x = 0; x < w; x += stride) {
      const i = y * w + x;
      if (!valid[i]) continue;
      xs.push(points[i * 3]);
      ys.push(points[i * 3 + 1]);
      zs.push(points[i * 3 + 2]);
      us.push(x + 0.5 - w / 2);
      vs.push(y + 0.5 - h / 2);
    }
  }
  if (zs.length < 16) return { shift: 0, focalPx: 0.7 * Math.max(w, h), error: Infinity };
  const zMin = Math.min(...zs);
  const zMed = [...zs].sort((a, b) => a - b)[zs.length >> 1];

  const evaluate = (s: number) => {
    let num = 0;
    let den = 0;
    for (let k = 0; k < zs.length; k++) {
      const z = zs[k] + s;
      const px = xs[k] / z;
      const py = ys[k] / z;
      num += px * us[k] + py * vs[k];
      den += px * px + py * py;
    }
    const f = den > 0 ? num / den : 0;
    let err = 0;
    for (let k = 0; k < zs.length; k++) {
      const z = zs[k] + s;
      const du = f * (xs[k] / z) - us[k];
      const dv = f * (ys[k] / z) - vs[k];
      err += du * du + dv * dv;
    }
    return { f, err: err / zs.length };
  };

  // Shift must keep every point in front of the camera
  let lo = -zMin + Math.max(1e-3, Math.abs(zMed) * 0.02);
  let hi = Math.max(lo + 1e-3, Math.abs(zMed) * 20);
  const phi = (Math.sqrt(5) - 1) / 2;
  let a = hi - phi * (hi - lo);
  let b = lo + phi * (hi - lo);
  let fa = evaluate(a).err;
  let fb = evaluate(b).err;
  for (let it = 0; it < 80; it++) {
    if (fa < fb) {
      hi = b;
      b = a;
      fb = fa;
      a = hi - phi * (hi - lo);
      fa = evaluate(a).err;
    } else {
      lo = a;
      a = b;
      fa = fb;
      b = lo + phi * (hi - lo);
      fb = evaluate(b).err;
    }
  }
  const shift = (lo + hi) / 2;
  const { f, err } = evaluate(shift);
  return { shift, focalPx: f, error: Math.sqrt(err) };
};

export const intrinsicsFromFocal = (focalPx: number, w: number, h: number): CameraIntrinsics => ({
  fx: focalPx / w,
  fy: focalPx / h,
  cx: 0.5,
  cy: 0.5,
});
