import { Vec3 } from '../types';

/**
 * Plane fitting on a camera-space point map (x right, y down, z forward; metres) — e.g. from
 * MoGe. Pure maths with no DOM, so it runs in the analysis worker and in unit tests.
 */

export interface PointMap {
  width: number;
  height: number;
  // xyz per pixel, camera space
  points: Float32Array;
  // 1 where the geometry model trusts the point
  valid: Uint8Array;
  // Optional per-pixel unit normals, camera space
  normals?: Float32Array;
}

export interface FittedPlane {
  normal: Vec3; // unit, facing the camera
  origin: Vec3; // top-left corner of the surface in plane coordinates
  axisU: Vec3; // layout "right" along the surface
  axisV: Vec3; // layout "down" (walls: gravity; floors/ceilings: towards the camera)
  residual: number; // RMS distance of inliers to the plane (m)
  inlierRatio: number; // share of the region's valid points on the plane
  normalConsistency: number; // mean |n_point · n_plane| (1 = perfectly flat), or 1 without normals
  // Point-map pixel indices that belong to this plane
  pixels: Uint32Array;
}

export type PlaneOrientation = 'vertical' | 'floor' | 'ceiling';

const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s];
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const normalize = (a: Vec3): Vec3 => {
  const l = Math.hypot(a[0], a[1], a[2]) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};
const projectOnPlane = (v: Vec3, n: Vec3): Vec3 => sub(v, scale(n, dot(v, n)));

// Deterministic PRNG so the same photo always yields the same planes (render determinism)
const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const pointAt = (m: PointMap, i: number): Vec3 => [m.points[i * 3], m.points[i * 3 + 1], m.points[i * 3 + 2]];

/**
 * RANSAC plane over the given pixel indices. `threshold` scales with depth (models are less
 * precise far away): a point is an inlier within threshold x its distance from the camera.
 */
const ransacPlane = (m: PointMap, pixels: number[], threshold: number, iterations: number, rand: () => number) => {
  let bestN: Vec3 | null = null;
  let bestD = 0;
  let bestCount = 0;
  for (let it = 0; it < iterations; it++) {
    const a = pointAt(m, pixels[Math.floor(rand() * pixels.length)]);
    const b = pointAt(m, pixels[Math.floor(rand() * pixels.length)]);
    const c = pointAt(m, pixels[Math.floor(rand() * pixels.length)]);
    const n = cross(sub(b, a), sub(c, a));
    const len = Math.hypot(n[0], n[1], n[2]);
    if (len < 1e-9) continue;
    const nn = scale(n, 1 / len);
    const d = dot(nn, a);
    let count = 0;
    for (let k = 0; k < pixels.length; k += 2) {
      const p = pointAt(m, pixels[k]);
      if (Math.abs(dot(nn, p) - d) <= threshold * p[2]) count++;
    }
    if (count > bestCount) {
      bestCount = count;
      bestN = nn;
      bestD = d;
    }
  }
  return bestN ? { n: bestN, d: bestD } : null;
};

// Least-squares refit (PCA smallest eigenvector via power iteration on the inverse-free cov trick)
const refitPlane = (m: PointMap, inliers: number[]): { n: Vec3; centroid: Vec3 } => {
  let c: Vec3 = [0, 0, 0];
  for (const i of inliers) c = add(c, pointAt(m, i));
  c = scale(c, 1 / inliers.length);
  const cov = [0, 0, 0, 0, 0, 0, 0, 0, 0];
  for (const i of inliers) {
    const p = sub(pointAt(m, i), c);
    for (let r = 0; r < 3; r++) for (let q = 0; q < 3; q++) cov[r * 3 + q] += p[r] * p[q];
  }
  // Smallest eigenvector = largest eigenvector of (trace*I - cov)
  const tr = cov[0] + cov[4] + cov[8];
  const M = cov.map((v, k) => (k % 4 === 0 ? tr - v : -v));
  let v: Vec3 = [0.3, 0.5, 0.8];
  for (let it = 0; it < 60; it++) {
    v = normalize([M[0] * v[0] + M[1] * v[1] + M[2] * v[2], M[3] * v[0] + M[4] * v[1] + M[5] * v[2], M[6] * v[0] + M[7] * v[1] + M[8] * v[2]]);
  }
  return { n: v, centroid: c };
};

/**
 * Gravity-aligned layout basis on the plane. Walls: v = down (camera +y projected), u = right.
 * Floors/ceilings: v points towards the camera (rows run away from the viewer), u = right.
 */
const layoutBasis = (n: Vec3, orientation: PlaneOrientation) => {
  const down: Vec3 = [0, 1, 0];
  const right: Vec3 = [1, 0, 0];
  let axisV: Vec3;
  if (orientation === 'vertical') {
    axisV = projectOnPlane(down, n);
  } else {
    // Towards the camera along the surface
    axisV = projectOnPlane([0, 0, -1], n);
  }
  if (Math.hypot(axisV[0], axisV[1], axisV[2]) < 1e-6) axisV = projectOnPlane(right, n);
  axisV = normalize(axisV);
  let axisU = normalize(cross(axisV, n));
  if (dot(axisU, right) < 0) axisU = scale(axisU, -1);
  return { axisU, axisV };
};

export interface PlaneFitOptions {
  orientation: PlaneOrientation;
  // Relative inlier threshold (fraction of depth)
  threshold?: number;
  // Stop looking for further planes when fewer than this share of points remain
  minPlaneShare?: number;
  maxPlanes?: number;
  seed?: number;
}

/**
 * Fits one or more planes to the point-map pixels of a region (sequential RANSAC): a wall
 * mask spanning a corner becomes two planes, so each wall gets its own perspective.
 * Planes are returned largest first.
 */
export const fitSurfacePlanes = (m: PointMap, regionPixels: number[], opts: PlaneFitOptions): FittedPlane[] => {
  const threshold = opts.threshold ?? 0.012;
  const minShare = opts.minPlaneShare ?? 0.15;
  const maxPlanes = opts.maxPlanes ?? 3;
  const rand = mulberry32(opts.seed ?? 12345);
  const valid = regionPixels.filter((i) => m.valid[i]);
  if (valid.length < 50) return [];
  let remaining = valid;
  const planes: FittedPlane[] = [];
  while (planes.length < maxPlanes && remaining.length >= valid.length * minShare) {
    const coarse = ransacPlane(m, remaining, threshold, 250, rand);
    if (!coarse) break;
    const isIn = (i: number) => {
      const p = pointAt(m, i);
      return Math.abs(dot(coarse.n, p) - coarse.d) <= threshold * p[2];
    };
    const inliers = remaining.filter(isIn);
    if (inliers.length < valid.length * minShare) break;
    const { n: rawN, centroid } = refitPlane(m, inliers);
    const n = dot(rawN, centroid) > 0 ? scale(rawN, -1) : rawN; // face the camera
    const d = dot(n, centroid);
    let sq = 0;
    let consistency = 0;
    for (const i of inliers) {
      const e = dot(n, pointAt(m, i)) - d;
      sq += e * e;
      if (m.normals) consistency += Math.abs(n[0] * m.normals[i * 3] + n[1] * m.normals[i * 3 + 1] + n[2] * m.normals[i * 3 + 2]);
    }
    const { axisU, axisV } = layoutBasis(n, opts.orientation);
    // Anchor the layout at the surface's top-left, so sheets/tiles start at its edge
    let minU = Infinity;
    let minV = Infinity;
    for (const i of inliers) {
      const r = sub(pointAt(m, i), centroid);
      minU = Math.min(minU, dot(r, axisU));
      minV = Math.min(minV, dot(r, axisV));
    }
    planes.push({
      normal: n,
      origin: add(centroid, add(scale(axisU, minU), scale(axisV, minV))),
      axisU,
      axisV,
      residual: Math.sqrt(sq / inliers.length),
      inlierRatio: inliers.length / valid.length,
      normalConsistency: m.normals ? consistency / inliers.length : 1,
      pixels: Uint32Array.from(inliers),
    });
    const taken = new Set(inliers);
    remaining = remaining.filter((i) => !taken.has(i));
  }
  return planes;
};
