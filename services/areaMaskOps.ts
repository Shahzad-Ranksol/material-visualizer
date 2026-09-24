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

/** Adds or subtracts another mask (subtract first widens it by `dilatePx`). Returns a new mask. */
export const combine = (mask: AlphaMask, other: AlphaMask, mode: 'add' | 'subtract', dilatePx: number): AlphaMask => {
  const o = mode === 'subtract' ? dilateDisc(other, dilatePx) : other;
  const out = cloneMask(mask);
  for (let i = 0; i < out.alpha.length; i++) {
    out.alpha[i] = mode === 'add' ? Math.max(mask.alpha[i], o.alpha[i]) : Math.min(mask.alpha[i], 255 - o.alpha[i]);
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
 * Re-derives each part after the combined area was edited: a part keeps only what is still in
 * the edited area, and pixels in no part (newly added) go to the first part they can keep alive.
 * Parts left with fewer than `minPixels` covered pixels are dropped (the renderer would refuse
 * them, failing the whole room), so the first surviving part becomes the new part 0. Returns
 * the surviving parts' original indices with their new masks, in order. All masks share a size.
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
  const owner = added ? counts.findIndex((c) => c + added >= minPixels) : -1;
  const kept: Array<{ index: number; mask: AlphaMask }> = [];
  parts.forEach((_, k) => {
    if (k === owner) {
      const a = retained[k];
      for (let i = 0; i < n; i++) if (unclaimed[i] > a[i]) a[i] = unclaimed[i];
    } else if (counts[k] < minPixels) return;
    kept.push({ index: k, mask: { width: edited.width, height: edited.height, alpha: retained[k] } });
  });
  return kept;
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
  push(state: T): void;
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
    push(state) {
      let delta: Delta;
      if (state.width !== present.width || state.height !== present.height) delta = { whole: true, before: present, after: state };
      else {
        const rect = diffRect(present, state);
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
