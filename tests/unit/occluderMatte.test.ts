import { describe, expect, it } from 'vitest';
import { matteOccluder } from '../../services/renderer/occluderMatte';

const W = 40;
const H = 40;

// A brown object (a toaster) in the middle of a white surface; its occluder is grown 2 px past it
// and its outer rim pixel is half object, half wall
const setup = () => {
  const rgba = new Uint8Array(W * H * 4);
  const occluder = new Float32Array(W * H);
  const inside = (x: number, y: number, m: number) => x >= 12 - m && x < 28 + m && y >= 12 - m && y < 28 + m;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const c = inside(x, y, 0) ? [150, 110, 70] : inside(x, y, 1) ? [200, 180, 160] : [250, 250, 250];
      rgba.set([...c, 255], i * 4);
      occluder[i] = inside(x, y, 2) ? 1 : 0;
    }
  return { rgba, occluder, mask: new Float32Array(W * H).fill(1) };
};

describe('matteOccluder', () => {
  it('drops the old surface from the occluder rim and keeps the object', () => {
    const { rgba, occluder, mask } = setup();
    const { occluder: out, background } = matteOccluder(rgba, mask, occluder, W, H);
    // Grown rim (pure wall): no longer occluded, its background is the wall
    expect(out[20 * W + 10]).toBe(0);
    expect(background[(20 * W + 10) * 3]).toBeCloseTo(250, 0);
    // Mixed rim pixel: partly occluded
    expect(out[20 * W + 11]).toBeGreaterThan(0.3);
    expect(out[20 * W + 11]).toBeLessThan(1);
    // The object itself and its interior stay fully occluded
    expect(out[20 * W + 12]).toBe(1);
    expect(out[20 * W + 20]).toBe(1);
    expect(Number.isNaN(background[(20 * W + 20) * 3])).toBe(true);
  });

  it('never raises the occluder and leaves pixels with no contrast alone', () => {
    const { rgba, occluder, mask } = setup();
    for (let i = 0; i < W * H; i++) rgba.set([250, 250, 250, 255], i * 4);
    const { occluder: out } = matteOccluder(rgba, mask, occluder, W, H);
    expect(Array.from(out)).toEqual(Array.from(occluder));
  });
});

describe('softProtect', () => {
  it('protects a thin dark line on a pale wall, softly, and not the wall', async () => {
    const { softProtect } = await import('../../scenes/recipeMask');
    const rgba = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) rgba.set(i % W === 20 ? [90, 70, 50, 255] : i % W === 21 ? [205, 198, 190, 255] : [235, 230, 222, 255], i * 4);
    const region = [[{ xPct: 0.25, yPct: 0.25 }, { xPct: 0.75, yPct: 0.25 }, { xPct: 0.75, yPct: 0.75 }, { xPct: 0.25, yPct: 0.75 }]];
    const m = softProtect(rgba, W, H, region);
    expect(m.alpha[20 * W + 20]).toBe(255);
    expect(m.alpha[20 * W + 21]).toBeGreaterThan(60);
    expect(m.alpha[20 * W + 21]).toBeLessThan(255);
    expect(m.alpha[20 * W + 15]).toBe(0);
    // Outside the region nothing
    expect(m.alpha[2 * W + 20]).toBe(0);
  });
});

describe('softProtect with a local surface', () => {
  it('keeps dark fronds before a wall whose light varies, not the wall', async () => {
    const { softProtect } = await import('../../scenes/recipeMask');
    // A wall brightening left to right (190 → 250), a darker frond line at x 20
    const rgba = new Uint8Array(W * H * 4);
    for (let i = 0; i < W * H; i++) {
      const x = i % W;
      const v = 190 + (60 * x) / W;
      rgba.set(x === 20 ? [v - 70, v - 80, v - 90, 255] : [v, v - 4, v - 8, 255], i * 4);
    }
    const region = [[{ xPct: 0, yPct: 0 }, { xPct: 1, yPct: 0 }, { xPct: 1, yPct: 1 }, { xPct: 0, yPct: 1 }]];
    const m = softProtect(rgba, W, H, region, 14, 45, 6);
    expect(m.alpha[20 * W + 20]).toBe(255);
    // The wall at both ends, far from the median, stays the wall's
    expect(m.alpha[20 * W + 2]).toBe(0);
    expect(m.alpha[20 * W + 37]).toBe(0);
  });
});
