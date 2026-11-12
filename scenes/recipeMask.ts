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
  // Keep only compact pieces (knobs and cup handles, not the long groove shadows of the same hue).
  // `core`: a piece is kept only if at least `minShare` of its pixels reach `minSat` — brass has a
  // saturated core, warm paint in shadow (an inside corner, a bracket's return) never does
  blobs?: BlobFilter;
  // …and the pixels within `radius` px of those that fall in a looser `range`: a black frame bar
  // takes its own dark contact shadow, which is warm like the floor but too thin for the baked
  // light to shade
  spread?: { radius: number; range: ColourRange };
  // Then each kept piece only where it is this much more saturated than the paint around it, with
  // the holes it encloses (a knob's specular highlight) filled: a knob without the paint in its
  // shadow (trimBySaturation). A trimmed mask is exact, so the bake does not grow it
  trim?: number;
}

export interface BlobFilter {
  minArea: number;
  maxArea: number;
  maxAspect: number;
  core?: { minSat: number; minShare: number };
}

const saturation = (rgba: ArrayLike<number>, o: number) => {
  const max = Math.max(rgba[o], rgba[o + 1], rgba[o + 2]);
  return max > 0 ? (max - Math.min(rgba[o], rgba[o + 1], rgba[o + 2])) / max : 0;
};

/**
 * Pixels inside the polygons whose colour falls in a range — green leaves in front of beige
 * wood, a chrome ring in front of dark slats — which colour separates more cleanly than any
 * model. `rgba` is the photo's pixels.
 */
/** Whether the pixel at byte offset `o` of `rgba` falls in the colour range. */
export const inColourRange = (rgba: ArrayLike<number>, o: number, range: ColourRange): boolean => {
  const { hueMin = 0, hueMax = 360, minSat = 0, maxSat = 1, minValue = 0, maxValue = 1 } = range;
  const r = rgba[o] / 255;
  const g = rgba[o + 1] / 255;
  const b = rgba[o + 2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const sat = max > 0 ? (max - min) / max : 0;
  if (sat < minSat || sat > maxSat || max < minValue || max > maxValue) return false;
  if (hueMin > 0 || hueMax < 360) {
    if (max === min) return false;
    let hue = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
    hue = (hue * 60 + 360) % 360;
    if (hue < hueMin || hue > hueMax) return false;
  }
  return true;
};

export const colourMask = (rgba: Uint8ClampedArray, w: number, h: number, region: PctPoint[][], range: ColourRange): AlphaMask => {
  let inside = emptyMask(w, h);
  for (const poly of region) inside = fillPolygon(inside, toPx(poly, w, h), 'add');
  const out = emptyMask(w, h);
  for (let i = 0; i < w * h; i++) if (inside.alpha[i] && inColourRange(rgba, i * 4, range)) out.alpha[i] = 255;
  // Knobs: close their specular gaps first (a small knob is a ring of saturated pixels), then
  // open away the 1–2 px groove shadows, then keep the compact pieces
  let kept = out;
  if (range.blobs) {
    const { core } = range.blobs;
    const keep = core ? (piece: number[]) => piece.filter((i) => saturation(rgba, i * 4) >= core.minSat).length >= core.minShare * piece.length : undefined;
    kept = keepBlobs(openMask(closeMask(out, 1), 1), range.blobs, keep);
  }
  if (range.trim !== undefined) kept = trimBySaturation(kept, rgba, range.trim);
  if (!range.spread) return kept;
  const near = dilateDisc(kept, range.spread.radius);
  const spread = range.spread.range;
  for (let i = 0; i < w * h; i++) if (near.alpha[i] >= 128 && inside.alpha[i] && inColourRange(rgba, i * 4, spread)) kept.alpha[i] = 255;
  return kept;
};

/**
 * Each piece of the mask cut down to its pixels clearly more saturated than the paint around it
 * (the median saturation of a ring 3–4 px outside the piece, + `margin`), plus the holes they
 * enclose (a knob's specular highlight) and small gaps closed. Relative, because a sunlit knob on pale paint is less
 * saturated than the shadowed paint around a knob on the island. Grows at most 1 px past `mask`.
 */
export const trimBySaturation = (mask: AlphaMask, rgba: ArrayLike<number>, margin: number): AlphaMask => {
  const { width: w, height: h } = mask;
  const binary = { ...mask, alpha: mask.alpha.map((a) => (a >= 128 ? 255 : 0)) };
  const near = dilateDisc(binary, 2);
  const far = dilateDisc(binary, 4);
  const out = emptyMask(w, h);
  const seen = new Uint8Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || binary.alpha[start] < 128) continue;
    const piece: number[] = [];
    const stack = [start];
    seen[start] = 1;
    let x0 = w, y0 = h, x1 = 0, y1 = 0;
    while (stack.length) {
      const i = stack.pop()!;
      piece.push(i);
      const x = i % w;
      const y = (i - x) / w;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1])
        if (j >= 0 && !seen[j] && binary.alpha[j] >= 128) (seen[j] = 1), stack.push(j);
    }
    const ring: number[] = [];
    for (let y = Math.max(0, y0 - 4); y <= Math.min(h - 1, y1 + 4); y++)
      for (let x = Math.max(0, x0 - 4); x <= Math.min(w - 1, x1 + 4); x++) {
        const i = y * w + x;
        if (far.alpha[i] >= 128 && near.alpha[i] < 128) ring.push(saturation(rgba, i * 4));
      }
    ring.sort((a, b) => a - b);
    const minSat = (ring.length ? ring[ring.length >> 1] : 0) + margin;
    for (const i of piece) if (saturation(rgba, i * 4) >= minSat) out.alpha[i] = 255;
  }
  // A cup handle's open middle (a pale highlight): gaps up to ~4 px closed, never more than a
  // pixel past the original pieces
  const closed = closeMask(out, 2);
  const envelope = dilateDisc(binary, 1);
  for (let i = 0; i < w * h; i++) if (closed.alpha[i] >= 128 && envelope.alpha[i] >= 128) out.alpha[i] = 255;
  // Holes: pixels not reachable from the border through unmasked pixels
  const outside = new Uint8Array(w * h);
  const stack: number[] = [];
  const push = (i: number) => {
    if (!outside[i] && out.alpha[i] < 128) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) push(x), push((h - 1) * w + x);
  for (let y = 0; y < h; y++) push(y * w), push(y * w + w - 1);
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (i >= w) push(i - w);
    if (i < w * (h - 1)) push(i + w);
  }
  for (let i = 0; i < w * h; i++) if (!outside[i] && binary.alpha[i] >= 128) out.alpha[i] = 255;
  // A groove's saturated sliver beside a knob, left on its own by the trim
  return keepBlobs(out, { minArea: 8, maxArea: Infinity, maxAspect: Infinity });
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

/** The mask's connected pieces whose area and bounding-box aspect fall in range (and that `keep` accepts). */
export const keepBlobs = (mask: AlphaMask, { minArea, maxArea, maxAspect }: BlobFilter, keep?: (piece: number[]) => boolean): AlphaMask => {
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
    if (piece.length >= minArea && piece.length <= maxArea && Math.max(bw, bh) / Math.min(bw, bh) <= maxAspect && (!keep || keep(piece)))
      for (const i of piece) out.alpha[i] = 255;
  }
  return out;
};

/** What `keepByColour` keeps: the item's own material's colour range, plus clean-up sizes (px). */
export interface KeepColour extends ColourRange {
  // Further colour ranges that also count as the material (pale wood also reads as off-white)
  also?: ColourRange[];
  // Kept pieces smaller than this go (a brown fleck of the garden seen through a gap)
  minPiece?: number;
  // Dropped holes up to this size come back (a knot, a nail head, a speck of glare on a board)
  maxHole?: number;
}

/** Calls `visit` with each 4-connected piece of the pixels where `on` holds. */
const forEachPiece = (w: number, h: number, on: (i: number) => boolean, visit: (piece: number[]) => void) => {
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || !on(start)) continue;
    const piece: number[] = [];
    seen[start] = 1;
    stack.push(start);
    while (stack.length) {
      const i = stack.pop()!;
      piece.push(i);
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i + w < w * h ? i + w : -1]) {
        if (j >= 0 && !seen[j] && on(j)) {
          seen[j] = 1;
          stack.push(j);
        }
      }
    }
    visit(piece);
  }
};

/**
 * The mask kept only where the photo shows the item's own material: fence boards stay, the
 * garden seen through the gaps between them, a tree's trunk and leaves in front, go. Colour
 * separates these exactly where a model's cut blurs them. Small dropped holes on the item (a
 * knot) are refilled and small kept specks off it removed. Soft alpha is kept where kept.
 */
export const keepByColour = (mask: AlphaMask, rgba: ArrayLike<number>, range: KeepColour): AlphaMask => {
  const { width: w, height: h } = mask;
  const { minPiece = 12, maxHole = 12 } = range;
  const keep = new Uint8Array(w * h);
  const ranges = [range, ...(range.also ?? [])];
  for (let i = 0; i < w * h; i++) if (mask.alpha[i] && ranges.some((r) => inColourRange(rgba, i * 4, r))) keep[i] = 1;
  forEachPiece(w, h, (i) => mask.alpha[i] > 0 && !keep[i], (piece) => {
    if (piece.length <= maxHole) for (const i of piece) keep[i] = 1;
  });
  forEachPiece(w, h, (i) => keep[i] === 1, (piece) => {
    if (piece.length < minPiece) for (const i of piece) keep[i] = 0;
  });
  const out = emptyMask(w, h);
  for (let i = 0; i < w * h; i++) if (keep[i]) out.alpha[i] = mask.alpha[i];
  return out;
};

/**
 * A thin object before a plain surface, too fine for a cut (a toaster's wire handle, a twig in a
 * vase): inside the polygons, each pixel's occlusion is how far its colour is from the surface's
 * (the median colour of the region, mostly surface), from 0 at `low` to full at `high` (RGB
 * distance). Soft, so the renderer swaps only the surface's share of a mixed pixel.
 */
export const softProtect = (rgba: ArrayLike<number>, w: number, h: number, region: PctPoint[][], low = 22, high = 70): AlphaMask => {
  let inside = emptyMask(w, h);
  for (const poly of region) inside = fillPolygon(inside, toPx(poly, w, h), 'add');
  const idx: number[] = [];
  for (let i = 0; i < w * h; i++) if (inside.alpha[i] >= 128) idx.push(i);
  const out = emptyMask(w, h);
  if (!idx.length) return out;
  const med = [0, 1, 2].map((c) => {
    const v = idx.map((i) => rgba[i * 4 + c]).sort((a, b) => a - b);
    return v[Math.floor(v.length / 2)];
  });
  for (const i of idx) {
    const d = Math.hypot(rgba[i * 4] - med[0], rgba[i * 4 + 1] - med[1], rgba[i * 4 + 2] - med[2]);
    out.alpha[i] = Math.round(255 * Math.min(1, Math.max(0, (d - low) / (high - low))));
  }
  return out;
};
