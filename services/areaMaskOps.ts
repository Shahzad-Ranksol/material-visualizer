// Pure alpha-mask operations for the Area Editor (no DOM, unit-tested in Node). A mask is the
// editor's working area at the photo's analysis resolution: alpha = coverage (0–255).

export interface AlphaMask {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
}

export interface Pt {
  x: number; // image pixels
  y: number;
}

// Largest share of the photo one object click may return; more means SAM grabbed the room
const MAX_OBJECT_PCT = 60;

export const emptyMask = (width: number, height: number): AlphaMask => ({ width, height, alpha: new Uint8ClampedArray(width * height) });

export const cloneMask = (mask: AlphaMask): AlphaMask => ({ width: mask.width, height: mask.height, alpha: mask.alpha.slice() });

/** Fills (or clears) a polygon, even-odd rule, sampling pixel centres. Returns a new mask. */
export const fillPolygon = (mask: AlphaMask, points: Pt[], mode: 'add' | 'remove'): AlphaMask => {
  const out = cloneMask(mask);
  if (points.length < 3) return out;
  const { width: w, height: h } = mask;
  const value = mode === 'add' ? 255 : 0;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(h - 1, Math.ceil(maxY));
  for (let y = y0; y <= y1; y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a.y <= cy && b.y > cy) || (b.y <= cy && a.y > cy)) xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const xa = Math.max(0, Math.ceil(xs[k] - 0.5));
      const xb = Math.min(w - 1, Math.floor(xs[k + 1] - 0.5));
      for (let x = xa; x <= xb; x++) out.alpha[y * w + x] = value;
    }
  }
  return out;
};

// Binary (alpha > 127) dilation by a disc of radius r
const dilateDisc = (mask: AlphaMask, r: number): AlphaMask => {
  if (r <= 0) return mask;
  const { width: w, height: h } = mask;
  const out = emptyMask(w, h);
  const offsets: Array<[number, number]> = [];
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx * dx + dy * dy <= r * r) offsets.push([dx, dy]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask.alpha[y * w + x] <= 127) continue;
      for (const [dx, dy] of offsets) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h) out.alpha[ny * w + nx] = 255;
      }
    }
  }
  return out;
};

/**
 * Adds or subtracts another mask. Returns a new mask. Subtract first widens `other` by
 * `dilatePx` (binary), then removes fully wherever the subtracted mask is at least half on
 * (alpha >= 128) and scales the area down by its soft alpha below that — so a soft-edged object
 * is removed the same way with or without dilation (a dilated mask is 0/255, where both rules
 * agree).
 */
export const combine = (mask: AlphaMask, other: AlphaMask, mode: 'add' | 'subtract', dilatePx: number): AlphaMask => {
  const out = cloneMask(mask);
  if (mode === 'add') {
    for (let i = 0; i < out.alpha.length; i++) out.alpha[i] = Math.max(mask.alpha[i], other.alpha[i]);
    return out;
  }
  const o = dilateDisc(other, dilatePx);
  for (let i = 0; i < out.alpha.length; i++) {
    const s = o.alpha[i];
    out.alpha[i] = s >= 128 ? 0 : Math.round((mask.alpha[i] * (255 - s)) / 255);
  }
  return out;
};

const stampDisc = (mask: AlphaMask, cx: number, cy: number, radius: number, value: number) => {
  const { width: w, height: h } = mask;
  const x0 = Math.max(0, Math.floor(cx - radius));
  const x1 = Math.min(w - 1, Math.ceil(cx + radius));
  const y0 = Math.max(0, Math.floor(cy - radius));
  const y1 = Math.min(h - 1, Math.ceil(cy + radius));
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      if (dx * dx + dy * dy <= radius * radius) mask.alpha[y * w + x] = value;
    }
  }
};

/** Paints (or erases) a round-capped segment into `mask`, in place. */
export const paintStroke = (mask: AlphaMask, from: Pt, to: Pt, radius: number, mode: 'add' | 'erase'): void => {
  const value = mode === 'add' ? 255 : 0;
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const step = Math.max(0.5, radius / 3);
  const steps = Math.max(1, Math.ceil(length / step));
  for (let s = 0; s <= steps; s++) {
    const t = s / steps;
    stampDisc(mask, from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t, radius, value);
  }
};

export const EMPTY_AREA_MESSAGE = 'The area is empty — add some of the surface first.';

// The renderer refuses a layer with fewer covered pixels than this (alpha > 127)
export const MIN_RENDER_PIXELS = 16;
// A part left with fewer covered pixels than this after an edit is dropped. 4x the renderer's
// minimum, so resampling the mask to the photo's size can't push a kept part below it.
export const MIN_PART_PIXELS = 4 * MIN_RENDER_PIXELS;

export const coveragePct = (mask: AlphaMask): number => {
  let sum = 0;
  for (let i = 0; i < mask.alpha.length; i++) sum += mask.alpha[i];
  return (sum / 255 / (mask.width * mask.height)) * 100;
};

/**
 * Pixels inside the mask within `thickness` px (square neighbourhood) of its edge. Pass `out`
 * (w*h bytes) to reuse a buffer instead of allocating one.
 */
export const maskOutline = (mask: AlphaMask, thickness: number, out?: Uint8Array): Uint8Array => {
  const { width: w, height: h } = mask;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask.alpha[y * w + x] > 127;
  if (out && out.length === w * h) out.fill(0);
  else out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!inside(x, y)) continue;
      let edge = false;
      for (let dy = -thickness; dy <= thickness && !edge; dy++) {
        for (let dx = -thickness; dx <= thickness; dx++) {
          if (!inside(x + dx, y + dy)) {
            edge = true;
            break;
          }
        }
      }
      if (edge) out[y * w + x] = 1;
    }
  }
  return out;
};

export const isUsableObjectMask = (mask: AlphaMask): boolean => {
  const pct = coveragePct(mask);
  return pct > 0 && pct <= MAX_OBJECT_PCT;
};

/**
 * For every pixel, the index of the nearest source part (8-connected multi-source BFS, so a
 * diagonal step costs the same as a straight one; one O(w*h) pass). A part's visible pixels
 * (alpha > 127) are its sources, so distances run from the edge the user sees, not a faint
 * soft tail; where parts overlap, the one with the higher alpha (then the lower index) owns the
 * pixel. -1 where no source is reachable (no source part has a visible pixel).
 */
const nearestPartLabels = (parts: AlphaMask[], sources: number[], w: number, h: number): Int32Array => {
  const n = w * h;
  const label = new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let tail = 0;
  for (let i = 0; i < n; i++) {
    let best = -1;
    let bestAlpha = 127;
    for (const k of sources) {
      const a = parts[k].alpha[i];
      if (a > bestAlpha) {
        bestAlpha = a;
        best = k;
      }
    }
    if (best >= 0) {
      label[i] = best;
      queue[tail++] = i;
    }
  }
  for (let head = 0; head < tail; head++) {
    const i = queue[head];
    const x = i % w;
    const y = (i - x) / w;
    const k = label[i];
    for (let dy = -1; dy <= 1; dy++) {
      const ny = y + dy;
      if (ny < 0 || ny >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        if (nx < 0 || nx >= w) continue;
        const j = ny * w + nx;
        if (label[j] < 0) {
          label[j] = k;
          queue[tail++] = j;
        }
      }
    }
  }
  return label;
};

/**
 * Re-derives each part after the combined area was edited: a part keeps only what is still in
 * the edited area, and pixels in no part (newly added) go to the part whose original mask is
 * nearest (with one part, straight to it). Parts left with fewer than `minPixels` covered pixels
 * are dropped (the renderer would refuse them, failing the whole room), so the first surviving
 * part becomes the new part 0; added pixels nearest a dropped part go to the nearest surviving
 * one. If the nearest split keeps no part alive, all added pixels go to the first part they can
 * keep alive. Returns the surviving parts' original indices with their new masks, in order. All
 * masks share a size.
 */
export const splitEditsIntoParts = (
  parts: AlphaMask[],
  edited: AlphaMask,
  minPixels = MIN_PART_PIXELS
): Array<{ index: number; mask: AlphaMask }> => {
  const n = edited.alpha.length;
  const e = edited.alpha;
  const retained = parts.map((p) => {
    const out = new Uint8ClampedArray(n);
    const a = p.alpha;
    for (let i = 0; i < n; i++) out[i] = a[i] < e[i] ? a[i] : e[i];
    return out;
  });
  const unclaimed = new Uint8ClampedArray(n);
  for (let i = 0; i < n; i++) {
    if (!e[i]) continue;
    let claimed = false;
    for (const p of parts) {
      if (p.alpha[i]) {
        claimed = true;
        break;
      }
    }
    if (!claimed) unclaimed[i] = e[i];
  }
  const covered = (a: Uint8ClampedArray) => {
    let c = 0;
    for (let i = 0; i < n; i++) if (a[i] > 127) c++;
    return c;
  };
  const counts = retained.map(covered);
  const added = covered(unclaimed);
  const mergeInto = (k: number, pick: (i: number) => boolean) => {
    const a = retained[k];
    for (let i = 0; i < n; i++) if (unclaimed[i] > a[i] && pick(i)) a[i] = unclaimed[i];
  };

  // Which parts survive, with the added pixels merged into them
  let survivors: number[];
  if (!added) {
    survivors = parts.map((_, k) => k).filter((k) => counts[k] >= minPixels);
  } else if (parts.length === 1) {
    // Fast path: one part takes everything (or is dropped)
    survivors = counts[0] + added >= minPixels ? [0] : [];
    if (survivors.length) mergeInto(0, () => true);
  } else {
    const { width: w, height: h } = edited;
    const all = parts.map((_, k) => k);
    let label = nearestPartLabels(parts, all, w, h);
    const addedTo = new Array<number>(parts.length).fill(0);
    for (let i = 0; i < n; i++) if (unclaimed[i] > 127 && label[i] >= 0) addedTo[label[i]]++;
    // Decided once from the first-pass shares: with 3+ parts, a part that would only survive on a
    // dropped neighbour's share is still dropped (rare, and it never loses pixels the user kept)
    survivors = all.filter((k) => counts[k] + addedTo[k] >= minPixels);
    if (!survivors.length) {
      // No part lives on its nearest share: the first one all the added pixels keep alive takes them
      const owner = counts.findIndex((c) => c + added >= minPixels);
      survivors = owner >= 0 ? [owner] : [];
      if (owner >= 0) mergeInto(owner, () => true);
    } else {
      // Pixels nearest a dropped part go to the nearest surviving one (a second O(w*h) pass)
      if (survivors.length < parts.length) label = nearestPartLabels(parts, survivors, w, h);
      for (const k of survivors) mergeInto(k, (i) => label[i] === k);
    }
  }
  return survivors.map((k) => ({ index: k, mask: { width: edited.width, height: edited.height, alpha: retained[k] } }));
};

/** The occluder with the area removed (anything in the area is surface): min(o, 255 − a). Same size. */
export const clearOccluderAlpha = (occluder: AlphaMask, area: AlphaMask): AlphaMask => {
  if (occluder.width !== area.width || occluder.height !== area.height) throw new Error('clearOccluderAlpha: size mismatch');
  const out = new Uint8ClampedArray(occluder.alpha.length);
  for (let i = 0; i < out.length; i++) out[i] = Math.min(occluder.alpha[i], 255 - area.alpha[i]);
  return { width: occluder.width, height: occluder.height, alpha: out };
};

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Smallest rectangle containing every pixel that differs between two same-size masks, or null. */
export const diffRect = (a: AlphaMask, b: AlphaMask): Rect | null => {
  const w = a.width;
  const pa = a.alpha;
  const pb = b.alpha;
  const n = pa.length;
  let x0 = w;
  let x1 = -1;
  let y0 = -1;
  let y1 = -1;
  const mark = (i: number) => {
    const y = (i / w) | 0;
    const x = i - y * w;
    if (y0 < 0) y0 = y;
    y1 = y;
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
  };
  // Compare 4 bytes at a time where both buffers allow it (masks are ~all-unchanged)
  let start = 0;
  if (pa.byteOffset % 4 === 0 && pb.byteOffset % 4 === 0) {
    const words = n >> 2;
    const wa = new Uint32Array(pa.buffer, pa.byteOffset, words);
    const wb = new Uint32Array(pb.buffer, pb.byteOffset, words);
    for (let k = 0; k < words; k++) {
      if (wa[k] === wb[k]) continue;
      const i = k << 2;
      if ((i % w) + 3 < w) {
        // One row: its first and last differing bytes bound the rest
        let first = i;
        while (pa[first] === pb[first]) first++;
        let last = i + 3;
        while (pa[last] === pb[last]) last--;
        mark(first);
        if (last !== first) mark(last);
      } else for (let j = i; j < i + 4; j++) if (pa[j] !== pb[j]) mark(j);
    }
    start = words << 2;
  }
  for (let i = start; i < n; i++) if (pa[i] !== pb[i]) mark(i);
  return y0 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
};

const readRect = (m: AlphaMask, r: Rect): Uint8ClampedArray => {
  const out = new Uint8ClampedArray(r.width * r.height);
  for (let y = 0; y < r.height; y++) {
    const from = (r.y + y) * m.width + r.x;
    out.set(m.alpha.subarray(from, from + r.width), y * r.width);
  }
  return out;
};

const writeRect = (m: AlphaMask, r: Rect, bytes: Uint8ClampedArray) => {
  for (let y = 0; y < r.height; y++) m.alpha.set(bytes.subarray(y * r.width, (y + 1) * r.width), (r.y + y) * m.width + r.x);
};

export interface History<T> {
  /** `rect`, when given, is `diffRect(current(), state)` already computed by the caller. */
  push(state: T, rect?: Rect | null): void;
  undo(): T | null;
  redo(): T | null;
  canUndo(): boolean;
  canRedo(): boolean;
  current(): T;
}

// One undo step: the changed rectangle's bytes before and after (null rect = nothing changed).
// A size change (never expected in the editor) falls back to whole masks.
type Delta = { rect: Rect | null; before: Uint8ClampedArray; after: Uint8ClampedArray } | { whole: true; before: AlphaMask; after: AlphaMask };

/**
 * Linear undo/redo over alpha masks, keeping at most `limit` undo steps. Each step stores only
 * the bounding box of what it changed, so memory scales with the edit, not the photo. States are
 * treated as immutable: undo/redo return a fresh mask, and pushed masks must not be mutated after.
 */
export interface MaskHistory extends History<AlphaMask> {
  /** Bytes held by the undo/redo steps (not counting the current mask). */
  retainedBytes(): number;
}

export const createMaskHistory = (initial: AlphaMask, limit: number): MaskHistory => {
  const past: Delta[] = [];
  let present = initial;
  let future: Delta[] = [];
  const apply = (d: Delta, dir: 'before' | 'after'): AlphaMask => {
    if ('whole' in d) return d[dir];
    if (!d.rect) return present;
    const next = cloneMask(present);
    writeRect(next, d.rect, d[dir]);
    return next;
  };
  return {
    push(state, precomputed) {
      let delta: Delta;
      if (state.width !== present.width || state.height !== present.height) delta = { whole: true, before: present, after: state };
      else {
        const rect = precomputed !== undefined ? precomputed : diffRect(present, state);
        const none = new Uint8ClampedArray(0);
        delta = rect ? { rect, before: readRect(present, rect), after: readRect(state, rect) } : { rect: null, before: none, after: none };
      }
      past.push(delta);
      if (past.length > limit) past.shift();
      present = state;
      future = [];
    },
    undo() {
      const d = past.pop();
      if (!d) return null;
      future.push(d);
      present = apply(d, 'before');
      return present;
    },
    redo() {
      const d = future.pop();
      if (!d) return null;
      past.push(d);
      present = apply(d, 'after');
      return present;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    current: () => present,
    retainedBytes: () =>
      [...past, ...future].reduce((sum, d) => sum + ('whole' in d ? d.before.alpha.length + d.after.alpha.length : d.before.length + d.after.length), 0),
  };
};
