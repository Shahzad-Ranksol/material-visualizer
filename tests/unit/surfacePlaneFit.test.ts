import { describe, expect, it } from 'vitest';
import { fitSurfacePlanes, offPlaneCells, PointMap } from '../../services/surfacePlaneFit';
import { recoverFocalShift } from '../../services/geometryRecovery';

// Synthetic room corner seen by a pinhole camera: left wall x = -2 m, back wall z = 6 m
const W = 160;
const H = 100;
const F = 120; // focal length in pixels
const cornerRoom = (): PointMap => {
  const points = new Float32Array(W * H * 3);
  const valid = new Uint8Array(W * H).fill(1);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const dir = [(x + 0.5 - W / 2) / F, (y + 0.5 - H / 2) / F, 1];
      const tBack = 6 / dir[2];
      const tLeft = dir[0] < 0 ? -2 / dir[0] : Infinity;
      const t = Math.min(tBack, tLeft);
      points.set([dir[0] * t, dir[1] * t, dir[2] * t], (y * W + x) * 3);
    }
  }
  return { width: W, height: H, points, valid };
};

describe('plane fitting', () => {
  it('splits a wall mask across a corner into two planes', () => {
    const m = cornerRoom();
    const all = Array.from({ length: W * H }, (_, i) => i);
    const planes = fitSurfacePlanes(m, all, { orientation: 'vertical', seed: 3 });
    expect(planes.length).toBe(2);
    const normals = planes.map((p) => p.normal.map((v) => Math.round(v * 100) / 100 + 0)); // + 0 drops -0
    expect(normals).toContainEqual([0, 0, -1]); // back wall faces the camera
    expect(normals.some((n) => Math.abs(n[0]) > 0.99)).toBe(true); // side wall
    planes.forEach((p) => {
      expect(p.residual).toBeLessThan(0.01);
      expect(p.axisV[1]).toBeGreaterThan(0.99); // layout "down" follows gravity on walls
    });
  });

  it('is deterministic for the same input', () => {
    const m = cornerRoom();
    const all = Array.from({ length: W * H }, (_, i) => i);
    const a = fitSurfacePlanes(m, all, { orientation: 'vertical', seed: 9 });
    const b = fitSurfacePlanes(m, all, { orientation: 'vertical', seed: 9 });
    expect(a.map((p) => p.normal)).toEqual(b.map((p) => p.normal));
  });
});

describe('focal/shift recovery', () => {
  it('recovers the depth shift and focal length of a pinhole point map', () => {
    const shift = 1.5;
    const m = cornerRoom();
    // What MoGe would output: the same points with the depth shifted by an unknown amount
    const shifted = Float32Array.from(m.points, (v, i) => (i % 3 === 2 ? v - shift : v));
    const res = recoverFocalShift(shifted, m.valid, W, H, 2);
    expect(res.shift).toBeCloseTo(shift, 2);
    expect(res.focalPx).toBeCloseTo(F, 0);
    expect(res.error).toBeLessThan(0.5);
  });
});

describe('offPlaneCells', () => {
  // Back wall z = 6 m, with a cushion 1 m in front (z = 5) and a mirror reflection 0.3 m behind (z = 6.3)
  const room = (): PointMap => {
    const points = new Float32Array(W * H * 3);
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const z = x < 20 ? 5 : x >= 140 ? 6.3 : 6;
        points.set([((x + 0.5 - W / 2) / F) * z, ((y + 0.5 - H / 2) / F) * z, z], (y * W + x) * 3);
      }
    }
    return { width: W, height: H, points, valid: new Uint8Array(W * H).fill(1) };
  };

  it('marks points in front of and behind every plane, not those on one', () => {
    const m = room();
    const wall = Array.from({ length: W * H }, (_, i) => i).filter((i) => i % W >= 20 && i % W < 140);
    const planes = fitSurfacePlanes(m, wall, { orientation: 'vertical', seed: 1 });
    const off = offPlaneCells(m, planes, 0.03);
    expect(off[50 * W + 10]).toBe(1); // cushion, in front
    expect(off[50 * W + 150]).toBe(1); // reflection, 5% behind
    expect(off[50 * W + 80]).toBe(0); // wall
  });

  it("never marks points the geometry model doesn't trust", () => {
    const m = room();
    m.valid.fill(0);
    const wall = Array.from({ length: W * H }, (_, i) => i).filter((i) => i % W >= 20 && i % W < 140);
    const planes = fitSurfacePlanes(room(), wall, { orientation: 'vertical', seed: 1 });
    expect(offPlaneCells(m, planes, 0.03).every((v) => v === 0)).toBe(true);
  });
});
