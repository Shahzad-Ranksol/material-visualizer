// Pure pan/zoom maths for the Area Editor's viewport (no DOM), so it can be unit tested.

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 8;
// However far the photo is panned, it keeps covering at least this share of the viewport per axis
export const MIN_VISIBLE_FRACTION = 0.25;

/** The stage's translate (screen px, relative to its fitted position) and scale. */
export interface ViewTransform {
  zoom: number;
  x: number;
  y: number;
}

/** Viewport size and the fitted (zoom 1) stage box inside it, in screen px. */
export interface PanBounds {
  viewW: number;
  viewH: number;
  stageLeft: number;
  stageTop: number;
  stageW: number;
  stageH: number;
}

export interface Point {
  x: number;
  y: number;
}

export const clampNum = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

const IDENTITY: ViewTransform = { zoom: MIN_ZOOM, x: 0, y: 0 };

// The translate range on one axis that keeps [start + t, start + t + size] overlapping the
// viewport [0, view] by at least `min(fraction * view, size)`.
const clampAxis = (t: number, view: number, start: number, size: number, fraction: number) => {
  const keep = Math.min(fraction * view, size);
  return clampNum(t, keep - start - size, view - keep - start);
};

/** Keeps a meaningful part of the photo on screen. At zoom 1 there is no pan at all. */
export const clampPan = (t: ViewTransform, b: PanBounds | null, fraction = MIN_VISIBLE_FRACTION): ViewTransform => {
  if (t.zoom <= MIN_ZOOM) return IDENTITY;
  if (!b || b.stageW <= 0 || b.stageH <= 0 || b.viewW <= 0 || b.viewH <= 0) return t;
  const x = clampAxis(t.x, b.viewW, b.stageLeft, b.stageW * t.zoom, fraction);
  const y = clampAxis(t.y, b.viewH, b.stageTop, b.stageH * t.zoom, fraction);
  return x === t.x && y === t.y ? t : { zoom: t.zoom, x, y };
};

/** Zooms by `factor` keeping the stage-local point (cx, cy) fixed, then clamps the pan. */
export const zoomAround = (t: ViewTransform, cx: number, cy: number, factor: number, b: PanBounds | null): ViewTransform => {
  const zoom = clampNum(t.zoom * factor, MIN_ZOOM, MAX_ZOOM);
  if (zoom === MIN_ZOOM) return IDENTITY;
  const k = zoom / t.zoom;
  return clampPan({ zoom, x: cx - (cx - t.x) * k, y: cy - (cy - t.y) * k }, b);
};

export interface PinchState {
  mid: Point; // stage-local midpoint of the two touches
  dist: number; // distance between them, screen px
}

/**
 * Two-finger pinch/pan: the photo point under the starting midpoint follows the current
 * midpoint, and the zoom scales with the finger spread (clamped to 1–8x).
 */
export const pinchTransform = (start: ViewTransform, from: PinchState, to: PinchState, b: PanBounds | null): ViewTransform => {
  const scale = from.dist > 0 ? to.dist / from.dist : 1;
  const zoom = clampNum(start.zoom * scale, MIN_ZOOM, MAX_ZOOM);
  if (zoom === MIN_ZOOM) return IDENTITY;
  const px = (from.mid.x - start.x) / start.zoom;
  const py = (from.mid.y - start.y) / start.zoom;
  return clampPan({ zoom, x: to.mid.x - px * zoom, y: to.mid.y - py * zoom }, b);
};

export const pinchStateOf = (a: Point, b: Point): PinchState => ({
  mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
  dist: Math.hypot(a.x - b.x, a.y - b.y),
});

/**
 * Snaps a raw outline thickness (mask px) to a small set of buckets so smooth zoom only
 * changes it occasionally: whole pixels up to 4, then half-octave steps (6, 8, 11, 16, 23, 32…).
 */
export const quantizeOutlineWidth = (raw: number): number => {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  if (raw <= 4) return Math.max(1, Math.round(raw));
  return Math.max(4, Math.round(2 ** (Math.round(2 * Math.log2(raw)) / 2)));
};

/** Outline thickness in mask px for a ~2 screen-px line, given the photo's on-screen width. */
export const outlineWidthFor = (maskWidth: number, shownWidth: number): number =>
  quantizeOutlineWidth((2 * maskWidth) / (shownWidth > 0 ? shownWidth : maskWidth));
