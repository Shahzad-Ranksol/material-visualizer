import { describe, expect, it } from 'vitest';
import { meanLinear, recolorReference, recolorSurface } from '../../services/renderer/recolor';
import { linearToSrgb, SRGB8_TO_LINEAR } from '../../services/renderer/colorSpace';
import { decodeIntrinsics, Intrinsics } from '../../services/renderer/intrinsics';

const SHADING_SCALE = 0.5;

const lum = (rgba: ArrayLike<number>, o: number) =>
  0.2126 * SRGB8_TO_LINEAR[rgba[o]] + 0.7152 * SRGB8_TO_LINEAR[rgba[o + 1]] + 0.0722 * SRGB8_TO_LINEAR[rgba[o + 2]];

describe('recolorSurface', () => {
  // Two pale slats (200) with a dark gap (60) between, and a pixel outside the mask
  const original = new Uint8ClampedArray([200, 190, 170, 255, 60, 57, 51, 255, 200, 190, 170, 255, 10, 200, 10, 255]);
  const mask = new Float32Array([1, 1, 1, 0]);

  it('gives the typical (median) pixel the target colour and keeps the design (the gap stays darker)', () => {
    const out = new Uint8ClampedArray(original);
    const target: [number, number, number] = [0.02, 0.02, 0.02]; // charcoal
    recolorSurface(original, out, mask, null, target);
    const slat = meanLinear(out.slice(0, 4));
    expect(slat[0]).toBeCloseTo(0.02, 2);
    expect(out[4]).toBeLessThan(out[0]); // gap darker than slat
    expect(lum(out, 4) / lum(out, 0)).toBeCloseTo(lum(original, 4) / lum(original, 0), 1);
    expect([...out.slice(12, 16)]).toEqual([10, 200, 10, 255]); // outside: untouched
  });

  it('takes the target hue: an orange board turned grey stays grey, not orange-tinted', () => {
    const cedar = new Uint8ClampedArray([200, 120, 70, 255, 190, 115, 65, 255]);
    const out = new Uint8ClampedArray(cedar);
    recolorSurface(cedar, out, new Float32Array([1, 1]), null, [0.3, 0.3, 0.3]);
    expect(Math.abs(out[0] - out[2])).toBeLessThanOrEqual(2);
  });

  it('keeps a sunlit run brighter than a shaded one when they share a reference', () => {
    // Part A in the sun, part B in the shade, same timber
    const photo = new Uint8ClampedArray([220, 150, 100, 255, 110, 75, 50, 255]);
    const a = new Float32Array([1, 0]);
    const b = new Float32Array([0, 1]);
    const ref = recolorReference(photo, [a, b], null);
    const out = new Uint8ClampedArray(photo);
    recolorSurface(photo, out, a, null, [0.2, 0.2, 0.2], ref);
    recolorSurface(photo, out, b, null, [0.2, 0.2, 0.2], ref);
    expect(lum(out, 0)).toBeGreaterThan(lum(out, 4) * 2);
  });

  it('leaves occluded pixels untouched', () => {
    const out = new Uint8ClampedArray(original);
    recolorSurface(original, out, mask, new Float32Array([0, 1, 0, 0]), [0.5, 0.1, 0.1]);
    expect([...out.slice(4, 8)]).toEqual([60, 57, 51, 255]);
  });
});

// A photo made from known layers: photo = albedo × shading + reflection (linear), 8-bit sRGB
const synth = (albedo: number[][], shading: number[][], reflection: number[][]) => {
  const n = albedo.length;
  const photo = new Uint8ClampedArray(n * 4);
  const s8 = new Uint8ClampedArray(n * 4);
  const r8 = new Uint8ClampedArray(n * 4);
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < 3; c++) {
      photo[i * 4 + c] = Math.round(linearToSrgb(albedo[i][c] * shading[i][c] + reflection[i][c]) * 255);
      s8[i * 4 + c] = Math.round(linearToSrgb(shading[i][c] * SHADING_SCALE) * 255);
      r8[i * 4 + c] = Math.round(linearToSrgb(reflection[i][c]) * 255);
    }
    photo[i * 4 + 3] = s8[i * 4 + 3] = r8[i * 4 + 3] = 255;
  }
  const intrinsics = { ...decodeIntrinsics(s8, r8, n, SHADING_SCALE) } as unknown as Intrinsics;
  return { photo, intrinsics };
};

// CIE Lab ΔE76 between two linear sRGB colours
const lab = ([r, g, b]: number[]) => {
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.9505;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.089;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
};
const deltaE = (a: number[], b: number[]) => Math.hypot(...lab(a).map((v, i) => v - lab(b)[i]));

describe('recolorSurface with the baked light', () => {
  const cedar = [0.45, 0.2, 0.08];
  // Board 1 in sun (warm light), board 2 in shade (cool, dim), board 3 in sun with a highlight
  const shading = [[1.1, 1.0, 0.85], [0.3, 0.33, 0.38], [1.1, 1.0, 0.85]];
  const reflection = [[0, 0, 0], [0, 0, 0], [0.05, 0.05, 0.05]];
  const { photo, intrinsics } = synth([cedar, cedar, cedar], shading, reflection);
  const mask = new Float32Array([1, 1, 1]);

  for (const [name, target] of [['charcoal', [0.03, 0.03, 0.03]], ['white', [0.8, 0.8, 0.78]], ['navy', [0.02, 0.04, 0.12]], ['sage', [0.25, 0.32, 0.22]]] as const) {
    it(`lands on the ${name} swatch exactly: (rendered − reflection) / shading = the swatch, ΔE < 2`, () => {
      const out = new Uint8ClampedArray(photo);
      recolorSurface(photo, out, mask, null, [...target], recolorReference(photo, [mask], null, intrinsics), intrinsics);
      for (let i = 0; i < 3; i++) {
        const albedo = [0, 1, 2].map((c) => (SRGB8_TO_LINEAR[out[i * 4 + c]] - reflection[i][c]) / shading[i][c]);
        expect(deltaE(albedo, [...target])).toBeLessThan(2);
      }
    });
  }

  it("keeps the photo's light: the shaded board stays darker, the highlight stays on", () => {
    const out = new Uint8ClampedArray(photo);
    recolorSurface(photo, out, mask, null, [0.3, 0.3, 0.3], recolorReference(photo, [mask], null, intrinsics), intrinsics);
    expect(lum(out, 4)).toBeLessThan(lum(out, 0) * 0.4);
    expect(lum(out, 8)).toBeGreaterThan(lum(out, 0));
  });
});
