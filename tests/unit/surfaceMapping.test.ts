import { describe, expect, it } from 'vitest';
import { applyHomography, estimateAspect, invert3, solveHomography } from '../../services/planeGeometry';
import { buildSurfaceMapping, mapPixelToPlaneMm, projectPlaneMmToPixel } from '../../services/renderer/surfaceMapping';
import { SurfaceGeometry } from '../../types';

const W = 1600;
const H = 1000;

describe('homography', () => {
  it('maps the four source corners onto the destination corners', () => {
    const src = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
    const dst = [{ x: 100, y: 120 }, { x: 900, y: 80 }, { x: 950, y: 700 }, { x: 60, y: 640 }];
    const Hm = solveHomography(src, dst);
    src.forEach((p, i) => {
      const q = applyHomography(Hm, p.x, p.y);
      expect(q.x).toBeCloseTo(dst[i].x, 6);
      expect(q.y).toBeCloseTo(dst[i].y, 6);
    });
    const back = applyHomography(invert3(Hm), dst[2].x, dst[2].y);
    expect(back.x).toBeCloseTo(1, 6);
    expect(back.y).toBeCloseTo(1, 6);
  });
  it('recovers the pixel aspect ratio of a head-on rectangle', () => {
    const corners = [{ x: 400, y: 200 }, { x: 1200, y: 200 }, { x: 1200, y: 600 }, { x: 400, y: 600 }];
    expect(estimateAspect(corners, W, H)).toBeCloseTo(2, 3);
  });
});

describe('surface mapping', () => {
  // A wall 5 m in front of the camera, facing it; u right, v down
  const wall: SurfaceGeometry = {
    normal: [0, 0, -1],
    origin: [-2, -1.2, 5],
    axisU: [1, 0, 0],
    axisV: [0, 1, 0],
    intrinsics: { fx: 0.8, fy: 1.28, cx: 0.5, cy: 0.5 },
  };

  it('maps pixels to millimetres on a 3D plane and back', () => {
    const m = buildSurfaceMapping(wall, W, H)!;
    for (const [u, v] of [[0, 0], [1220, 2440], [3000, 500]]) {
      const px = projectPlaneMmToPixel(m, u, v, W, H)!;
      const mm = mapPixelToPlaneMm(m, px.x, px.y, W, H)!;
      expect(mm.u).toBeCloseTo(u, 3);
      expect(mm.v).toBeCloseTo(v, 3);
    }
  });

  it('scales the layout from a two-point calibration', () => {
    const raw = buildSurfaceMapping(wall, W, H)!;
    const a = projectPlaneMmToPixel(raw, 0, 0, W, H)!;
    const b = projectPlaneMmToPixel(raw, 0, 2000, W, H)!; // model says 2000 mm
    const calibrated = buildSurfaceMapping(wall, W, H, { p1: [a.x / W, a.y / H], p2: [b.x / W, b.y / H], distanceMm: 2700 })!;
    const p = mapPixelToPlaneMm(calibrated, b.x, b.y, W, H)!;
    expect(p.v).toBeCloseTo(2700, 1); // the user's measurement wins
  });

  it('round-trips the four-corner fallback', () => {
    const geometry: SurfaceGeometry = {
      homographyFallback: {
        corners: [{ xPct: 10, yPct: 10 }, { xPct: 90, yPct: 5 }, { xPct: 95, yPct: 80 }, { xPct: 5, yPct: 85 }],
        heightMm: 2700,
      },
    };
    const m = buildSurfaceMapping(geometry, W, H)!;
    const topLeft = mapPixelToPlaneMm(m, 0.1 * W, 0.1 * H, W, H)!;
    expect(topLeft.u).toBeCloseTo(0, 3);
    expect(topLeft.v).toBeCloseTo(0, 3);
    const bottomLeft = mapPixelToPlaneMm(m, 0.05 * W, 0.85 * H, W, H)!;
    expect(bottomLeft.v).toBeCloseTo(2700, 2);
  });

  it('returns null for rays that miss the plane', () => {
    const floor: SurfaceGeometry = { ...wall, normal: [0, -1, 0], origin: [0, 1.3, 2], axisV: [0, 0, -1] };
    const m = buildSurfaceMapping(floor, W, H)!;
    expect(mapPixelToPlaneMm(m, W / 2, 10, W, H)).toBeNull(); // above the horizon
  });
});
