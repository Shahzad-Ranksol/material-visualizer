import { Pt } from '../services/areaMaskOps';

// Pure (no DOM, unit-tested): snaps a hand-traced outline onto the photo's real edges. Fitted
// furniture is made of straight edges, so each side of the outline is moved — a few pixels along
// its normal and a fraction of a degree — to where the image's edge across it is strongest, and
// the corners become the snapped sides' intersections. Sides with no clear edge nearby (hidden
// behind a stool, on the photo's border) stay where they were traced.

export interface GrayImage {
  width: number;
  height: number;
  // Luminance 0–1
  data: Float32Array;
}

/** Gradient magnitude per pixel (Sobel), the photo's edges. */
export const gradientImage = (img: GrayImage): { gx: Float32Array; gy: Float32Array } => {
  const { width: w, height: h, data } = img;
  const gx = new Float32Array(w * h);
  const gy = new Float32Array(w * h);
  const at = (x: number, y: number) => data[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      gx[y * w + x] = at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x - 1, y) - at(x - 1, y + 1);
      gy[y * w + x] = at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1) - at(x - 1, y - 1) - 2 * at(x, y - 1) - at(x + 1, y - 1);
    }
  }
  return { gx, gy };
};

interface Line {
  p: Pt;
  d: Pt; // unit direction
}

const sub = (a: Pt, b: Pt): Pt => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a: Pt) => Math.hypot(a.x, a.y);

// Mean edge strength across a segment: the gradient component along its normal, sampled at
// points between 10% and 90% of its length (the corners are where other edges meet)
const edgeScore = (grad: { gx: Float32Array; gy: Float32Array }, w: number, h: number, a: Pt, b: Pt): number => {
  const d = sub(b, a);
  const l = len(d);
  if (l < 4) return 0;
  const n = { x: -d.y / l, y: d.x / l };
  const steps = Math.max(4, Math.round(l / 2));
  let sum = 0;
  let count = 0;
  for (let k = 0; k <= steps; k++) {
    const t = 0.1 + (0.8 * k) / steps;
    // Pixel i spans [i, i+1) — the convention fillPolygon rasterises with — so its centre is
    // i + 0.5; sampled bilinearly so a slightly tilted line scores lower than an aligned one
    const u = a.x + d.x * t - 0.5;
    const v = a.y + d.y * t - 0.5;
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    if (x0 < 1 || y0 < 1 || x0 >= w - 2 || y0 >= h - 2) continue;
    const fx = u - x0;
    const fy = v - y0;
    const i = y0 * w + x0;
    const lerp = (g: Float32Array) =>
      (g[i] * (1 - fx) + g[i + 1] * fx) * (1 - fy) + (g[i + w] * (1 - fx) + g[i + w + 1] * fx) * fy;
    sum += Math.abs(lerp(grad.gx) * n.x + lerp(grad.gy) * n.y);
    count++;
  }
  return count ? sum / count : 0;
};

const intersect = (l1: Line, l2: Line): Pt | null => {
  const den = l1.d.x * l2.d.y - l1.d.y * l2.d.x;
  if (Math.abs(den) < 1e-3) return null;
  const t = ((l2.p.x - l1.p.x) * l2.d.y - (l2.p.y - l1.p.y) * l2.d.x) / den;
  return { x: l1.p.x + l1.d.x * t, y: l1.p.y + l1.d.y * t };
};

export interface SnapOptions {
  // How far a side may move along its normal, px
  radius?: number;
  // How far it may turn, degrees
  maxTurnDeg?: number;
  // A side moves only if its best edge is this much stronger than where it was traced, and
  // this strong in absolute terms (luminance change across it)
  minGain?: number;
  minStrength?: number;
}

/** The outline with each side moved onto the strongest straight edge near it. */
export const snapPolygon = (
  points: Pt[],
  grad: { gx: Float32Array; gy: Float32Array },
  w: number,
  h: number,
  { radius = 6, maxTurnDeg = 3, minGain = 1.15, minStrength = 0.25 }: SnapOptions = {}
): Pt[] => {
  const n = points.length;
  if (n < 3) return points;
  const lines: Line[] = [];
  for (let i = 0; i < n; i++) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const d0 = sub(b, a);
    const l = len(d0);
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const base: Line = { p: mid, d: { x: d0.x / (l || 1), y: d0.y / (l || 1) } };
    // A side along the photo's border has nothing to snap to
    const onBorder = (q: Pt) => q.x <= 2 || q.y <= 2 || q.x >= w - 3 || q.y >= h - 3;
    if (l < 8 || (onBorder(a) && onBorder(b))) {
      lines.push(base);
      continue;
    }
    const traced = edgeScore(grad, w, h, a, b);
    let best = { score: traced, turn: 0, offs: [0] };
    // Coarse search over the whole range, then a fine one around the best
    const search = (turns: number[], offsets: number[], tie: number) => {
      for (const turn of turns) {
        const r = (turn * Math.PI) / 180;
        const d = { x: base.d.x * Math.cos(r) - base.d.y * Math.sin(r), y: base.d.x * Math.sin(r) + base.d.y * Math.cos(r) };
        const nrm = { x: -d.y, y: d.x };
        for (const off of offsets) {
          const p = { x: mid.x + nrm.x * off, y: mid.y + nrm.y * off };
          const half = l / 2;
          const score = edgeScore(grad, w, h, { x: p.x - d.x * half, y: p.y - d.y * half }, { x: p.x + d.x * half, y: p.y + d.y * half });
          // Equal scores at neighbouring offsets are one edge (a step lights up Sobel on both
          // sides of it), whose position is their middle
          if (score > best.score * (1 + tie)) best = { score, turn, offs: [off] };
          else if (turn === best.turn && score >= best.score * (1 - tie)) best.offs.push(off);
        }
      }
    };
    const range = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, k) => from + k * step);
    search(range(-maxTurnDeg, maxTurnDeg, 0.5), range(-radius, radius, 0.5), 1e-3);
    const coarseOff = best.offs.reduce((s2, o) => s2 + o, 0) / best.offs.length;
    const coarseTurn = best.turn;
    best = { ...best, offs: [coarseOff] };
    search(range(coarseTurn - 0.5, coarseTurn + 0.5, 0.1), range(coarseOff - 0.6, coarseOff + 0.6, 0.1), 1e-6);
    if (best.score >= minStrength && best.score >= traced * minGain) {
      const r = (best.turn * Math.PI) / 180;
      const d = { x: base.d.x * Math.cos(r) - base.d.y * Math.sin(r), y: base.d.x * Math.sin(r) + base.d.y * Math.cos(r) };
      const off = best.offs.reduce((s2, o) => s2 + o, 0) / best.offs.length;
      lines.push({ p: { x: mid.x - d.y * off, y: mid.y + d.x * off }, d });
    } else lines.push(base);
  }
  // Corners: where neighbouring snapped sides meet (kept near the traced corner)
  return points.map((orig, i) => {
    const q = intersect(lines[(i - 1 + n) % n], lines[i]);
    if (!q || len(sub(q, orig)) > radius * 2.5) return orig;
    return { x: Math.min(w, Math.max(0, q.x)), y: Math.min(h, Math.max(0, q.y)) };
  });
};
