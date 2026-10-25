import { AlphaMask, cloneMask, dilateDisc, emptyMask, fillPolygon, Pt } from '../services/areaMaskOps';
import { BakeRecipe, PctPoint } from './types';

// Pure mask maths for baking a scene item (no DOM, unit-tested): a recipe's clip/subtract
// polygons applied to the cut, and the polygon-only items.

const toPx = (points: PctPoint[], w: number, h: number): Pt[] => points.map((q) => ({ x: q.xPct * w, y: q.yPct * h }));

/** The cut plus the recipe's `add` polygons, kept inside its `clip` polygon and outside each `subtract` polygon. */
export const applyRecipeClip = (mask: AlphaMask, recipe: Pick<BakeRecipe, 'add' | 'clip' | 'subtract'>): AlphaMask => {
  const { width: w, height: h } = mask;
  let out = cloneMask(mask);
  for (const poly of recipe.add ?? []) out = fillPolygon(out, toPx(poly, w, h), 'add');
  if (recipe.clip?.length) {
    const keep = fillPolygon(emptyMask(w, h), toPx(recipe.clip, w, h), 'add');
    for (let i = 0; i < out.alpha.length; i++) out.alpha[i] = Math.min(out.alpha[i], keep.alpha[i]);
  }
  for (const poly of recipe.subtract ?? []) out = fillPolygon(out, toPx(Array.isArray(poly) ? poly : poly.points, w, h), 'remove');
  return out;
};

/**
 * Makes a split area's parts a hard partition of it: every pixel goes wholly (at the area's own
 * alpha) to the part covering it most, the others get none. The renderer composites parts one
 * over another, so two parts sharing a pixel softly (where cuts met, or a soft cut met a drawn
 * polygon) would leave the original showing through as a thin outline. Soft alpha survives only
 * where the area itself is soft — its outer edge. Returns new masks.
 */
export const partitionParts = (parts: AlphaMask[], area: AlphaMask): AlphaMask[] => {
  const out = parts.map((p) => emptyMask(p.width, p.height));
  for (let i = 0; i < area.alpha.length; i++) {
    if (!area.alpha[i]) continue;
    let best = -1;
    for (let k = 0; k < parts.length; k++) if (parts[k].alpha[i] > 0 && (best < 0 || parts[k].alpha[i] > parts[best].alpha[i])) best = k;
    if (best >= 0) out[best].alpha[i] = area.alpha[i];
  }
  return out;
};

/** The mask kept only inside the given polygons (union). */
export const keepInside = (mask: AlphaMask, polygons: PctPoint[][]): AlphaMask => {
  const { width: w, height: h } = mask;
  let region = emptyMask(w, h);
  for (const poly of polygons) region = fillPolygon(region, toPx(poly, w, h), 'add');
  const out = cloneMask(mask);
  for (let i = 0; i < out.alpha.length; i++) out.alpha[i] = Math.min(out.alpha[i], region.alpha[i]);
  return out;
};

/** A polygon-only item: exactly its `clip` polygon, less any `subtract` polygons. */
export const polygonItemMask = (recipe: Pick<BakeRecipe, 'clip' | 'subtract'>, w: number, h: number): AlphaMask => {
  const full = emptyMask(w, h);
  full.alpha.fill(255);
  return applyRecipeClip(full, recipe);
};

/** The item at a point, from each item's baked mask (topmost = smallest area wins), or null. */
export const hitTest = (masks: Array<{ id: string; mask: AlphaMask; area: number }>, xPct: number, yPct: number): string | null => {
  let best: { id: string; area: number } | null = null;
  for (const m of masks) {
    const x = Math.min(m.mask.width - 1, Math.max(0, Math.floor(xPct * m.mask.width)));
    const y = Math.min(m.mask.height - 1, Math.max(0, Math.floor(yPct * m.mask.height)));
    if (m.mask.alpha[y * m.mask.width + x] > 127 && (!best || m.area < best.area)) best = { id: m.id, area: m.area };
  }
  return best?.id ?? null;
};

export interface ColourRange {
  // Hue window in degrees (0–360); omitted = any hue
  hueMin?: number;
  hueMax?: number;
  minSat?: number;
  // Below this saturation only (grey aluminium on beige oak)
  maxSat?: number;
  // Brightness (max channel, 0–1) window
  minValue?: number;
  maxValue?: number;
  // Keep only compact pieces (knobs and cup handles, not the long groove shadows of the same hue)
  blobs?: { minArea: number; maxArea: number; maxAspect: number };
}

/**
 * Pixels inside the polygons whose colour falls in a range — green leaves in front of beige
 * wood, a chrome ring in front of dark slats — which colour separates more cleanly than any
 * model. `rgba` is the photo's pixels.
 */
export const colourMask = (rgba: Uint8ClampedArray, w: number, h: number, region: PctPoint[][], range: ColourRange): AlphaMask => {
  const { hueMin = 0, hueMax = 360, minSat = 0, maxSat = 1, minValue = 0, maxValue = 1 } = range;
  let inside = emptyMask(w, h);
  for (const poly of region) inside = fillPolygon(inside, toPx(poly, w, h), 'add');
  const out = emptyMask(w, h);
  for (let i = 0; i < w * h; i++) {
    if (!inside.alpha[i]) continue;
    const r = rgba[i * 4] / 255;
    const g = rgba[i * 4 + 1] / 255;
    const b = rgba[i * 4 + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const sat = max > 0 ? (max - min) / max : 0;
    if (sat < minSat || sat > maxSat || max < minValue || max > maxValue) continue;
    if (hueMin > 0 || hueMax < 360) {
      if (max === min) continue;
      let hue = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
      hue = (hue * 60 + 360) % 360;
      if (hue < hueMin || hue > hueMax) continue;
    }
    out.alpha[i] = 255;
  }
  // Knobs: close their specular gaps first (a small knob is a ring of saturated pixels), then
  // open away the 1–2 px groove shadows, then keep the compact pieces
  return range.blobs ? keepBlobs(openMask(closeMask(out, 1), 1), range.blobs) : out;
};

const invert = (m: AlphaMask): AlphaMask => ({ ...m, alpha: m.alpha.map((a) => 255 - a) });

/**
 * Morphological opening: everything thinner than about 2r+1 px goes (a groove line a knob
 * touches), compact shapes keep their outline. Binary.
 */
export const openMask = (mask: AlphaMask, r: number): AlphaMask => {
  const binary = { ...mask, alpha: mask.alpha.map((a) => (a >= 128 ? 255 : 0)) };
  const eroded = invert(dilateDisc(invert(binary), r));
  const opened = dilateDisc(eroded, r);
  // Never grow past the original
  return { ...opened, alpha: opened.alpha.map((a, i) => Math.min(a, binary.alpha[i])) };
};

/** Morphological closing: fills gaps narrower than about 2r+1 px. Binary. */
export const closeMask = (mask: AlphaMask, r: number): AlphaMask => {
  const binary = { ...mask, alpha: mask.alpha.map((a) => (a >= 128 ? 255 : 0)) };
  return invert(dilateDisc(invert(dilateDisc(binary, r)), r));
};

/** The mask's connected pieces whose area and bounding-box aspect fall in range. */
export const keepBlobs = (mask: AlphaMask, { minArea, maxArea, maxAspect }: { minArea: number; maxArea: number; maxAspect: number }): AlphaMask => {
  const { width: w, height: h } = mask;
  const out = emptyMask(w, h);
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || mask.alpha[start] < 128) continue;
    const piece: number[] = [];
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    stack.push(start);
    seen[start] = 1;
    while (stack.length) {
      const i = stack.pop()!;
      piece.push(i);
      const x = i % w;
      const y = (i - x) / w;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) {
        if (j >= 0 && !seen[j] && mask.alpha[j] >= 128) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    const bw = x1 - x0 + 1;
    const bh = y1 - y0 + 1;
    if (piece.length >= minArea && piece.length <= maxArea && Math.max(bw, bh) / Math.min(bw, bh) <= maxAspect) for (const i of piece) out.alpha[i] = 255;
  }
  return out;
};
