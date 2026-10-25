import { describe, expect, it } from 'vitest';
import { emptyMask } from '../../services/areaMaskOps';
import { blendStyle, featherInside, maskBounds, Rgba, seamGain, stylePatch } from '../../scenes/styleBlend';

const W = 40;
const H = 30;
const solid = (r: number, g: number, b: number): Rgba => {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([r, g, b, 255], i * 4);
  return { width: W, height: H, data };
};
// Region: x 10–29, y 8–21
const region = () => {
  const m = emptyMask(W, H);
  for (let y = 8; y < 22; y++) for (let x = 10; x < 30; x++) m.alpha[y * W + x] = 255;
  return m;
};

describe('style blending', () => {
  it('feathers only inside the region', () => {
    const f = featherInside(region(), 4);
    expect(f.alpha[0]).toBe(0);
    expect(f.alpha[15 * W + 9]).toBe(0); // just outside
    expect(f.alpha[15 * W + 20]).toBe(255); // deep inside
    expect(f.alpha[15 * W + 10]).toBeGreaterThan(0); // the edge ramps
    expect(f.alpha[15 * W + 10]).toBeLessThan(255);
  });

  it('leaves every pixel outside the region byte-identical', () => {
    const original = solid(120, 110, 100);
    const candidate = solid(200, 30, 30);
    const out = blendStyle(original, candidate, featherInside(region(), 4), [1, 1, 1]);
    const inside = region();
    for (let i = 0; i < W * H; i++) {
      if (inside.alpha[i]) continue;
      expect([...out.data.slice(i * 4, i * 4 + 3)]).toEqual([120, 110, 100]);
    }
    expect(out.data[(15 * W + 20) * 4]).toBe(200);
  });

  it("matches the candidate's colour to the photo on the ring outside", () => {
    const original = solid(100, 100, 100);
    const candidate = solid(110, 100, 90); // the AI drifted warmer
    const [r, g, b] = seamGain(original, candidate, region());
    expect(110 * r).toBeCloseTo(100, 0);
    expect(g).toBeCloseTo(1, 5);
    expect(90 * b).toBeCloseTo(100, 0);
    // …but never by more than the clamp
    expect(seamGain(solid(100, 100, 100), solid(250, 100, 20), region())).toEqual([0.8, 1, 1.25]);
  });

  it('the shipped patch reproduces the blend when drawn at its rect', () => {
    const original = solid(120, 110, 100);
    const candidate = solid(60, 90, 140);
    const weight = featherInside(region(), 4);
    const blended = blendStyle(original, candidate, weight, [1, 1, 1]);
    const { rect, patch } = stylePatch(candidate, weight, [1, 1, 1])!;
    expect(rect).toEqual(maskBounds(weight));
    // Source-over composite of the patch at rect
    for (let y = 0; y < rect.h; y++) {
      for (let x = 0; x < rect.w; x++) {
        const p = (y * rect.w + x) * 4;
        const o = ((rect.y + y) * W + rect.x + x) * 4;
        const a = patch.data[p + 3] / 255;
        for (let c = 0; c < 3; c++) expect(Math.abs(Math.round(original.data[o + c] * (1 - a) + patch.data[p + c] * a) - blended.data[o + c])).toBeLessThanOrEqual(1);
      }
    }
  });
});
