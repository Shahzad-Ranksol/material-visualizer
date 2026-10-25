import { describe, expect, it } from 'vitest';
import { meanLinear, recolorSurface } from '../../services/renderer/recolor';
import { SRGB8_TO_LINEAR } from '../../services/renderer/colorSpace';

describe('recolorSurface', () => {
  // A pale slat (200) with a dark gap (60) between, and a pixel outside the mask
  const original = new Uint8ClampedArray([200, 190, 170, 255, 60, 57, 51, 255, 200, 190, 170, 255, 10, 200, 10, 255]);
  const mask = new Float32Array([1, 1, 1, 0]);

  it('takes the target colour on average but keeps the design (the gap stays darker)', () => {
    const out = new Uint8ClampedArray(original);
    const target: [number, number, number] = [0.02, 0.02, 0.02]; // charcoal
    recolorSurface(original, out, mask, null, target);
    const avg = meanLinear(out.slice(0, 12));
    expect(avg[0]).toBeCloseTo(0.02, 2);
    expect(out[4]).toBeLessThan(out[0]); // gap darker than slat
    expect(SRGB8_TO_LINEAR[out[4]] / SRGB8_TO_LINEAR[out[0]]).toBeCloseTo(SRGB8_TO_LINEAR[60] / SRGB8_TO_LINEAR[200], 1);
    expect([...out.slice(12, 16)]).toEqual([10, 200, 10, 255]); // outside: untouched
  });

  it('leaves occluded pixels untouched', () => {
    const out = new Uint8ClampedArray(original);
    recolorSurface(original, out, mask, new Float32Array([0, 1, 0, 0]), [0.5, 0.1, 0.1]);
    expect([...out.slice(4, 8)]).toEqual([60, 57, 51, 255]);
  });
});
