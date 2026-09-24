/**
 * Mask operations shared by room analysis — pure typed-array maths (no DOM), so they run in
 * the analysis worker and in unit tests. Masks are w*h arrays: binary (0/1) or soft (0-255).
 */

// Box mean over a (2r+1)^2 window using a summed-area table; edges use the clipped window
export const boxMean = (src: Float32Array, w: number, h: number, r: number): Float32Array => {
  const sat = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += src[y * w + x];
      sat[(y + 1) * (w + 1) + x + 1] = sat[y * (w + 1) + x + 1] + row;
    }
  }
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const sum = sat[y1 * (w + 1) + x1] - sat[y0 * (w + 1) + x1] - sat[y1 * (w + 1) + x0] + sat[y0 * (w + 1) + x0];
      out[y * w + x] = sum / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
};

/**
 * He et al.'s guided filter (grayscale guide): pulls a binary mask's edge onto the photo's own
 * edges, then re-sharpens it into a crisp matte with a 1-2px soft edge. Returns 0-255.
 */
export const guidedFilter = (guide: Float32Array, mask: Uint8Array, w: number, h: number, r: number, eps: number, sharpness: number) => {
  const n = w * h;
  const p = new Float32Array(n);
  const ip = new Float32Array(n);
  const ii = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    p[i] = mask[i] ? 1 : 0;
    ip[i] = guide[i] * p[i];
    ii[i] = guide[i] * guide[i];
  }
  const meanI = boxMean(guide, w, h, r);
  const meanP = boxMean(p, w, h, r);
  const corrIP = boxMean(ip, w, h, r);
  const corrII = boxMean(ii, w, h, r);
  const a = new Float32Array(n);
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const varI = corrII[i] - meanI[i] * meanI[i];
    a[i] = (corrIP[i] - meanI[i] * meanP[i]) / (varI + eps);
    b[i] = meanP[i] - a[i] * meanI[i];
  }
  const meanA = boxMean(a, w, h, r);
  const meanB = boxMean(b, w, h, r);
  const q = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const v = meanA[i] * guide[i] + meanB[i];
    q[i] = Math.round(255 * Math.min(1, Math.max(0, (v - 0.5) * sharpness + 0.5)));
  }
  return q;
};

/** 4-connected region of pixels where `inside(i)` holds, grown from `start`. */
export const floodRegion = (w: number, h: number, start: number, inside: (i: number) => boolean): Uint8Array => {
  const region = new Uint8Array(w * h);
  if (!inside(start)) return region;
  const stack = [start];
  region[start] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    const neighbours = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
    for (const n of neighbours) {
      if (n >= 0 && n < region.length && !region[n] && inside(n)) {
        region[n] = 1;
        stack.push(n);
      }
    }
  }
  return region;
};

/** Connected components of a binary mask, largest first (each as its pixel indices). */
export const connectedComponents = (mask: Uint8Array, w: number, h: number): number[][] => {
  const seen = new Uint8Array(mask.length);
  const comps: number[][] = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || seen[s]) continue;
    const comp: number[] = [];
    const stack = [s];
    seen[s] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      comp.push(i);
      const x = i % w;
      for (const n of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (n >= 0 && n < mask.length && mask[n] && !seen[n]) {
          seen[n] = 1;
          stack.push(n);
        }
      }
    }
    comps.push(comp);
  }
  return comps.sort((a, b) => b.length - a.length);
};

export const bbox = (mask: Uint8Array, w: number) => {
  let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1;
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
};

/**
 * Points deepest inside a mask (chamfer distance transform maxima), well spread out — good
 * positive prompts for SAM and pin positions. The photo border counts as an edge.
 */
export const interiorPoints = (mask: Uint8Array, w: number, h: number, count: number): Array<{ x: number; y: number }> => {
  const dist = new Float32Array(w * h);
  for (let i = 0; i < dist.length; i++) dist[i] = mask[i] ? 1e9 : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!dist[i]) continue;
      dist[i] = Math.min(dist[i], x > 0 ? dist[i - 1] + 1 : 1, y > 0 ? dist[i - w] + 1 : 1);
    }
  }
  for (let y = h - 1; y >= 0; y--) {
    for (let x = w - 1; x >= 0; x--) {
      const i = y * w + x;
      if (!dist[i]) continue;
      dist[i] = Math.min(dist[i], x < w - 1 ? dist[i + 1] + 1 : 1, y < h - 1 ? dist[i + w] + 1 : 1);
    }
  }
  const points: Array<{ x: number; y: number }> = [];
  const minSpacing = Math.max(w, h) * 0.12;
  for (let k = 0; k < count; k++) {
    let best = -1;
    let bestD = 0;
    for (let i = 0; i < dist.length; i++) {
      if (dist[i] <= bestD) continue;
      const x = i % w;
      const y = (i - x) / w;
      if (points.some((p) => Math.hypot(p.x - x, p.y - y) < minSpacing)) continue;
      best = i;
      bestD = dist[i];
    }
    if (best < 0 || bestD < 3) break;
    points.push({ x: best % w, y: Math.floor(best / w) });
  }
  return points;
};

export const iou = (a: Uint8Array, b: Uint8Array) => {
  let inter = 0;
  let uni = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] > 0;
    const y = b[i] > 0;
    if (x && y) inter++;
    if (x || y) uni++;
  }
  return uni ? inter / uni : 0;
};

/** Share of a mask's boundary pixels that sit on a real image edge (gradient above `minEdge`). */
export const boundaryEdgeAgreement = (mask: Uint8Array, gray: Float32Array, w: number, h: number, minEdge = 0.04) => {
  let boundary = 0;
  let onEdge = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!mask[i]) continue;
      if (mask[i - 1] && mask[i + 1] && mask[i - w] && mask[i + w]) continue;
      boundary++;
      const gx = gray[i + 1] - gray[i - 1];
      const gy = gray[i + w] - gray[i - w];
      if (Math.hypot(gx, gy) / 2 > minEdge) onEdge++;
    }
  }
  return boundary ? onEdge / boundary : 0;
};

// Skirting boards: ADE20K labels them "wall". Their top edge is a strong horizontal edge in a
// narrow band just above where the wall meets the floor; everything below it is kept original.
const SKIRTING_MAX_HEIGHT = 0.07;
const SKIRTING_MIN_HEIGHT = 0.008;
const SKIRTING_MIN_EDGE = 0.04;

export const removeSkirting = (binary: Uint8Array, gray: Float32Array, w: number, h: number, seed = 7) => {
  const maxBand = Math.round(h * SKIRTING_MAX_HEIGHT);
  const minBand = Math.max(2, Math.round(h * SKIRTING_MIN_HEIGHT));
  const samples: Array<{ x: number; y: number }> = [];
  for (let x = 0; x < w; x += 2) {
    let bottom = -1;
    for (let y = h - 1; y >= 0; y--) {
      if (binary[y * w + x]) {
        bottom = y;
        break;
      }
    }
    if (bottom < 0 || bottom >= h - 2) continue;
    let bestY = -1;
    let bestEdge = SKIRTING_MIN_EDGE;
    for (let y = bottom - minBand; y >= Math.max(2, bottom - maxBand); y--) {
      if (!binary[y * w + x]) break;
      const edge = Math.abs(gray[y * w + x] - gray[(y - 2) * w + x]);
      if (edge > bestEdge) {
        bestEdge = edge;
        bestY = y - 1;
      }
    }
    if (bestY >= 0) samples.push({ x, y: bestY });
  }
  if (samples.length < 20) return;
  let state = seed;
  const rand = () => ((state = (state * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const tol = Math.max(2, h * 0.004);
  let best: { a: number; b: number } | null = null;
  let bestInliers = 0;
  for (let it = 0; it < 300; it++) {
    const p = samples[Math.floor(rand() * samples.length)];
    const q = samples[Math.floor(rand() * samples.length)];
    if (Math.abs(q.x - p.x) < w * 0.05) continue;
    const slope = (q.y - p.y) / (q.x - p.x);
    if (Math.abs(slope) > 0.15) continue;
    const icpt = p.y - slope * p.x;
    let inliers = 0;
    for (const r of samples) if (Math.abs(slope * r.x + icpt - r.y) <= tol) inliers++;
    if (inliers > bestInliers) {
      bestInliers = inliers;
      best = { a: slope, b: icpt };
    }
  }
  if (!best || bestInliers < samples.length * 0.4) return;
  for (let x = 0; x < w; x++) {
    const top = Math.round(best.a * x + best.b);
    for (let y = Math.max(0, top); y <= Math.min(h - 1, top + maxBand); y++) binary[y * w + x] = 0;
  }
};

/** Grows a binary mask by r pixels (square structuring element). */
export const dilate = (mask: Uint8Array, w: number, h: number, r: number): Uint8Array => {
  const f = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) f[i] = mask[i] ? 1 : 0;
  const m = boxMean(f, w, h, r);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = m[i] > 0 ? 1 : 0;
  return out;
};

/** Shrinks a binary mask by r pixels. */
export const erode = (mask: Uint8Array, w: number, h: number, r: number): Uint8Array => {
  const f = new Float32Array(mask.length);
  for (let i = 0; i < mask.length; i++) f[i] = mask[i] ? 1 : 0;
  const m = boxMean(f, w, h, r);
  const out = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) out[i] = m[i] > 0.999 ? 1 : 0;
  return out;
};

// Weight of log-brightness next to chromaticity in the matting colour distance
const LUMA_WEIGHT = 8;
// Feature distance within which a pixel matches the surface when no foreground is near
const LONE_MATCH = 12;

// Compare colours by chromaticity plus a little log-brightness, so the same paint in sunlight
// and in shade still matches, while a white frame and a beige wall stay apart
const colourFeatures = (rgb: Uint8Array | Uint8ClampedArray, channels: number, n: number) => {
  const feat = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  for (let i = 0; i < n; i++) {
    const r = rgb[i * channels] + 1;
    const g = rgb[i * channels + 1] + 1;
    const b = rgb[i * channels + 2] + 1;
    const sum = r + g + b;
    feat[0][i] = (r / sum) * 600;
    feat[1][i] = (g / sum) * 600;
    feat[2][i] = Math.log(sum) * LUMA_WEIGHT;
  }
  return feat;
};

// Largest colour step between neighbouring pixels that still counts as the same surface
const GROW_STEP = 2.5;

/**
 * Grows a surface mask into neighbouring pixels it continues into without any visible edge —
 * e.g. wall the class map labelled as part of a mirror. An object in front of the surface always
 * shows an edge against it, so growth stops there. Only adds pixels allowed by `allowed`, at
 * most `maxPx` from the original mask, whose colour also matches the surface's overall colour.
 */
export const growAcrossContinuousColour = (
  surface: Uint8Array,
  rgb: Uint8Array | Uint8ClampedArray,
  channels: number,
  w: number,
  h: number,
  maxPx: number,
  allowed: (i: number) => boolean
): Uint8Array => {
  const n = w * h;
  const feat = colourFeatures(rgb, channels, n);
  const mean = [0, 0, 0];
  let count = 0;
  for (let i = 0; i < n; i++) {
    if (!surface[i]) continue;
    for (let c = 0; c < 3; c++) mean[c] += feat[c][i];
    count++;
  }
  const out = Uint8Array.from(surface);
  if (!count) return out;
  for (let c = 0; c < 3; c++) mean[c] /= count;
  const step = (a: number, b: number) => Math.hypot(feat[0][a] - feat[0][b], feat[1][a] - feat[1][b], feat[2][a] - feat[2][b]);
  const depth = new Int32Array(n).fill(-1);
  let frontier: number[] = [];
  for (let i = 0; i < n; i++) if (surface[i]) depth[i] = 0;
  // Start from the mask's edge pixels only
  for (let i = 0; i < n; i++) {
    if (!surface[i]) continue;
    const x = i % w;
    if ((x > 0 && !surface[i - 1]) || (x < w - 1 && !surface[i + 1]) || (i >= w && !surface[i - w]) || (i < n - w && !surface[i + w])) frontier.push(i);
  }
  for (let d = 1; d <= maxPx && frontier.length; d++) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w;
      const neighbours = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i < n - w ? i + w : -1];
      for (const j of neighbours) {
        if (j < 0 || depth[j] >= 0 || !allowed(j)) continue;
        if (step(i, j) > GROW_STEP) continue;
        if (Math.hypot(feat[0][j] - mean[0], feat[1][j] - mean[1], feat[2][j] - mean[2]) >= LONE_MATCH) continue;
        depth[j] = d;
        out[j] = 1;
        next.push(j);
      }
    }
    frontier = next;
  }
  return out;
};

/**
 * Colour matting in the uncertain band around a coarse mask edge (SAM predicts on a 256px grid,
 * so it carves blobs around leaves and thin objects). Each band pixel joins the side whose local
 * mean colour it matches: `surface` seeds are well inside the mask, `background` seeds are known
 * foreground objects. Only pixels allowed by `reclaimable` may be added; returns a new mask.
 * With `trusted`, only surface pixels it confirms seed the surface colour; the rest of the mask
 * (e.g. where SAM spilled past the class map) must match that colour to stay, locally or — when
 * no trusted pixel is near — against the surface's overall colour.
 */
export const refineBandByColor = (
  surface: Uint8Array,
  background: Uint8Array,
  rgb: Uint8Array | Uint8ClampedArray,
  channels: number,
  w: number,
  h: number,
  bandPx: number,
  windowPx: number,
  reclaimable: (i: number) => boolean,
  trusted?: Uint8Array
): Uint8Array => {
  // Every band pixel needs reference colours within reach, so the window always covers the band
  windowPx = Math.max(windowPx, bandPx + 4);
  const fgSeed = erode(trusted ? Uint8Array.from(surface, (v, i) => (v && trusted[i] ? 1 : 0)) : surface, w, h, 2);
  const band = dilate(surface, w, h, bandPx);
  const n = w * h;
  const feat = colourFeatures(rgb, channels, n);
  const meanOf = (seed: Uint8Array) => {
    const cnt = new Float32Array(n);
    const sums = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
    for (let i = 0; i < n; i++) {
      if (!seed[i]) continue;
      cnt[i] = 1;
      for (let c = 0; c < 3; c++) sums[c][i] = feat[c][i];
    }
    return { cnt: boxMean(cnt, w, h, windowPx), sums: sums.map((s) => boxMean(s, w, h, windowPx)) };
  };
  const fg = meanOf(fgSeed);
  const global = [0, 0, 0];
  let globalCount = 0;
  for (let i = 0; i < n; i++) {
    if (!fgSeed[i]) continue;
    for (let c = 0; c < 3; c++) global[c] += feat[c][i];
    globalCount++;
  }
  const globalDist = (i: number) => Math.hypot(...[0, 1, 2].map((c) => feat[c][i] - global[c] / globalCount));
  const bgSeed = erode(background, w, h, 1);
  const bg = meanOf(bgSeed);
  const out = Uint8Array.from(surface);
  for (let i = 0; i < n; i++) {
    if (!band[i] || fgSeed[i] || bgSeed[i]) continue;
    if (fg.cnt[i] <= 0) {
      // Untrusted mask far from any trusted surface: keep it only if it's the surface's colour
      if (trusted && surface[i] && !trusted[i] && globalCount > 0) {
        if (globalDist(i) >= LONE_MATCH) out[i] = 0;
      }
      continue;
    }
    const dist = (m: { cnt: Float32Array; sums: Float32Array[] }) =>
      Math.hypot(...[0, 1, 2].map((c) => feat[c][i] - m.sums[c][i] / m.cnt[i]));
    const dFg = dist(fg);
    const isSurface = bg.cnt[i] > 0 ? dFg < dist(bg) * 0.9 : dFg < LONE_MATCH;
    if (isSurface && reclaimable(i)) out[i] = 1;
    else if (!isSurface && surface[i] && bg.cnt[i] > 0) out[i] = 0;
  }
  return out;
};
