import { describe, expect, it } from 'vitest';
import { connectedComponents, connectedTo, guidedFilter, iou, largeComponents, refineBandByColor, removeSkirting, upscaleMaskLogits } from '../../services/analysis/maskOps';

const W = 60;
const H = 40;
const rect = (x0: number, y0: number, x1: number, y1: number) => {
  const m = new Uint8Array(W * H);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) m[y * W + x] = 1;
  return m;
};

describe('mask operations', () => {
  it('keeps disconnected regions apart', () => {
    const m = rect(2, 2, 10, 10);
    rect(30, 5, 50, 30).forEach((v, i) => v && (m[i] = 1));
    const comps = connectedComponents(m, W, H);
    expect(comps.map((c) => c.length)).toEqual([500, 64]);
  });

  it('guided filter snaps a nearby coarse edge onto the real image edge (from both sides)', () => {
    // Real edge between x = 29 and x = 30
    const gray = new Float32Array(W * H).map((_, i) => (i % W < 30 ? 0.8 : 0.2));
    const row = 20 * W;
    const edgeAt = (q: Uint8Array) => Array.from(q.slice(row, row + W)).findIndex((v) => v < 128);
    // Off by one pixel either way: snapped exactly
    expect(edgeAt(guidedFilter(gray, rect(0, 0, 29, H), W, H, 4, 1e-4, 6))).toBe(30);
    expect(edgeAt(guidedFilter(gray, rect(0, 0, 31, H), W, H, 4, 1e-4, 6))).toBe(30);
    // Off by two: pulled to within one pixel
    expect(Math.abs(edgeAt(guidedFilter(gray, rect(0, 0, 28, H), W, H, 4, 1e-4, 6)) - 30)).toBeLessThanOrEqual(1);
    expect(Math.abs(edgeAt(guidedFilter(gray, rect(0, 0, 32, H), W, H, 4, 1e-4, 6)) - 30)).toBeLessThanOrEqual(1);
  });

  it('colour matting reclaims wall-coloured pixels next to foliage, never others', () => {
    const rgb = new Uint8Array(W * H * 3);
    for (let i = 0; i < W * H; i++) {
      const x = i % W;
      const plant = x >= 40 && x < 50;
      rgb.set(plant ? [30, 120, 40] : [220, 210, 190], i * 3);
    }
    const sam = rect(0, 0, 33, H); // SAM stopped 7px short of the plant
    const plantMask = rect(40, 0, 50, H);
    const refined = refineBandByColor(sam, plantMask, rgb, 3, W, H, 10, 12, (i) => i % W < 55);
    expect(refined[20 * W + 37]).toBe(1); // wall between SAM's edge and the plant: reclaimed
    expect(refined[20 * W + 45]).toBe(0); // the plant itself: never
    const locked = refineBandByColor(sam, plantMask, rgb, 3, W, H, 10, 12, () => false);
    expect(locked[20 * W + 37]).toBe(0); // not reclaimable -> untouched
  });

  it("doesn't reclaim a dark frame line just because it's nearer the wall than the foliage", () => {
    const rgb = new Uint8Array(W * H * 3);
    for (let i = 0; i < W * H; i++) {
      const x = i % W;
      // wall | dark picture-frame line (x 35-37) | plant
      rgb.set(x >= 40 && x < 50 ? [30, 120, 40] : x >= 35 && x < 38 ? [40, 38, 36] : [220, 210, 190], i * 3);
    }
    const sam = rect(0, 0, 33, H);
    const refined = refineBandByColor(sam, rect(40, 0, 50, H), rgb, 3, W, H, 10, 12, (i) => i % W < 55);
    expect(refined[20 * W + 34]).toBe(1); // wall before the frame: reclaimed
    expect(refined[20 * W + 36]).toBe(0); // the frame line: never
    // Wall in shade (half as bright) still matches
    for (let i = 0; i < W * H; i++) if (i % W >= 35 && i % W < 38) rgb.set([110, 105, 95], i * 3);
    const shaded = refineBandByColor(sam, rect(40, 0, 50, H), rgb, 3, W, H, 10, 12, (i) => i % W < 55);
    expect(shaded[20 * W + 36]).toBe(1);
  });

  it('removes a skirting band below its top edge', () => {
    const w = 200;
    const h = 200;
    const gray = new Float32Array(w * h).fill(0.8);
    for (let y = 180; y < 190; y++) for (let x = 0; x < w; x++) gray[y * w + x] = 0.95; // skirting board
    const wall = new Uint8Array(w * h);
    for (let i = 0; i < 190 * w; i++) wall[i] = 1; // wall label reaches the floor at y = 190
    removeSkirting(wall, gray, w, h);
    expect(wall[100 * w + 50]).toBe(1);
    expect(wall[185 * w + 50]).toBe(0);
  });

  it('computes IoU', () => {
    expect(iou(rect(0, 0, 10, 10), rect(5, 0, 15, 10))).toBeCloseTo(50 / 150, 9);
  });
});

describe('upscaleMaskLogits', () => {
  it('samples each cell exactly when every size matches', () => {
    const logits = { dims: [1, 1, 1, 2, 2], data: [1, -1, -1, 1] };
    expect(Array.from(upscaleMaskLogits(logits, [2, 2], [2, 2], [2, 2])[0])).toEqual([1, 0, 0, 1]);
  });

  it('upscales each candidate to the photo size, splitting at the zero crossing', () => {
    // Two candidates over a 2x2 grid: left column on / right column on
    const logits = { dims: [1, 1, 2, 2, 2], data: [1, -1, 1, -1, -1, 1, -1, 1] };
    const [left, right] = upscaleMaskLogits(logits, [4, 8], [4, 8], [4, 8]);
    const row = (m: Uint8Array, y: number) => Array.from(m.slice(y * 8, y * 8 + 8));
    for (let y = 0; y < 4; y++) {
      expect(row(left, y)).toEqual([1, 1, 1, 1, 0, 0, 0, 0]);
      expect(row(right, y)).toEqual([0, 0, 0, 0, 1, 1, 1, 1]);
    }
  });

  it('maps the photo onto the resized part of a padded input, not the whole grid', () => {
    // 4 cells, the image filled only the left 2 (the rest is padding)
    const logits = { dims: [1, 1, 1, 1, 4], data: [1, -1, -1, -1] };
    expect(Array.from(upscaleMaskLogits(logits, [1, 2], [1, 4], [1, 4])[0])).toEqual([1, 1, 0, 0]);
    // Treating the whole grid as the image would squash it: only the first pixel stays on
    expect(Array.from(upscaleMaskLogits(logits, [1, 4], [1, 4], [1, 4])[0])).toEqual([1, 0, 0, 0]);
  });
});

describe('connectedTo', () => {
  it('keeps the mask pixels reachable from the seeds and drops islands', () => {
    // 6x1: [1 1 0 1 1 0], seed at 0 -> only the first run survives
    const mask = Uint8Array.from([1, 1, 0, 1, 1, 0]);
    const seeds = Uint8Array.from([1, 0, 0, 0, 0, 0]);
    expect(Array.from(connectedTo(mask, seeds, 6, 1))).toEqual([1, 1, 0, 0, 0, 0]);
  });

  it('connects through 4-neighbours only, not diagonals', () => {
    // 2x2 diagonal: seed top-left, other pixel bottom-right
    const mask = Uint8Array.from([1, 0, 0, 1]);
    expect(Array.from(connectedTo(mask, Uint8Array.from([1, 0, 0, 0]), 2, 2))).toEqual([1, 0, 0, 0]);
  });
});

describe('largeComponents', () => {
  it('keeps only components of at least minPx pixels', () => {
    // 5x2: a 4-px block on the left, a lone pixel on the right
    const mask = Uint8Array.from([1, 1, 0, 0, 1, 1, 1, 0, 0, 0]);
    expect(Array.from(largeComponents(mask, 5, 2, 3))).toEqual([1, 1, 0, 0, 0, 1, 1, 0, 0, 0]);
  });
});
