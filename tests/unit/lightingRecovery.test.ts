import { describe, expect, it } from 'vitest';
import { recoverLighting } from '../../services/renderer/lightingRecovery';

// A w×h surface, every pixel inside the mask, brighter on the right half
const surface = (rgb: [number, number, number], w = 32, h = 32) => {
  const room = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const k = i % w >= w / 2 ? 1 : 0.6;
    room[i * 4] = rgb[0] * k;
    room[i * 4 + 1] = rgb[1] * k;
    room[i * 4 + 2] = rgb[2] * k;
    room[i * 4 + 3] = 255;
  }
  return { room, mask: new Float32Array(w * h).fill(1), w, h };
};

describe('recoverLighting', () => {
  it('on coloured old paint, recovers grey light (no colour from the paint)', () => {
    const { room, mask, w, h } = surface([10, 110, 120]); // saturated teal, red channel near empty
    const { texture } = recoverLighting(room, mask, null, w, h);
    for (let i = 0; i < w * h; i++) {
      expect(texture[i * 4]).toBe(texture[i * 4 + 1]);
      expect(texture[i * 4 + 1]).toBe(texture[i * 4 + 2]);
    }
    // …but the brighter side still gets more light
    const row = 16 * w;
    expect(texture[(row + w - 2) * 4]).toBeGreaterThan(texture[(row + 1) * 4]);
  });

  it('on neutral old paint, keeps the light per channel', () => {
    const { room, mask, w, h } = surface([200, 195, 185]); // warm white wall (near-neutral in linear light)
    const { texture } = recoverLighting(room, mask, null, w, h);
    const i = (16 * w + 20) * 4;
    expect(texture[i]).toBeGreaterThan(texture[i + 2]); // the warm tint carries over
  });
});

describe('recoverLighting detail', () => {
  const detailOf = (values: number[]) => {
    // The values as columns of a 16-row strip; read back the middle row
    const w = values.length;
    const h = 16;
    const room = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) values.forEach((v, x) => room.set([v, v, v, 255], (y * w + x) * 4));
    const { texture } = recoverLighting(room, new Float32Array(w * h).fill(1), null, w, h);
    return values.map((_, x) => texture[(8 * w + x) * 4 + 3]);
  };

  it("drops the old surface's faint texture (grain) but keeps strong shading (a groove)", () => {
    // Faint grain: ±2% around 180 in sRGB (about ±5% in linear light) → no detail at all (128 = "no change")
    const grain = detailOf(Array.from({ length: 64 }, (_, i) => (i % 4 < 2 ? 184 : 176)));
    expect(new Set(grain)).toEqual(new Set([128]));
    // A dark groove in an even surface still darkens the new finish
    const groove = detailOf(Array.from({ length: 64 }, (_, i) => (i === 32 ? 60 : 180)));
    expect(groove[32]).toBeLessThan(110);
  });
});
