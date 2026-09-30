import { fitSurfacePlanes, PointMap } from '../surfacePlaneFit';
import { connectedComponents } from './maskOps';

/**
 * Countertops by geometry: SegFormer (ADE20K) rarely labels a countertop as one — it calls it
 * wall, sink, cabinet, table or even floor — but the depth model sees it plainly: a surface
 * facing up, at counter height above the floor. Used only where the photo has kitchen or bath
 * context (see COUNTER_CONTEXT_LABELS), so a dining table isn't taken for a counter.
 */
// Kitchen or bath fixtures (plain cabinets aren't enough: living rooms and offices have them)
export const COUNTER_CONTEXT_LABELS = ['sink', 'stove', 'kitchen island', 'dishwasher', 'refrigerator', 'oven', 'microwave'];
// Heights (m above the floor) a countertop, island or bar top sits at
const COUNTER_MIN_M = 0.7;
const COUNTER_MAX_M = 1.25;
// Facing up: normal within ~30° of vertical
const HORIZONTAL_MIN_COS = 0.85;
// Without a visible floor, the floor is taken this far below a hand-held camera
const CAMERA_HEIGHT_M = 1.4;
// A plane closer than this below the camera can't be the floor
const MIN_FLOOR_BELOW_CAMERA_M = 0.9;
// Pieces smaller than this share of the point map are noise
const MIN_PIECE_SHARE = 0.005;

const dot = (a: ArrayLike<number>, b: ArrayLike<number>) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/**
 * Point-map cells (1) on a countertop, or null if there's none. `floorCells` are the floor's
 * cells, for the floor plane (camera space, metric, y down); none → a typical camera height.
 */
export const countertopCells = (pm: PointMap, floorCells: number[]): Uint8Array | null => {
  if (!pm.normals) return null;
  const n = pm.width * pm.height;
  let up: number[] = [0, -1, 0];
  let heightOf = (p: number[]) => CAMERA_HEIGHT_M - p[1];
  // The floor is the lowest horizontal plane among the floor-labelled cells: SegFormer often
  // labels a countertop "floor" too, and that plane sits higher
  const planes = floorCells.length >= 50 ? fitSurfacePlanes(pm, floorCells, { orientation: 'floor', maxPlanes: 3, minPlaneShare: 0.1 }) : [];
  // (and a real floor lies well below a hand-held camera: a "floor" plane close under it is a
  // counter labelled floor, with no real floor in view)
  const floor = planes
    .filter((p) => Math.abs(dot(p.normal, [0, -1, 0])) >= HORIZONTAL_MIN_COS && -dot(p.normal, p.origin) >= MIN_FLOOR_BELOW_CAMERA_M)
    .sort((a, b) => dot(a.normal, a.origin) - dot(b.normal, b.origin))[0];
  if (floor) {
    // The floor's normal faces the camera, so it points up; height is the distance above it
    up = floor.normal;
    const d = dot(floor.normal, floor.origin);
    heightOf = (p) => dot(floor.normal, p) - d;
  }
  const cells = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (!pm.valid[i]) continue;
    const normal = [pm.normals[i * 3], pm.normals[i * 3 + 1], pm.normals[i * 3 + 2]];
    if (Math.abs(dot(normal, up)) < HORIZONTAL_MIN_COS) continue;
    const height = heightOf([pm.points[i * 3], pm.points[i * 3 + 1], pm.points[i * 3 + 2]]);
    if (height >= COUNTER_MIN_M && height <= COUNTER_MAX_M) cells[i] = 1;
  }
  const out = new Uint8Array(n);
  let any = false;
  for (const comp of connectedComponents(cells, pm.width, pm.height)) {
    if (comp.length < n * MIN_PIECE_SHARE) break; // sorted largest first
    for (const i of comp) out[i] = 1;
    any = true;
  }
  return any ? out : null;
};
