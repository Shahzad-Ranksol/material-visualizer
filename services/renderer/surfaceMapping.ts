import { CameraIntrinsics, SurfaceCalibration, SurfaceGeometry, Vec3 } from '../../types';
import { ASSUMED_FOCAL_FRACTION, Mat3, applyHomography, invert3, planeToImageHomography } from '../planeGeometry';

/**
 * How image pixels map to real millimetres on a surface — the single source of truth for
 * layout, used by the WebGL shader (same maths), the calibration ruler and the tests.
 *  - plane:      each pixel's camera ray is intersected with the fitted 3D plane (metres)
 *  - homography: the vendor's four-corner rectangle, image px -> plane mm
 * `scale` corrects model-estimated size with a user calibration (1 when uncalibrated).
 */
export type SurfaceMapping =
  | { kind: 'plane'; normal: Vec3; origin: Vec3; axisU: Vec3; axisV: Vec3; intrinsics: CameraIntrinsics; scale: number }
  | { kind: 'homography'; imageToPlane: Mat3; scale: number };

const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

export const defaultIntrinsics = (w: number, h: number): CameraIntrinsics => {
  const f = ASSUMED_FOCAL_FRACTION * Math.max(w, h);
  return { fx: f / w, fy: f / h, cx: 0.5, cy: 0.5 };
};

/** Camera-space ray (x right, y down, z forward) through pixel (px, py). */
export const cameraRay = (k: CameraIntrinsics, px: number, py: number, w: number, h: number): Vec3 => [
  (px / w - k.cx) / k.fx,
  (py / h - k.cy) / k.fy,
  1,
];

const rawPlaneMm = (m: SurfaceMapping, px: number, py: number, w: number, h: number): { u: number; v: number } | null => {
  if (m.kind === 'homography') {
    const p = applyHomography(m.imageToPlane, px, py);
    return Number.isFinite(p.x) && Number.isFinite(p.y) ? { u: p.x, v: p.y } : null;
  }
  const ray = cameraRay(m.intrinsics, px, py, w, h);
  const denom = dot(m.normal, ray);
  if (Math.abs(denom) < 1e-9) return null;
  const t = dot(m.normal, m.origin) / denom;
  if (t <= 0) return null;
  const d: Vec3 = [ray[0] * t - m.origin[0], ray[1] * t - m.origin[1], ray[2] * t - m.origin[2]];
  return { u: dot(d, m.axisU) * 1000, v: dot(d, m.axisV) * 1000 };
};

/** Real-world position (mm) on the surface under image pixel (px, py), or null off the plane. */
export const mapPixelToPlaneMm = (m: SurfaceMapping, px: number, py: number, w: number, h: number) => {
  const p = rawPlaneMm(m, px, py, w, h);
  return p ? { u: p.u * m.scale, v: p.v * m.scale } : null;
};

/**
 * Builds the mapping for a surface's geometry. A fitted 3D plane wins; otherwise the
 * four-corner fallback. Null when the surface has no usable geometry.
 */
export const buildSurfaceMapping = (
  geometry: SurfaceGeometry | null | undefined,
  w: number,
  h: number,
  calibration?: SurfaceCalibration | null
): SurfaceMapping | null => {
  let mapping: SurfaceMapping | null = null;
  if (geometry?.normal && geometry.origin && geometry.axisU && geometry.axisV) {
    mapping = {
      kind: 'plane',
      normal: geometry.normal,
      origin: geometry.origin,
      axisU: geometry.axisU,
      axisV: geometry.axisV,
      intrinsics: geometry.intrinsics ?? defaultIntrinsics(w, h),
      scale: 1,
    };
  } else if (geometry?.homographyFallback) {
    const { H } = planeToImageHomography(geometry.homographyFallback, w, h);
    mapping = { kind: 'homography', imageToPlane: invert3(H), scale: 1 };
  }
  if (!mapping) return null;
  if (calibration) {
    const a = rawPlaneMm(mapping, calibration.p1[0] * w, calibration.p1[1] * h, w, h);
    const b = rawPlaneMm(mapping, calibration.p2[0] * w, calibration.p2[1] * h, w, h);
    const measured = a && b ? Math.hypot(a.u - b.u, a.v - b.v) : 0;
    if (measured > 1e-6) mapping.scale = calibration.distanceMm / measured;
  }
  return mapping;
};

/** Image pixel of a real-world surface position (mm) — the inverse of mapPixelToPlaneMm. */
export const projectPlaneMmToPixel = (m: SurfaceMapping, uMm: number, vMm: number, w: number, h: number): { x: number; y: number } | null => {
  const u = uMm / m.scale;
  const v = vMm / m.scale;
  if (m.kind === 'homography') {
    const p = applyHomography(invert3(m.imageToPlane), u, v);
    return Number.isFinite(p.x) && Number.isFinite(p.y) ? p : null;
  }
  const P: Vec3 = [
    m.origin[0] + (m.axisU[0] * u + m.axisV[0] * v) / 1000,
    m.origin[1] + (m.axisU[1] * u + m.axisV[1] * v) / 1000,
    m.origin[2] + (m.axisU[2] * u + m.axisV[2] * v) / 1000,
  ];
  if (P[2] <= 1e-6) return null;
  return { x: (m.intrinsics.cx + (m.intrinsics.fx * P[0]) / P[2]) * w, y: (m.intrinsics.cy + (m.intrinsics.fy * P[1]) / P[2]) * h };
};

/** Real-world extent (mm) of a surface: min/max u,v over its mask pixels (sampled). */
export const surfaceExtentMm = (m: SurfaceMapping, mask: HTMLCanvasElement, step = 6) => {
  const { width: w, height: h } = mask;
  const data = mask.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (let y = 0; y < h; y += step) {
    for (let x = 0; x < w; x += step) {
      if (data[(y * w + x) * 4 + 3] < 128) continue;
      const p = mapPixelToPlaneMm(m, x + 0.5, y + 0.5, w, h);
      if (!p) continue;
      minU = Math.min(minU, p.u);
      maxU = Math.max(maxU, p.u);
      minV = Math.min(minV, p.v);
      maxV = Math.max(maxV, p.v);
    }
  }
  return Number.isFinite(minU) ? { minU, maxU, minV, maxV } : null;
};
