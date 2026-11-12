import { describe, expect, it } from 'vitest';
import { applyGain, distanceTo, glossStreaks, lightGain, maskedBlur } from '../../scenes/lightRefine';
import { linearToSrgb } from '../../services/renderer/colorSpace';

const W = 80;
const H = 40;

// A surface whose photo is albedo × light, with the light model's shading flat at 1 (the light
// left in the albedo, as Marigold does with the under-cabinet pools)
const scene = (light: (x: number, y: number) => number, albedo: (x: number, y: number) => number) => {
  const photo = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const v = Math.round(linearToSrgb(light(x, y) * albedo(x, y)) * 255);
      photo.set([v, v, v, 255], (y * W + x) * 4);
    }
  return { width: W, height: H, photo, shading: new Float32Array(W * H * 3).fill(1), reflection: new Float32Array(W * H * 3) };
};
const full = () => new Float32Array(W * H).fill(1);

describe('lightGain', () => {
  it('moves a smooth light pool from the albedo into the shading', () => {
    const pool = (x: number, y: number) => 0.6 + 0.5 * Math.exp(-((x - 40) ** 2 + (y - 20) ** 2) / 300);
    const layers = scene(pool, () => 0.5);
    const gain = lightGain(layers, full(), null, { sigma: 3 });
    applyGain(layers.shading, gain);
    // The shading now follows the pool: its centre is brighter than a corner by the pool's ratio
    const ratio = layers.shading[(20 * W + 40) * 3] / layers.shading[(5 * W + 5) * 3];
    expect(ratio).toBeGreaterThan(1.5);
    expect(ratio).toBeLessThan(2);
  });

  it('leaves fine detail (grain, grout) in the albedo', () => {
    const layers = scene(() => 0.8, (x) => (x % 2 ? 0.3 : 0.6));
    const gain = lightGain(layers, full(), null, { sigma: 6 });
    for (let y = 10; y < 30; y++) for (let x = 10; x < 70; x++) expect(Math.abs(Math.log(gain[y * W + x]))).toBeLessThan(0.05);
  });

  it('is 1 outside the item and only near the occluder with `near`', () => {
    const shadow = (x: number) => (x < 20 ? 0.4 : 1);
    const layers = scene(shadow, () => 0.5);
    const mask = full();
    for (let i = 0; i < W * H; i++) if (i % W >= 60) mask[i] = 0;
    const occluder = new Float32Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < 10; x++) occluder[y * W + x] = 1;
    const gain = lightGain(layers, mask, occluder, { sigma: 2, near: 15 });
    expect(gain[20 * W + 65]).toBe(1);
    expect(gain[20 * W + 50]).toBe(1);
    expect(gain[20 * W + 12]).toBeLessThan(0.8);
  });
});

describe('contrast and gloss', () => {
  it('expands the light around its median with `contrast`', () => {
    const pool = (x: number) => (x < 40 ? 1 : 0.5);
    const layers = scene(pool, () => 0.5);
    for (let i = 0; i < W * H; i++) layers.shading.fill(pool(i % W), i * 3, i * 3 + 3);
    const gain = lightGain(layers, full(), null, { sigma: 0, contrast: 2 });
    // The light was 2:1; squared it is 4:1
    const ratio = (pool(10) * gain[20 * W + 10]) / (pool(70) * gain[20 * W + 70]);
    expect(ratio).toBeCloseTo(4, 1);
  });

  it('takes vertical reflection streaks into the reflection, not diagonal boards', () => {
    // Diagonal boards (alternating tone along x + y) and one bright vertical streak at x 40–43
    const layers = scene(() => 0.8, (x, y) => (Math.floor((x + y) / 6) % 2 ? 0.45 : 0.55) * (x >= 40 && x < 44 ? 1.6 : 1));
    const extra = glossStreaks(layers, full(), { along: 10, across: 12 });
    expect(extra[20 * W + 41]).toBeGreaterThan(0.05);
    let boards = 0;
    for (let y = 10; y < 30; y++) for (let x = 5; x < 30; x++) boards = Math.max(boards, extra[y * W + x]);
    expect(boards).toBeLessThan(0.01);
  });
});

describe('maskedBlur and distanceTo', () => {
  it('averages only the weighted pixels', () => {
    const v = new Float32Array(W * H);
    const wgt = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) if (i % W < 40) [v[i], wgt[i]] = [2, 1];
    const out = maskedBlur(v, wgt, W, H, 4);
    expect(out[20 * W + 39]).toBeCloseTo(2, 5);
  });

  it('measures px to the nearest seed', () => {
    const seed = new Float32Array(W * H);
    seed[20 * W + 10] = 1;
    const d = distanceTo(seed, W, H);
    expect(d[20 * W + 10]).toBe(0);
    expect(d[20 * W + 16]).toBeCloseTo(6, 5);
  });
});

describe('frontLines', () => {
  it('carries the gap between two fronts, not the grain', async () => {
    const { frontLines } = await import('../../scenes/lightRefine');
    // Log albedo: faint grain (±0.03) everywhere, a dark slot (−0.4) at x 40–41
    const logA = new Float32Array(W * H);
    const weight = new Float32Array(W * H).fill(1);
    for (let i = 0; i < W * H; i++) logA[i] = (i % W === 40 || i % W === 41 ? -0.4 : 0) + (i % 2 ? 0.03 : -0.03);
    const out = frontLines(logA, weight, W, H, { sigma: 2.5, threshold: 0.08 });
    expect(out[20 * W + 40]).toBeLessThan(-0.2);
    for (let x = 10; x < 34; x++) expect(Math.abs(out[20 * W + x])).toBe(0);
    // The item's own rim carries nothing
    expect(Math.abs(out[0])).toBe(0);
  });
});

describe('matchFactors', () => {
  it('brings each item of a group to the group’s median light, per channel', async () => {
    const { matchFactors, applyFactors } = await import('../../scenes/lightRefine');
    const n = W * H;
    const shading = new Float32Array(n * 3);
    const a = new Float32Array(n);
    const b = new Float32Array(n);
    // Item a lit 1.0 neutral (left half), item b lit warmer and dimmer (right half)
    for (let i = 0; i < n; i++) {
      const left = i % W < W / 2;
      (left ? a : b)[i] = 1;
      shading.set(left ? [1, 1, 1] : [0.8, 0.7, 0.6], i * 3);
    }
    const f = matchFactors(shading, [a, b]);
    applyFactors(shading, a, f[0]);
    applyFactors(shading, b, f[1]);
    const at = (x: number) => Array.from(shading.subarray((20 * W + x) * 3, (20 * W + x) * 3 + 3));
    for (let c = 0; c < 3; c++) expect(at(10)[c]).toBeCloseTo(at(70)[c], 5);
  });
});
