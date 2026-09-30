import { describe, expect, it } from 'vitest';
import { countertopCells } from '../../services/analysis/countertop';
import { PointMap } from '../../services/surfacePlaneFit';

// A camera 1.4 m above the floor looking level (y down): a floor band at the bottom, a counter
// top (0.9 m high) in the middle, and a wall above it
const W = 60;
const H = 60;
const room = (): { pm: PointMap; floor: number[] } => {
  const points = new Float32Array(W * H * 3);
  const normals = new Float32Array(W * H * 3);
  const floor: number[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      const X = (x - W / 2) * 0.05;
      if (y >= 45) {
        points.set([X, 1.4, 2 + (60 - y) * 0.05], i * 3); // floor, 1.4 m below the camera
        normals.set([0, -1, 0], i * 3);
        floor.push(i);
      } else if (y >= 25) {
        points.set([X, 0.5, 2 + (45 - y) * 0.05], i * 3); // counter top, 0.9 m above the floor
        normals.set([0, -1, 0], i * 3);
      } else {
        points.set([X, (y - 25) * 0.05, 4], i * 3); // wall, vertical
        normals.set([0, 0, -1], i * 3);
      }
    }
  }
  return { pm: { width: W, height: H, points, valid: new Uint8Array(W * H).fill(1), normals }, floor };
};

describe('countertopCells', () => {
  it('finds the horizontal surface at counter height, not the floor or the wall', () => {
    const { pm, floor } = room();
    const cells = countertopCells(pm, floor)!;
    expect(cells[30 * W + 30]).toBe(1); // counter
    expect(cells[50 * W + 30]).toBe(0); // floor
    expect(cells[10 * W + 30]).toBe(0); // wall
  });

  it('takes the lowest horizontal plane as the floor, even when the counter is labelled floor too', () => {
    const { pm, floor } = room();
    const mislabelled = [...floor];
    for (let y = 25; y < 45; y++) for (let x = 0; x < W; x++) mislabelled.push(y * W + x); // the counter, called "floor"
    const cells = countertopCells(pm, mislabelled)!;
    expect(cells[30 * W + 30]).toBe(1);
    expect(cells[50 * W + 30]).toBe(0);
  });

  it("doesn't take a counter labelled floor for the floor when no real floor is visible", () => {
    const { pm } = room();
    const counterOnly: number[] = [];
    for (let y = 25; y < 45; y++) for (let x = 0; x < W; x++) counterOnly.push(y * W + x); // only 0.9 m below the camera
    const cells = countertopCells(pm, counterOnly)!;
    expect(cells[30 * W + 30]).toBe(1);
  });

  it('falls back to a typical camera height when no floor is visible', () => {
    const { pm } = room();
    const cells = countertopCells(pm, [])!;
    expect(cells[30 * W + 30]).toBe(1);
    expect(cells[50 * W + 30]).toBe(0);
  });

  it('returns null when nothing is at counter height', () => {
    const { pm, floor } = room();
    for (let i = 0; i < W * H; i++) if (pm.points[i * 3 + 1] === 0.5) pm.points[i * 3 + 1] = 1.1; // a low table (0.3 m)
    expect(countertopCells(pm, floor)).toBeNull();
  });
});
