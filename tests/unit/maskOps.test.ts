import { describe, expect, it } from 'vitest';
import { connectedComponents, guidedFilter, iou, refineBandByColor, removeSkirting } from '../../services/analysis/maskOps';

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
