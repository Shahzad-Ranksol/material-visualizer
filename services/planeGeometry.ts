import { PlanePoint, SurfacePlane } from '../types';

// Perspective geometry for re-surfacing flat areas (walls, floors, ceilings) in a photo.
// A surface is modelled as a real rectangle whose four corners are known in the photo;
// the homography between the two lets the renderer place materials in true perspective.

export type Mat3 = [number, number, number, number, number, number, number, number, number];
export type Pt = { x: number; y: number };

// Typical interior photos are shot wide (roughly a 24-28mm equivalent lens)
export const ASSUMED_FOCAL_FRACTION = 0.7; // focal length as a fraction of the image's longer side

/** Homography mapping each src point to its dst point (4 correspondences, h33 = 1). */
export const solveHomography = (src: Pt[], dst: Pt[]): Mat3 => {
  const A: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const { x, y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    A.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  // Gaussian elimination with partial pivoting on the 8x9 augmented system
  for (let col = 0; col < 8; col++) {
    let pivot = col;
    for (let r = col + 1; r < 8; r++) if (Math.abs(A[r][col]) > Math.abs(A[pivot][col])) pivot = r;
    [A[col], A[pivot]] = [A[pivot], A[col]];
    const d = A[col][col] || 1e-12;
    for (let c = col; c < 9; c++) A[col][c] /= d;
    for (let r = 0; r < 8; r++) {
      if (r === col) continue;
      const f = A[r][col];
      if (f === 0) continue;
      for (let c = col; c < 9; c++) A[r][c] -= f * A[col][c];
    }
  }
  const h = A.map((row) => row[8]);
  return [h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7], 1];
};

export const applyHomography = (H: Mat3, x: number, y: number): Pt => {
  const w = H[6] * x + H[7] * y + H[8];
  return { x: (H[0] * x + H[1] * y + H[2]) / w, y: (H[3] * x + H[4] * y + H[5]) / w };
};

export const invert3 = (m: Mat3): Mat3 => {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C || 1e-12;
  return [
    A / det, -(b * i - c * h) / det, (b * f - c * e) / det,
    B / det, (a * i - c * g) / det, -(a * f - c * d) / det,
    C / det, -(a * h - b * g) / det, (a * e - b * d) / det,
  ];
};

const UNIT_SQUARE: Pt[] = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];

export const cornersToPixels = (corners: PlanePoint[], w: number, h: number): Pt[] =>
  corners.map((c) => ({ x: (c.xPct / 100) * w, y: (c.yPct / 100) * h }));

/**
 * Real-world width/height ratio of the rectangle seen at `cornersPx`, recovered from its
 * perspective (Zhang's single-view rectangle method) with an assumed focal length.
 * For a surface seen head-on this is simply its pixel aspect ratio.
 */
export const estimateAspect = (cornersPx: Pt[], w: number, h: number): number => {
  const H = solveHomography(UNIT_SQUARE, cornersPx);
  const f = ASSUMED_FOCAL_FRACTION * Math.max(w, h);
  const cx = w / 2;
  const cy = h / 2;
  // Columns of K^-1 H: directions of the rectangle's two edges in camera space
  const col = (j: number) => {
    const x = H[j];
    const y = H[3 + j];
    const z = H[6 + j];
    return [(x - cx * z) / f, (y - cy * z) / f, z];
  };
  const len = (v: number[]) => Math.hypot(v[0], v[1], v[2]);
  const aspect = len(col(0)) / len(col(1));
  return Number.isFinite(aspect) && aspect > 0.05 && aspect < 50 ? aspect : 1;
};

/** Homography from real-world millimetres on the plane to image pixels. */
export const planeToImageHomography = (plane: SurfacePlane, w: number, h: number) => {
  const cornersPx = cornersToPixels(plane.corners, w, h);
  const widthMm = plane.heightMm * estimateAspect(cornersPx, w, h);
  const H = solveHomography(
    [{ x: 0, y: 0 }, { x: widthMm, y: 0 }, { x: widthMm, y: plane.heightMm }, { x: 0, y: plane.heightMm }],
    cornersPx
  );
  return { H, widthMm };
};

// --- Automatic plane fitting from a surface mask -------------------------------------------

export type PlaneKind = 'vertical' | 'floor' | 'ceiling';

export const planeKindFor = (surfaceLabel: string | null | undefined): PlaneKind => {
  const label = (surfaceLabel || '').toLowerCase();
  if (/floor|rug|carpet|ground|countertop|kitchen island|table|desk/.test(label)) return 'floor';
  if (/ceiling/.test(label)) return 'ceiling';
  return 'vertical';
};

export const defaultHeightMm = (kind: PlaneKind) => (kind === 'vertical' ? 2700 : 4000);

type Line = { a: number; b: number }; // y = a*x + b (or x = a*y + b for side edges)

// RANSAC line fit: robust to furniture/plants cutting into the surface's edge
const fitLineRobust = (pts: Pt[], tolerance: number): Line | null => {
  if (pts.length < 2) return null;
  let best: Line | null = null;
  let bestInliers = -1;
  const iterations = Math.min(300, pts.length * 4);
  for (let it = 0; it < iterations; it++) {
    const p = pts[Math.floor(Math.random() * pts.length)];
    const q = pts[Math.floor(Math.random() * pts.length)];
    if (Math.abs(q.x - p.x) < 1e-6) continue;
    const a = (q.y - p.y) / (q.x - p.x);
    const b = p.y - a * p.x;
    let inliers = 0;
    for (const r of pts) if (Math.abs(a * r.x + b - r.y) <= tolerance) inliers++;
    if (inliers > bestInliers) {
      bestInliers = inliers;
      best = { a, b };
    }
  }
  if (!best) return null;
  // Least-squares refit on the inliers
  const inl = pts.filter((r) => Math.abs(best!.a * r.x + best!.b - r.y) <= tolerance);
  const n = inl.length;
  const sx = inl.reduce((s, r) => s + r.x, 0);
  const sy = inl.reduce((s, r) => s + r.y, 0);
  const sxx = inl.reduce((s, r) => s + r.x * r.x, 0);
  const sxy = inl.reduce((s, r) => s + r.x * r.y, 0);
  const den = n * sxx - sx * sx;
  if (Math.abs(den) < 1e-9) return best;
  const a = (n * sxy - sx * sy) / den;
  return { a, b: (sy - a * sx) / n };
};

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((x, y) => x - y);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))))];
};

// Row shared by the most columns (±1% of the height), ignoring the photo's own border rows
const mostCommonRow = (rows: number[], h: number): number => {
  const band = Math.max(1, Math.round(h * 0.01));
  const counts = new Array(h + 2).fill(0);
  for (const r of rows) if (r > 0 && r < h) counts[r]++;
  let best = -1;
  let bestCount = 0;
  for (let r = 1; r < h; r++) {
    let c = 0;
    for (let d = -band; d <= band; d++) c += counts[r + d] ?? 0;
    if (c > bestCount) {
      bestCount = c;
      best = r;
    }
  }
  // No interior edge at all: the surface runs off the photo, so use the border
  return bestCount < rows.length * 0.1 ? (rows.reduce((a, b) => a + b, 0) / rows.length < h / 2 ? 0 : h) : best;
};

// Level-camera model for floors/ceilings: interior photos are normally shot with the camera
// level (verticals vertical), which puts the horizon at mid-height. A floor point at image row y
// is then at depth f * cameraHeight / (y - horizon) — enough to lay tiles/boards out in true
// perspective without knowing any of the floor's corners.
const CAMERA_HEIGHT_MM = 1300;
const CAMERA_TO_CEILING_MM = 1400;
// Far edges this close to the horizon would put the surface near infinity
const MIN_HORIZON_GAP = 0.04;

/**
 * Fits a perspective plane to a surface mask (alpha or white-on-black canvas).
 * - Floors/ceilings: level-camera model; only the far edge (where it meets the wall) is read
 *   from the mask, robustly, so rugs and furniture don't matter.
 * - Walls: head-on over the area, unless both the top and bottom edges are clearly visible,
 *   consistent lines (an angled wall), in which case those lines set the perspective.
 * Returns null when the mask is too small to fit.
 */
export const autoFitPlane = (mask: HTMLCanvasElement, kind: PlaneKind, wallHeightMm = defaultHeightMm('vertical')): SurfacePlane | null => {
  const scale = Math.min(1, 320 / mask.width);
  const w = Math.max(1, Math.round(mask.width * scale));
  const h = Math.max(1, Math.round(mask.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(mask, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h).data;
  const on = (x: number, y: number) => data[(y * w + x) * 4] > 127;

  const tops: Pt[] = [];
  const bottoms: Pt[] = [];
  for (let x = 0; x < w; x++) {
    let top = -1;
    let bottom = -1;
    for (let y = 0; y < h; y++) {
      if (on(x, y)) {
        if (top < 0) top = y;
        bottom = y;
      }
    }
    if (top >= 0) {
      tops.push({ x, y: top });
      bottoms.push({ x, y: bottom + 1 });
    }
  }
  if (tops.length < w * 0.05) return null;
  const toPct = (p: Pt): PlanePoint => ({ xPct: (p.x / w) * 100, yPct: (p.y / h) * 100 });
  const f = ASSUMED_FOCAL_FRACTION * Math.max(w, h);
  const cx = w / 2;
  const horizon = h / 2;

  if (kind === 'floor' || kind === 'ceiling') {
    const isFloor = kind === 'floor';
    const camOffset = isFloor ? CAMERA_HEIGHT_MM : CAMERA_TO_CEILING_MM;
    // Far edge: the part of the surface nearest the horizon (furniture only hides the rest)
    const farRow = isFloor ? percentile(tops.map((p) => p.y), 10) : percentile(bottoms.map((p) => p.y), 90);
    const nearRow = isFloor ? h : 0;
    const gap = (row: number) => Math.max(MIN_HORIZON_GAP * h, Math.abs(row - horizon));
    const depthAt = (row: number) => (f * camOffset) / gap(row);
    const farY = horizon + (isFloor ? 1 : -1) * gap(farRow);
    const zFar = depthAt(farRow);
    const zNear = depthAt(nearRow);
    // A rectangle as wide as the photo at the near edge, projected back into the image
    const halfWidthMm = ((w / 2) * zNear) / f;
    const xAt = (sign: number, z: number) => cx + (sign * halfWidthMm * f) / z;
    const far = [{ x: xAt(-1, zFar), y: farY }, { x: xAt(1, zFar), y: farY }];
    const near = [{ x: xAt(1, zNear), y: nearRow }, { x: xAt(-1, zNear), y: nearRow }];
    const corners = isFloor ? [far[0], far[1], near[0], near[1]] : [near[1], near[0], far[1], far[0]];
    return { corners: corners.map(toPct) as SurfacePlane['corners'], heightMm: Math.max(300, zFar - zNear) };
  }

  // Walls
  const left = percentile(tops.map((p) => p.x), 1);
  const right = percentile(tops.map((p) => p.x), 99) + 1;
  const headOn = (): SurfacePlane => {
    // The wall's real top/bottom (ceiling line, skirting) is the edge shared by the most
    // columns; curtains, doorways and furniture only move individual columns
    const top = mostCommonRow(tops.map((p) => p.y), h);
    const bottom = mostCommonRow(bottoms.map((p) => p.y), h);
    return {
      corners: [{ x: left, y: top }, { x: right, y: top }, { x: right, y: bottom }, { x: left, y: bottom }].map(toPct) as SurfacePlane['corners'],
      heightMm: wallHeightMm,
    };
  };
  const tol = Math.max(1.5, h * 0.015);
  const topFit = fitLineRobust(tops, tol);
  const bottomFit = fitLineRobust(bottoms, tol);
  if (!topFit || !bottomFit) return headOn();
  // An edge running along the photo's border isn't the wall's real edge
  const touchesBorder = (pts: Pt[], row: number) => pts.filter((p) => Math.abs(p.y - row) <= 1).length > pts.length * 0.3;
  const inlierShare = (pts: Pt[], l: Line) => pts.filter((p) => Math.abs(l.a * p.x + l.b - p.y) <= tol).length / pts.length;
  const reliable =
    !touchesBorder(tops, 0) &&
    !touchesBorder(bottoms, h) &&
    inlierShare(tops, topFit) > 0.6 &&
    inlierShare(bottoms, bottomFit) > 0.6 &&
    // Top and bottom of a level-shot wall slope towards the same side of the horizon
    Math.sign(topFit.a) === -Math.sign(bottomFit.a);
  if (!reliable) return headOn();
  const at = (l: Line, x: number) => ({ x, y: l.a * x + l.b });
  return {
    corners: [at(topFit, left), at(topFit, right), at(bottomFit, right), at(bottomFit, left)].map(toPct) as SurfacePlane['corners'],
    heightMm: wallHeightMm,
  };
};

/** Plane covering the mask's bounding box head-on — the fallback when nothing better is known. */
export const boundingBoxPlane = (bbox: { minX: number; minY: number; maxX: number; maxY: number }, w: number, h: number, heightMm: number): SurfacePlane => ({
  corners: [
    { xPct: (bbox.minX / w) * 100, yPct: (bbox.minY / h) * 100 },
    { xPct: ((bbox.maxX + 1) / w) * 100, yPct: (bbox.minY / h) * 100 },
    { xPct: ((bbox.maxX + 1) / w) * 100, yPct: ((bbox.maxY + 1) / h) * 100 },
    { xPct: (bbox.minX / w) * 100, yPct: ((bbox.maxY + 1) / h) * 100 },
  ],
  heightMm,
});
