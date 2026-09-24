import { beforeAll, describe, expect, it } from 'vitest';

// Node has no ImageData; a minimal stand-in is enough for the pure maths
beforeAll(() => {
  (globalThis as any).ImageData ??= class {
    constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
  };
});

const img = (w: number, h: number, fill: (x: number, y: number) => [number, number, number]) => {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) data.set([...fill(x, y), 255], (y * w + x) * 4);
  return new (globalThis as any).ImageData(data, w, h) as ImageData;
};

describe('studio lighting harmonisation', async () => {
  const { applyLowFrequencyHarmonization } = await import('../../services/renderer/studioLighting');
  const W = 64;
  const H = 48;
  const mask = new Float32Array(W * H).map((_, i) => (i % W >= 16 && i % W < 48 ? 1 : 0));

  it('changes nothing when the AI render equals the exact render', () => {
    const exact = img(W, H, (x) => [x * 3, 100, 150]);
    const out = applyLowFrequencyHarmonization(exact, exact, mask)!;
    for (let i = 0; i < exact.data.length; i++) expect(Math.abs(out.data[i] - exact.data[i])).toBeLessThanOrEqual(1);
  });

  it('never touches pixels outside the mask', () => {
    const exact = img(W, H, () => [120, 110, 100]);
    const ai = img(W, H, () => [150, 138, 125]);
    const out = applyLowFrequencyHarmonization(exact, ai, mask)!;
    expect(Array.from(out.data.slice(0, 4))).toEqual([120, 110, 100, 255]); // x = 0 is outside
  });

  it('clamps the lighting change and rejects colour drift', () => {
    const exact = img(W, H, () => [100, 100, 100]);
    const brighter = applyLowFrequencyHarmonization(exact, img(W, H, () => [255, 255, 255]), mask)!;
    expect(brighter.data[(10 * W + 30) * 4]).toBeLessThan(120); // exp(0.25) cap in linear light
    expect(applyLowFrequencyHarmonization(exact, img(W, H, () => [250, 60, 60]), mask)).toBeNull();
  });
});
