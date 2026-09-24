# Area Editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hard-to-use Include/Exclude/brush tools with a shared, large Area Editor. It offers one-click AI cut-out/add of objects, polygon add/remove, brush/eraser, undo/redo, zoom/pan, fill/outline/original views and a material preview. It is used by the hotspot editor (`ShowcaseEditorModal`) and the studio's area check (`SurfaceReviewModal`).

**Architecture:** Every tool edits one alpha mask directly (no whole-surface re-cut). Pure mask maths live in `services/areaMaskOps.ts` (unit-tested in Node). Canvas↔mask bridges go in `services/maskCanvas.ts`. A new worker request `cutObject` returns the single SAM object at a click. `components/AreaEditor.tsx` owns the working mask, history and view state, and reports each committed edit through `onChange`.

**Tech Stack:** React 19 + TypeScript, Vite, Canvas2D for the overlay, the existing analysis Web Worker (SAM 2.1 via transformers.js), Vitest (unit), Playwright (e2e).

**Spec:** `docs/superpowers/specs/2026-09-24-area-editor-design.md`

## Global Constraints

- No new npm dependencies. Icons come from the installed `lucide-react`: `Scissors`, `CirclePlus`, `Pentagon`, `Hexagon`, `Brush`, `Eraser`, `Undo2`, `Redo2`, `ZoomIn`, `ZoomOut`, `Maximize`, `Loader2`, `Eye`, `Check`, `X`, `Pencil`.
- Editor masks are alpha masks at the photo's analysis resolution: white pixels, alpha = coverage (0–255). This is the format `cutSurface` already returns and `loadMaskAsAlpha` loads.
- Undo history is capped at **30** steps.
- Cut out dilates the object by **2 px** before subtracting.
- An object mask covering more than **60%** of the photo, or nothing at all, is rejected with: `Couldn't find a distinct object there — try the polygon tool`.
- The Cut/Add flash lasts **400 ms** (red `rgb(239,68,68)` for cut, green `rgb(34,197,94)` for add).
- Fill view is amber `rgb(251,191,36)`, default opacity **45%**. Outline view is a ~2 screen-px line in `rgb(34,211,238)`.
- Zoom range is **1×–8×**. Pan with Space+drag or middle-mouse drag, with any tool active.
- The polygon closes by double-click or by a click within **10 screen px** of the first corner. It needs ≥ 3 corners. Backspace removes the last corner and Esc cancels.
- Saving an empty area is blocked with: `The area is empty — add some of the surface first.`
- Run `npm run typecheck` and `npm test` after every task. Both must stay green.
- **Commits:** this repo's work is uncommitted on `main`. Do the "Commit" steps only if the user has approved committing; otherwise skip them and leave the changes in the working tree.

---

### Task 1: Pure mask operations

**Files:**
- Create: `services/areaMaskOps.ts`
- Test: `tests/unit/areaMaskOps.test.ts`

**Interfaces:**
- Produces:
  - `interface AlphaMask { width: number; height: number; alpha: Uint8ClampedArray }`
  - `interface Pt { x: number; y: number }` (image pixels)
  - `emptyMask(width: number, height: number): AlphaMask`
  - `cloneMask(mask: AlphaMask): AlphaMask`
  - `fillPolygon(mask: AlphaMask, points: Pt[], mode: 'add' | 'remove'): AlphaMask` (returns new)
  - `combine(mask: AlphaMask, other: AlphaMask, mode: 'add' | 'subtract', dilatePx: number): AlphaMask` (returns new)
  - `paintStroke(mask: AlphaMask, from: Pt, to: Pt, radius: number, mode: 'add' | 'erase'): void` (mutates `mask`)
  - `coveragePct(mask: AlphaMask): number` (0–100)
  - `maskOutline(mask: AlphaMask, thickness: number): Uint8Array` (1 = edge pixel)
  - `isUsableObjectMask(mask: AlphaMask): boolean`
  - `interface History<T> { push(state: T): void; undo(): T | null; redo(): T | null; canUndo(): boolean; canRedo(): boolean; current(): T }`
  - `createHistory<T>(initial: T, limit: number): History<T>`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/areaMaskOps.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  AlphaMask,
  cloneMask,
  combine,
  coveragePct,
  createHistory,
  emptyMask,
  fillPolygon,
  isUsableObjectMask,
  maskOutline,
  paintStroke,
} from '../../services/areaMaskOps';

const at = (m: AlphaMask, x: number, y: number) => m.alpha[y * m.width + x];
const count = (m: AlphaMask) => m.alpha.reduce((s, v) => s + (v > 127 ? 1 : 0), 0);
const square = (w: number, h: number, x0: number, y0: number, x1: number, y1: number) =>
  fillPolygon(emptyMask(w, h), [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], 'add');

describe('fillPolygon', () => {
  it('fills exactly the pixels whose centres are inside', () => {
    const m = square(30, 30, 10, 10, 20, 20);
    expect(count(m)).toBe(100);
    expect(at(m, 10, 10)).toBe(255);
    expect(at(m, 19, 19)).toBe(255);
    expect(at(m, 9, 10)).toBe(0);
    expect(at(m, 20, 10)).toBe(0);
  });

  it('removes a polygon and leaves the input untouched', () => {
    const full = fillPolygon(emptyMask(20, 20), [{ x: 0, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 20 }, { x: 0, y: 20 }], 'add');
    const holed = fillPolygon(full, [{ x: 5, y: 5 }, { x: 10, y: 5 }, { x: 10, y: 10 }, { x: 5, y: 10 }], 'remove');
    expect(count(full)).toBe(400);
    expect(count(holed)).toBe(375);
    expect(at(holed, 7, 7)).toBe(0);
  });

  it('ignores polygons with fewer than 3 corners', () => {
    const m = fillPolygon(emptyMask(10, 10), [{ x: 1, y: 1 }, { x: 8, y: 8 }], 'add');
    expect(count(m)).toBe(0);
  });
});

describe('combine', () => {
  it('subtracts an object widened by the dilation radius, leaving no halo', () => {
    const full = square(20, 20, 0, 0, 20, 20);
    const object = square(20, 20, 5, 5, 10, 10); // pixels 5..9
    const out = combine(full, object, 'subtract', 2);
    expect(at(out, 3, 7)).toBe(0); // 2 px left of the object
    expect(at(out, 11, 7)).toBe(0); // 2 px right
    expect(at(out, 2, 7)).toBe(255);
    expect(at(out, 12, 7)).toBe(255);
    expect(at(out, 3, 3)).toBe(255); // diagonal corner is outside a radius-2 disc
  });

  it('adds without dilation', () => {
    const a = square(20, 20, 0, 0, 5, 5);
    const b = square(20, 20, 10, 10, 15, 15);
    expect(count(combine(a, b, 'add', 0))).toBe(50);
  });
});

describe('paintStroke', () => {
  it('paints and erases a round-capped line', () => {
    const m = emptyMask(30, 20);
    paintStroke(m, { x: 5.5, y: 10.5 }, { x: 25.5, y: 10.5 }, 2, 'add');
    expect(at(m, 15, 10)).toBe(255);
    expect(at(m, 15, 12)).toBe(255);
    expect(at(m, 15, 13)).toBe(0);
    paintStroke(m, { x: 15.5, y: 10.5 }, { x: 15.5, y: 10.5 }, 1, 'erase');
    expect(at(m, 15, 10)).toBe(0);
    expect(at(m, 20, 10)).toBe(255);
  });
});

describe('coverage, outline and object checks', () => {
  it('measures coverage as a percentage of the photo', () => {
    expect(coveragePct(square(10, 10, 0, 0, 5, 10))).toBeCloseTo(50);
  });

  it('outlines only the edge band', () => {
    const edge = maskOutline(square(30, 30, 10, 10, 20, 20), 1);
    expect(edge.reduce((s, v) => s + v, 0)).toBe(36); // 100 - 8x8 interior
  });

  it('rejects empty and room-sized object masks', () => {
    expect(isUsableObjectMask(emptyMask(10, 10))).toBe(false);
    expect(isUsableObjectMask(square(10, 10, 0, 0, 10, 7))).toBe(false); // 70%
    expect(isUsableObjectMask(square(10, 10, 0, 0, 10, 5))).toBe(true); // 50%
  });

  it('clones independently', () => {
    const a = square(10, 10, 0, 0, 5, 5);
    const b = cloneMask(a);
    b.alpha[0] = 0;
    expect(at(a, 0, 0)).toBe(255);
  });
});

describe('createHistory', () => {
  it('undoes and redoes in order, and a new edit clears redo', () => {
    const h = createHistory(0, 30);
    h.push(1);
    h.push(2);
    expect(h.undo()).toBe(1);
    expect(h.undo()).toBe(0);
    expect(h.undo()).toBeNull();
    expect(h.redo()).toBe(1);
    h.push(5);
    expect(h.canRedo()).toBe(false);
    expect(h.current()).toBe(5);
  });

  it('keeps at most the limit of undo steps', () => {
    const h = createHistory(0, 30);
    for (let i = 1; i <= 35; i++) h.push(i);
    let undone = 0;
    while (h.undo() !== null) undone++;
    expect(undone).toBe(30);
    expect(h.current()).toBe(5);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/areaMaskOps.test.ts`
Expected: FAIL with `Failed to resolve import "../../services/areaMaskOps"`.

- [ ] **Step 3: Implement `services/areaMaskOps.ts`**

```ts
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

export const coveragePct = (mask: AlphaMask): number => {
  let sum = 0;
  for (let i = 0; i < mask.alpha.length; i++) sum += mask.alpha[i];
  return (sum / 255 / (mask.width * mask.height)) * 100;
};

/** Pixels inside the mask within `thickness` px (square neighbourhood) of its edge. */
export const maskOutline = (mask: AlphaMask, thickness: number): Uint8Array => {
  const { width: w, height: h } = mask;
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask.alpha[y * w + x] > 127;
  const out = new Uint8Array(w * h);
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

export interface History<T> {
  push(state: T): void;
  undo(): T | null;
  redo(): T | null;
  canUndo(): boolean;
  canRedo(): boolean;
  current(): T;
}

/** Linear undo/redo over immutable snapshots, keeping at most `limit` undo steps. */
export const createHistory = <T,>(initial: T, limit: number): History<T> => {
  const past: T[] = [];
  let present = initial;
  let future: T[] = [];
  return {
    push(state) {
      past.push(present);
      if (past.length > limit) past.shift();
      present = state;
      future = [];
    },
    undo() {
      if (!past.length) return null;
      future.push(present);
      present = past.pop()!;
      return present;
    },
    redo() {
      if (!future.length) return null;
      past.push(present);
      present = future.pop()!;
      return present;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    current: () => present,
  };
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/areaMaskOps.test.ts`
Expected: PASS, all tests. Then `npm run typecheck` (exit 0) and `npm test` (all pass).

- [ ] **Step 5: Commit** (only if approved, see Global Constraints)

```bash
git add services/areaMaskOps.ts tests/unit/areaMaskOps.test.ts
git commit -m "feat: pure mask operations for the area editor"
```

---

### Task 2: `cutObject` worker request

**Files:**
- Modify: `services/analysis/protocol.ts` (the `WorkerRequest` / `WorkerResponse` unions)
- Modify: `workers/analysis.worker.ts` (new `cutObject` function + dispatch in `self.onmessage`)
- Modify: `services/roomAnalysis.ts` (new exported `cutObject`)

**Interfaces:**
- Produces: `cutObject(imageUrl: string, point: PlanePoint): Promise<HTMLCanvasElement | null>` exported from `services/roomAnalysis.ts`. It returns an alpha mask canvas at the analysis resolution, or `null` when SAM found no object at the point.

- [ ] **Step 1: Extend the protocol**

In `services/analysis/protocol.ts`, add to the `WorkerRequest` union (after the `'cut'` member):

```ts
  | { id: number; type: 'cutObject'; imageUrl: string; point: { xPct: number; yPct: number } };
```

(Move the terminating `;` from the `'cut'` member to this new last member.)

Add to the `WorkerResponse` union, before the `'error'` member:

```ts
  | { id: number; type: 'cutObject'; width: number; height: number; mask: Uint8Array | null }
```

- [ ] **Step 2: Implement the worker side**

In `workers/analysis.worker.ts`, add above `self.onmessage`:

```ts
// Largest share of the photo one object click may return; more means SAM grabbed the room
const MAX_OBJECT_FRACTION = 0.6;

/**
 * The single object at a point (a lamp, a headboard…) for the Area Editor's cut-out/add tools:
 * one positive point, no box, so SAM's candidates are object-sized. Picks the best-scoring
 * candidate that contains the click and isn't room-sized; null when there is none.
 */
const cutObject = async (req: Extract<WorkerRequest, { type: 'cutObject' }>) => {
  const room = await loadRoom(req.imageUrl);
  const { width: w, height: h, gray } = room;
  const px = Math.min(w - 1, Math.max(0, Math.round((req.point.xPct / 100) * w)));
  const py = Math.min(h - 1, Math.max(0, Math.round((req.point.yPct / 100) * h)));
  reportStage('refining');
  room.prompts ??= encodeForPrompts(room.image);
  const sam = await segmentWithPrompts(await room.prompts, [{ x: px, y: py, positive: true }], null, w, h);
  let best = -1;
  let bestScore = -Infinity;
  sam.masks.forEach((m, k) => {
    if (!m[py * w + px]) return;
    let covered = 0;
    for (let i = 0; i < m.length; i++) if (m[i]) covered++;
    if (covered === 0 || covered > w * h * MAX_OBJECT_FRACTION) return;
    if (sam.scores[k] > bestScore) {
      bestScore = sam.scores[k];
      best = k;
    }
  });
  if (best < 0) return { width: w, height: h, mask: null };
  const binary = Uint8Array.from(sam.masks[best], (v) => (v ? 1 : 0));
  const radius = Math.max(2, Math.round(Math.max(w, h) * GUIDE_RADIUS_FRACTION));
  return { width: w, height: h, mask: guidedFilter(gray, binary, w, h, radius, GUIDE_EPSILON, EDGE_SHARPNESS) };
};
```

In `self.onmessage`, replace:

```ts
    } else {
      const result = await cut(req);
```

with:

```ts
    } else if (req.type === 'cutObject') {
      const result = await cutObject(req);
      post({ id: req.id, type: 'cutObject', ...result }, result.mask ? [result.mask.buffer] : []);
    } else {
      const result = await cut(req);
```

- [ ] **Step 3: Expose it on the page**

In `services/roomAnalysis.ts`, add directly after the `cutSurface` function:

```ts
/** The single object at a point (a lamp, a headboard…) as an alpha mask, or null if there is none. */
export const cutObject = async (imageUrl: string, point: PlanePoint): Promise<HTMLCanvasElement | null> => {
  const res = await send({ type: 'cutObject', imageUrl, point });
  if (res.type !== 'cutObject') throw new Error('Unexpected analysis response');
  return res.mask ? alphaCanvas(res.mask, res.width, res.height) : null;
};
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck` (expected exit 0) and `npm test` (expected all pass). The runtime behaviour is exercised end-to-end in Task 6.

- [ ] **Step 5: Commit** (only if approved)

```bash
git add services/analysis/protocol.ts workers/analysis.worker.ts services/roomAnalysis.ts
git commit -m "feat: cutObject worker request for one-click object masks"
```

---

### Task 3: `AreaEditor` component

**Files:**
- Modify: `services/maskCanvas.ts` (canvas ↔ `AlphaMask` bridges)
- Create: `components/AreaEditor.tsx`

**Interfaces:**
- Consumes: everything from Task 1; `cutObject` from Task 2.
- Produces:
  - from `services/maskCanvas.ts`:
    - `canvasToAlphaMask(canvas: HTMLCanvasElement): AlphaMask`
    - `alphaMaskToCanvas(mask: AlphaMask): HTMLCanvasElement`
    - `scaleMaskCanvas(canvas: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement`
  - from `components/AreaEditor.tsx`:
    - `AreaEditor: React.FC<AreaEditorProps>`
    - `interface AreaEditorProps { imageUrl: string; initialMask: HTMLCanvasElement; label: string; onChange: (mask: HTMLCanvasElement) => void; onPreview?: (mask: HTMLCanvasElement) => Promise<string> }`
    - `EMPTY_AREA_MESSAGE: string`
  - Test hooks: tool buttons carry `aria-label`s: `Cut out object`, `Add object/area`, `Polygon: add`, `Polygon: remove`, `Brush`, `Eraser`, `Undo`, `Redo`, `Zoom in`, `Zoom out`, `Fit`, `Preview`. The viewport has `data-testid="area-editor-viewport"` and the size read-out has `data-testid="area-coverage"`.

- [ ] **Step 1: Add the canvas bridges**

Append to `services/maskCanvas.ts`:

```ts
import type { AlphaMask } from './areaMaskOps';

/** Editable alpha canvas -> plain alpha mask (the Area Editor's working format). */
export const canvasToAlphaMask = (canvas: HTMLCanvasElement): AlphaMask => {
  const d = alphaOf(canvas).data;
  const alpha = new Uint8ClampedArray(canvas.width * canvas.height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = d[i * 4 + 3];
  return { width: canvas.width, height: canvas.height, alpha };
};

/** Plain alpha mask -> editable alpha canvas (white, alpha = coverage). */
export const alphaMaskToCanvas = (mask: AlphaMask): HTMLCanvasElement => {
  const canvas = canvasOf(mask.width, mask.height);
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(mask.width, mask.height);
  for (let i = 0; i < mask.alpha.length; i++) {
    img.data[i * 4] = 255;
    img.data[i * 4 + 1] = 255;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = mask.alpha[i];
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
};

/** A mask canvas redrawn at another resolution (masks from different sources may differ in size). */
export const scaleMaskCanvas = (canvas: HTMLCanvasElement, width: number, height: number): HTMLCanvasElement => {
  if (canvas.width === width && canvas.height === height) return canvas;
  const out = canvasOf(width, height);
  out.getContext('2d')!.drawImage(canvas, 0, 0, width, height);
  return out;
};
```

Move the new `import type` line to the top of the file with the other imports (the file currently has none, so it becomes line 1).

- [ ] **Step 2: Create `components/AreaEditor.tsx`**

```tsx
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Scissors, CirclePlus, Pentagon, Hexagon, Brush, Eraser, Undo2, Redo2, ZoomIn, ZoomOut, Maximize, Loader2, Eye } from 'lucide-react';
import {
  AlphaMask,
  History,
  Pt,
  cloneMask,
  combine,
  coveragePct,
  createHistory,
  fillPolygon,
  isUsableObjectMask,
  maskOutline,
  paintStroke,
} from '../services/areaMaskOps';
import { alphaMaskToCanvas, canvasToAlphaMask, scaleMaskCanvas } from '../services/maskCanvas';
import { cutObject } from '../services/roomAnalysis';

export interface AreaEditorProps {
  imageUrl: string;
  // The starting area (the AI cut or a saved area): white, alpha = coverage
  initialMask: HTMLCanvasElement;
  label: string;
  // Called after every committed edit, with a fresh canvas
  onChange: (mask: HTMLCanvasElement) => void;
  // Renders the material on the current area; resolves to an image URL
  onPreview?: (mask: HTMLCanvasElement) => Promise<string>;
}

export const EMPTY_AREA_MESSAGE = 'The area is empty — add some of the surface first.';

type Tool = 'cut' | 'add' | 'polyAdd' | 'polyRemove' | 'brush' | 'erase';
type View = 'fill' | 'outline' | 'original';

const HISTORY_LIMIT = 30;
const MIN_ZOOM = 1;
const MAX_ZOOM = 8;
const FLASH_MS = 400;
const CUT_DILATE_PX = 2;
const CLOSE_RADIUS_SCREEN_PX = 10;
const NO_OBJECT_MESSAGE = "Couldn't find a distinct object there — try the polygon tool";
const FILL_RGB = [251, 191, 36];
const OUTLINE_RGB = [34, 211, 238];
const CUT_RGB = [239, 68, 68];
const ADD_RGB = [34, 197, 94];

const TOOLS: Array<{ id: Tool; label: string; Icon: React.ComponentType<{ className?: string }> }> = [
  { id: 'cut', label: 'Cut out object', Icon: Scissors },
  { id: 'add', label: 'Add object/area', Icon: CirclePlus },
  { id: 'polyAdd', label: 'Polygon: add', Icon: Pentagon },
  { id: 'polyRemove', label: 'Polygon: remove', Icon: Hexagon },
  { id: 'brush', label: 'Brush', Icon: Brush },
  { id: 'erase', label: 'Eraser', Icon: Eraser },
];

const HINTS: Record<Tool, string> = {
  cut: 'Click an object that should keep its look (a lamp, the headboard, a curtain) to cut it out.',
  add: 'Click a part of the surface that was missed to add it.',
  polyAdd: 'Click corners to outline an area to add. Click the first corner or double-click to finish · Backspace removes a corner · Esc cancels.',
  polyRemove: 'Click corners to outline an area to remove. Click the first corner or double-click to finish · Backspace removes a corner · Esc cancels.',
  brush: 'Paint to add to the area.',
  erase: 'Paint to remove from the area.',
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * The one place a surface's area is adjusted (hotspot editor and studio area check). Every tool
 * edits the mask directly, so each correction does exactly what it shows, and can be undone.
 */
export const AreaEditor: React.FC<AreaEditorProps> = ({ imageUrl, initialMask, label, onChange, onPreview }) => {
  const [mask, setMask] = useState<AlphaMask>(() => canvasToAlphaMask(initialMask));
  const history = useRef<History<AlphaMask> | null>(null);
  if (!history.current) history.current = createHistory(mask, HISTORY_LIMIT);
  const [, setHistoryVersion] = useState(0);
  const [tool, setTool] = useState<Tool>('cut');
  const [view, setView] = useState<View>('fill');
  const [opacity, setOpacity] = useState(0.45);
  const [brushPct, setBrushPct] = useState(2);
  const [transform, setTransform] = useState({ zoom: 1, x: 0, y: 0 });
  const [stage, setStage] = useState({ left: 0, top: 0, width: 0 });
  const [polygon, setPolygon] = useState<Pt[]>([]);
  const [flash, setFlash] = useState<{ mask: AlphaMask; mode: 'add' | 'subtract' } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState(false);

  const viewportRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const stroke = useRef<{ working: AlphaMask; last: Pt } | null>(null);
  const panDrag = useRef<{ startX: number; startY: number; x: number; y: number } | null>(null);
  const spaceHeld = useRef(false);

  const emit = useCallback(
    (next: AlphaMask) => {
      setMask(next);
      setHistoryVersion((v) => v + 1);
      setPreviewUrl(null);
      onChange(alphaMaskToCanvas(next));
    },
    [onChange]
  );

  const commit = useCallback(
    (next: AlphaMask) => {
      history.current!.push(next);
      emit(next);
    },
    [emit]
  );

  const undo = useCallback(() => {
    const state = history.current!.undo();
    if (state) emit(state);
  }, [emit]);

  const redo = useCallback(() => {
    const state = history.current!.redo();
    if (state) emit(state);
  }, [emit]);

  // Fit the photo inside the viewport (the image keeps w-full h-auto inside the stage)
  const fitStage = useCallback(() => {
    const vp = viewportRef.current;
    const img = imgRef.current;
    if (!vp || !img || !img.naturalWidth) return;
    const vw = vp.clientWidth;
    const vh = vp.clientHeight;
    const width = Math.min(vw, vh * (img.naturalWidth / img.naturalHeight));
    const height = width * (img.naturalHeight / img.naturalWidth);
    setStage({ left: (vw - width) / 2, top: (vh - height) / 2, width });
  }, []);

  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const observer = new ResizeObserver(fitStage);
    observer.observe(vp);
    return () => observer.disconnect();
  }, [fitStage]);

  const drawOverlay = useCallback(
    (current: AlphaMask) => {
      const canvas = overlayRef.current;
      if (!canvas) return;
      canvas.width = current.width;
      canvas.height = current.height;
      const ctx = canvas.getContext('2d')!;
      const out = ctx.createImageData(current.width, current.height);
      const n = current.width * current.height;
      if (view === 'fill') {
        for (let i = 0; i < n; i++) {
          const a = current.alpha[i];
          if (!a) continue;
          out.data.set([FILL_RGB[0], FILL_RGB[1], FILL_RGB[2], Math.round(a * opacity)], i * 4);
        }
      } else if (view === 'outline') {
        // About 2 screen pixels at any zoom
        const shown = imgRef.current?.getBoundingClientRect().width || current.width;
        const edge = maskOutline(current, Math.max(1, Math.round((2 * current.width) / shown)));
        for (let i = 0; i < n; i++) if (edge[i]) out.data.set([OUTLINE_RGB[0], OUTLINE_RGB[1], OUTLINE_RGB[2], 255], i * 4);
      }
      if (flash) {
        const rgb = flash.mode === 'subtract' ? CUT_RGB : ADD_RGB;
        for (let i = 0; i < n; i++) if (flash.mask.alpha[i] > 127) out.data.set([rgb[0], rgb[1], rgb[2], 170], i * 4);
      }
      ctx.putImageData(out, 0, 0);
    },
    [view, opacity, flash]
  );

  useEffect(() => {
    drawOverlay(mask);
  }, [mask, drawOverlay, transform.zoom, stage.width]);

  const zoomAt = useCallback((cx: number, cy: number, factor: number) => {
    setTransform((t) => {
      const zoom = clamp(t.zoom * factor, MIN_ZOOM, MAX_ZOOM);
      if (zoom === MIN_ZOOM) return { zoom, x: 0, y: 0 };
      const k = zoom / t.zoom;
      return { zoom, x: cx - (cx - t.x) * k, y: cy - (cy - t.y) * k };
    });
  }, []);

  // Wheel / trackpad pinch zoom around the cursor (non-passive so the page doesn't scroll)
  useEffect(() => {
    const vp = viewportRef.current;
    if (!vp) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = vp.getBoundingClientRect();
      zoomAt(e.clientX - rect.left - stage.left, e.clientY - rect.top - stage.top, Math.exp(-e.deltaY * 0.0015));
    };
    vp.addEventListener('wheel', onWheel, { passive: false });
    return () => vp.removeEventListener('wheel', onWheel);
  }, [zoomAt, stage.left, stage.top]);

  const zoomButton = (factor: number) => {
    const vp = viewportRef.current;
    if (!vp) return;
    zoomAt(vp.clientWidth / 2 - stage.left, vp.clientHeight / 2 - stage.top, factor);
  };

  const toImagePoint = (clientX: number, clientY: number): Pt | null => {
    const rect = imgRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return null;
    return { x: ((clientX - rect.left) / rect.width) * mask.width, y: ((clientY - rect.top) / rect.height) * mask.height };
  };

  // Image pixels per screen pixel at the current zoom
  const imagePxPerScreenPx = () => mask.width / (imgRef.current?.getBoundingClientRect().width || mask.width);

  const closePolygon = (points: Pt[]) => {
    if (points.length < 3) return;
    commit(fillPolygon(mask, points, tool === 'polyAdd' ? 'add' : 'remove'));
    setPolygon([]);
  };

  const handlePolygonClick = (p: Pt) => {
    const tolerance = CLOSE_RADIUS_SCREEN_PX * imagePxPerScreenPx();
    if (polygon.length >= 3 && Math.hypot(p.x - polygon[0].x, p.y - polygon[0].y) <= tolerance) {
      closePolygon(polygon);
      return;
    }
    const last = polygon[polygon.length - 1];
    // The second click of a double-click lands on the last corner: not a new corner
    if (last && Math.hypot(p.x - last.x, p.y - last.y) <= tolerance / 5) return;
    setPolygon([...polygon, p]);
  };

  const runObjectTool = async (p: Pt) => {
    setBusy(true);
    setMessage(null);
    try {
      const canvas = await cutObject(imageUrl, { xPct: (p.x / mask.width) * 100, yPct: (p.y / mask.height) * 100 });
      const object = canvas ? canvasToAlphaMask(scaleMaskCanvas(canvas, mask.width, mask.height)) : null;
      if (!object || !isUsableObjectMask(object)) {
        setMessage(NO_OBJECT_MESSAGE);
        return;
      }
      const mode = tool === 'cut' ? 'subtract' : 'add';
      setFlash({ mask: object, mode });
      await new Promise((resolve) => setTimeout(resolve, FLASH_MS));
      setFlash(null);
      commit(combine(mask, object, mode, mode === 'subtract' ? CUT_DILATE_PX : 0));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not outline that object.');
    } finally {
      setBusy(false);
    }
  };

  const brushRadius = () => ((brushPct / 100) * mask.width) / 2;

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button === 1 || (e.button === 0 && spaceHeld.current)) {
      e.preventDefault();
      e.currentTarget.setPointerCapture(e.pointerId);
      panDrag.current = { startX: e.clientX, startY: e.clientY, x: transform.x, y: transform.y };
      return;
    }
    if (e.button !== 0 || busy || previewUrl) return;
    const p = toImagePoint(e.clientX, e.clientY);
    if (!p) return;
    if (tool === 'brush' || tool === 'erase') {
      e.currentTarget.setPointerCapture(e.pointerId);
      const working = cloneMask(mask);
      paintStroke(working, p, p, brushRadius(), tool === 'brush' ? 'add' : 'erase');
      stroke.current = { working, last: p };
      drawOverlay(working);
    } else if (tool === 'cut' || tool === 'add') {
      runObjectTool(p);
    } else {
      handlePolygonClick(p);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (panDrag.current) {
      const d = panDrag.current;
      setTransform((t) => (t.zoom === MIN_ZOOM ? t : { ...t, x: d.x + e.clientX - d.startX, y: d.y + e.clientY - d.startY }));
      return;
    }
    if (!stroke.current) return;
    const p = toImagePoint(e.clientX, e.clientY);
    if (!p) return;
    paintStroke(stroke.current.working, stroke.current.last, p, brushRadius(), tool === 'brush' ? 'add' : 'erase');
    stroke.current.last = p;
    drawOverlay(stroke.current.working);
  };

  const handlePointerUp = () => {
    panDrag.current = null;
    if (!stroke.current) return;
    const { working } = stroke.current;
    stroke.current = null;
    commit(working);
  };

  // Keyboard: undo/redo, polygon corners, Space to pan
  useEffect(() => {
    const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
    const onKeyDown = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if (e.key === ' ') {
        spaceHeld.current = true;
        e.preventDefault();
        return;
      }
      if (polygon.length && e.key === 'Backspace') {
        e.preventDefault();
        setPolygon((prev) => prev.slice(0, -1));
      }
      if (polygon.length && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setPolygon([]);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.key === ' ') spaceHeld.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, [undo, redo, polygon.length]);

  const selectTool = (next: Tool) => {
    setTool(next);
    setPolygon([]);
    setMessage(null);
  };

  const runPreview = async () => {
    if (!onPreview) return;
    setPreviewing(true);
    setMessage(null);
    try {
      setPreviewUrl(await onPreview(alphaMaskToCanvas(mask)));
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Could not render a preview.');
    } finally {
      setPreviewing(false);
    }
  };

  const button = (active: boolean) =>
    `flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors disabled:opacity-40 ${
      active ? 'bg-amber-500/20 text-amber-300 border-amber-500/40' : 'bg-white/[0.03] text-slate-300 border-white/[0.08] hover:bg-white/[0.07]'
    }`;
  const polyStroke = 2 * imagePxPerScreenPx();

  return (
    <div className="flex flex-col gap-3 min-h-0">
      <div className="flex flex-wrap items-center gap-1.5">
        {TOOLS.map(({ id, label: toolLabel, Icon }) => (
          <button key={id} type="button" aria-label={toolLabel} title={toolLabel} onClick={() => selectTool(id)} className={button(tool === id)}>
            <Icon className="w-3.5 h-3.5" /> <span className="hidden md:inline">{toolLabel}</span>
          </button>
        ))}
        {(tool === 'brush' || tool === 'erase') && (
          <label className="flex items-center gap-1.5 text-[11px] text-slate-400 ml-1">
            Size
            <input type="range" min={0.5} max={12} step={0.5} value={brushPct} onChange={(e) => setBrushPct(Number(e.target.value))} className="w-20 accent-amber-500" />
          </label>
        )}
        <span className="w-px h-5 bg-white/10 mx-1" />
        <button type="button" aria-label="Undo" title="Undo (Ctrl+Z)" onClick={undo} disabled={!history.current!.canUndo()} className={button(false)}>
          <Undo2 className="w-3.5 h-3.5" />
        </button>
        <button type="button" aria-label="Redo" title="Redo (Ctrl+Shift+Z)" onClick={redo} disabled={!history.current!.canRedo()} className={button(false)}>
          <Redo2 className="w-3.5 h-3.5" />
        </button>
        <span className="w-px h-5 bg-white/10 mx-1" />
        <button type="button" aria-label="Zoom out" title="Zoom out" onClick={() => zoomButton(1 / 1.5)} className={button(false)}>
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button type="button" aria-label="Zoom in" title="Zoom in" onClick={() => zoomButton(1.5)} className={button(false)}>
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button type="button" aria-label="Fit" title="Fit" onClick={() => setTransform({ zoom: 1, x: 0, y: 0 })} className={button(false)}>
          <Maximize className="w-3.5 h-3.5" />
        </button>
        <span className="w-px h-5 bg-white/10 mx-1" />
        {(['fill', 'outline', 'original'] as View[]).map((v) => (
          <button key={v} type="button" onClick={() => setView(v)} className={button(view === v)}>
            {v === 'fill' ? 'Fill' : v === 'outline' ? 'Outline' : 'Original'}
          </button>
        ))}
        {view === 'fill' && (
          <input
            type="range"
            aria-label="Fill strength"
            min={0.15}
            max={0.9}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
            className="w-20 accent-amber-500"
          />
        )}
      </div>

      <div
        ref={viewportRef}
        data-testid="area-editor-viewport"
        className="relative overflow-hidden rounded-xl bg-black h-[62vh] select-none touch-none"
        style={{ cursor: busy ? 'progress' : tool === 'brush' || tool === 'erase' ? 'cell' : 'crosshair' }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        onDoubleClick={() => (tool === 'polyAdd' || tool === 'polyRemove') && closePolygon(polygon)}
        onAuxClick={(e) => e.preventDefault()}
      >
        <div
          className="absolute"
          style={{
            left: stage.left,
            top: stage.top,
            width: stage.width || '100%',
            transform: `translate(${transform.x}px, ${transform.y}px) scale(${transform.zoom})`,
            transformOrigin: '0 0',
          }}
        >
          <img
            ref={imgRef}
            src={previewUrl ?? imageUrl}
            crossOrigin="anonymous"
            draggable={false}
            alt=""
            onLoad={fitStage}
            className="block w-full h-auto"
          />
          {view !== 'original' && !previewUrl && <canvas ref={overlayRef} className="absolute inset-0 w-full h-full pointer-events-none" />}
          {polygon.length > 0 && !previewUrl && (
            <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${mask.width} ${mask.height}`} preserveAspectRatio="none">
              <polygon
                points={polygon.map((p) => `${p.x},${p.y}`).join(' ')}
                fill={tool === 'polyAdd' ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}
                stroke="#38bdf8"
                strokeWidth={polyStroke}
              />
              {polygon.map((p, i) => (
                <circle key={i} cx={p.x} cy={p.y} r={polyStroke * (i === 0 ? 3 : 2)} fill={i === 0 ? '#fbbf24' : '#38bdf8'} />
              ))}
            </svg>
          )}
        </div>
        {busy && (
          <div className="absolute top-3 left-1/2 -translate-x-1/2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-black/70 text-[11px] text-slate-200">
            <Loader2 className="w-3.5 h-3.5 animate-spin" /> Outlining the object…
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px]">
        <span data-testid="area-coverage" className="text-slate-300 font-medium">
          {label}: {coveragePct(mask).toFixed(1)}% of photo
        </span>
        <span className="text-slate-500">{HINTS[tool]} · Scroll to zoom · Space+drag to pan</span>
        {message && <span className="text-rose-300">{message}</span>}
        {onPreview && (
          <button
            type="button"
            aria-label="Preview"
            onClick={previewUrl ? () => setPreviewUrl(null) : runPreview}
            disabled={previewing}
            className={`ml-auto ${button(Boolean(previewUrl))}`}
          >
            {previewing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
            {previewUrl ? 'Back to editing' : 'Preview'}
          </button>
        )}
      </div>
    </div>
  );
};
```

- [ ] **Step 3: Verify**

Run: `npm run typecheck` (expected exit 0) and `npm test` (expected all pass). The component is exercised in the browser in Tasks 5 and 6.

- [ ] **Step 4: Commit** (only if approved)

```bash
git add services/maskCanvas.ts components/AreaEditor.tsx
git commit -m "feat: shared AreaEditor with cut-out, polygon, brush, undo and zoom"
```

---

### Task 4: Use the Area Editor in the hotspot editor

**Files:**
- Create: `services/areaPreview.ts`
- Modify: `services/maskCanvas.ts` (add `clearOccluderUnder`)
- Modify: `components/SurfaceMaskOverlay.tsx` (display only)
- Modify: `components/ShowcaseEditorModal.tsx`
- Modify: `App.tsx` (pass `previewMaterial`)

**Interfaces:**
- Consumes: `AreaEditor`, `EMPTY_AREA_MESSAGE` (Task 3); `canvasToAlphaMask` (Task 3); `coveragePct` (Task 1).
- Produces:
  - `clearOccluderUnder(occluder: HTMLCanvasElement, area: HTMLCanvasElement): HTMLCanvasElement`: occluder alpha = min(occluder, 255 − area), so area the vendor added is never restored on top.
  - `previewArea(imageUrl: string, area: { kind: SurfaceKind; parts: Array<{ mask: HTMLCanvasElement; geometry: SurfaceGeometry | null }>; occluder: HTMLCanvasElement | null }, edited: HTMLCanvasElement, material: Material): Promise<string>`
  - `ShowcaseEditorModal` prop `previewMaterial?: Material | null`
  - `SurfaceMaskOverlay` props become `{ mask: HTMLCanvasElement }`

- [ ] **Step 1: Add `clearOccluderUnder` to `services/maskCanvas.ts`**

```ts
/** The occluder with the edited area removed: anything the user added is surface, not an object in front. */
export const clearOccluderUnder = (occluder: HTMLCanvasElement, area: HTMLCanvasElement): HTMLCanvasElement => {
  const o = alphaOf(occluder).data;
  const a = alphaOf(scaleMaskCanvas(area, occluder.width, occluder.height)).data;
  const out = canvasOf(occluder.width, occluder.height);
  const ctx = out.getContext('2d')!;
  const img = ctx.createImageData(occluder.width, occluder.height);
  for (let i = 3; i < o.length; i += 4) {
    img.data[i - 3] = 255;
    img.data[i - 2] = 255;
    img.data[i - 1] = 255;
    img.data[i] = Math.min(o[i], 255 - a[i]);
  }
  ctx.putImageData(img, 0, 0);
  return out;
};
```

- [ ] **Step 2: Create `services/areaPreview.ts`**

```ts
import { Material, SurfaceGeometry, SurfaceKind } from '../types';
import { applyEditsToParts, clearOccluderUnder } from './maskCanvas';
import { renderMaterial } from './renderer/materialRenderer';

/** Renders a material on an edited area, split back into its planes, exactly as it will be saved. */
export const previewArea = (
  imageUrl: string,
  area: { kind: SurfaceKind; parts: Array<{ mask: HTMLCanvasElement; geometry: SurfaceGeometry | null }>; occluder: HTMLCanvasElement | null },
  edited: HTMLCanvasElement,
  material: Material
): Promise<string> => {
  const masks = applyEditsToParts(area.parts.map((p) => p.mask), edited);
  const occluder = area.occluder ? clearOccluderUnder(area.occluder, edited) : null;
  return renderMaterial(
    imageUrl,
    area.parts.map((p, k) => ({ surface: { kind: area.kind, mask: masks[k], occluderMask: occluder, plane: p.geometry }, material }))
  );
};
```

- [ ] **Step 3: Make `components/SurfaceMaskOverlay.tsx` display-only**

Replace the whole file with:

```tsx
import React, { useEffect, useRef } from 'react';

interface SurfaceMaskOverlayProps {
  // Alpha mask at the photo's full resolution (white, alpha = coverage)
  mask: HTMLCanvasElement;
}

const TINT = 'rgb(251, 191, 36)';

// Amber preview of a surface mask, laid exactly over the photo (the photo renders at
// w-full h-auto, so the overlay's inset-0 box matches it). Editing happens in AreaEditor.
export const SurfaceMaskOverlay: React.FC<SurfaceMaskOverlayProps> = ({ mask }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = mask.width;
    canvas.height = mask.height;
    const ctx = canvas.getContext('2d')!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(mask, 0, 0);
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = TINT;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = 'source-over';
  }, [mask]);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full opacity-50 pointer-events-none" />;
};
```

- [ ] **Step 4: Rewire `components/ShowcaseEditorModal.tsx`**

Apply these edits in order.

a) Imports (top of file). Replace:

```tsx
import {
  X, MapPin, Trash2, Loader2, AlertCircle, Plus, Pencil, ScanSearch, Brush, Eraser, RefreshCw, Check, Grid3x3,
  CirclePlus, CircleMinus, Ruler,
} from 'lucide-react';
```

with:

```tsx
import { X, MapPin, Trash2, Loader2, AlertCircle, Plus, Pencil, ScanSearch, RefreshCw, Check, Grid3x3, Ruler } from 'lucide-react';
```

Replace `import { SurfaceMaskOverlay, BrushMode } from './SurfaceMaskOverlay';` with:

```tsx
import { SurfaceMaskOverlay } from './SurfaceMaskOverlay';
import { AreaEditor, EMPTY_AREA_MESSAGE } from './AreaEditor';
import { previewArea } from '../services/areaPreview';
import { coveragePct } from '../services/areaMaskOps';
```

Replace `import { DetectedItem, PlanePoint, SurfaceCalibration, SurfaceGeometry, SurfaceKind } from '../types';` with:

```tsx
import { DetectedItem, Material, PlanePoint, SurfaceCalibration, SurfaceGeometry, SurfaceKind } from '../types';
```

Replace `import { alphaMaskToPngBlob, applyEditsToParts, loadMaskAsAlpha, unionMasks } from '../services/maskCanvas';` with:

```tsx
import { alphaMaskToPngBlob, applyEditsToParts, canvasToAlphaMask, clearOccluderUnder, loadMaskAsAlpha, unionMasks } from '../services/maskCanvas';
```

b) `type ClickTool = 'move' | 'include' | 'exclude' | 'ruler';` becomes `type ClickTool = 'move' | 'ruler';`

c) In `interface ShowcaseEditorModalProps`, add after `onDeleteSurface`:

```tsx
  // The studio's current material, for the Area Editor's Preview button
  previewMaterial?: Material | null;
```

and add `previewMaterial,` to the destructured props after `onDeleteSurface,`.

d) State: delete these three lines:

```tsx
  const [prompts, setPrompts] = useState<{ include: PlanePoint[]; exclude: PlanePoint[] }>({ include: [], exclude: [] });
  const [brushMode, setBrushMode] = useState<BrushMode>('off');
  const [brushSizePct, setBrushSizePct] = useState(3);
```

and add after `const [clickTool, setClickTool] = useState<ClickTool>('move');`:

```tsx
  const [areaEditorOpen, setAreaEditorOpen] = useState(false);
```

e) In `resetArea`, delete `setPrompts({ include: [], exclude: [] });` and `setBrushMode('off');`, and add `setAreaEditorOpen(false);`.

f) Replace the `detectArea` signature and its `cutSurface` call:

```tsx
  const detectArea = async (
    point: PlanePoint,
    label?: string,
    connected = connectedOnly,
    corrections: { include: PlanePoint[]; exclude: PlanePoint[] } = prompts
  ) => {
```

becomes

```tsx
  const detectArea = async (point: PlanePoint, label?: string, connected = connectedOnly) => {
```

and `const cut = await cutSurface(selectedImage.imageUrl, point, { label, connectedOnly: connected, ...corrections });` becomes `const cut = await cutSurface(selectedImage.imageUrl, point, { label, connectedOnly: connected });`.

g) In `startCreateHotspot`, `detectArea({ xPct, yPct }, surfaceLabel, connected, { include: [], exclude: [] });` becomes `detectArea({ xPct, yPct }, surfaceLabel, connected);`.

h) In `handleImageClick`, delete the whole block:

```tsx
    if (clickTool === 'include' || clickTool === 'exclude') {
      const next = { ...prompts, [clickTool]: [...prompts[clickTool], point] };
      setPrompts(next);
      detectArea({ xPct: pendingForm.xPct, yPct: pendingForm.yPct }, area?.label, connectedOnly, next);
      return;
    }
```

and replace

```tsx
    setPrompts({ include: [], exclude: [] });
    detectArea(point, undefined, connectedOnly, { include: [], exclude: [] });
```

with

```tsx
    detectArea(point, undefined, connectedOnly);
```

i) In `submitForm`, insert right after the first guard line (`if (!pendingForm || !selectedImage || ...) return;`):

```tsx
    if (area && areaMask && coveragePct(canvasToAlphaMask(areaMask)) === 0) {
      setSaveError(EMPTY_AREA_MESSAGE);
      return;
    }
```

and replace

```tsx
          area.occluder ? onUploadMask(await alphaMaskToPngBlob(area.occluder)) : Promise.resolve(null),
```

with

```tsx
          area.occluder
            ? onUploadMask(await alphaMaskToPngBlob(maskDirty ? clearOccluderUnder(area.occluder, areaMask) : area.occluder))
            : Promise.resolve(null),
```

j) `const toolsIdle = brushMode === 'off' && clickTool === 'move';` becomes `const toolsIdle = clickTool === 'move';`. In `toolButton`'s `onClick`, delete `setBrushMode('off');`.

k) Overlay: `<SurfaceMaskOverlay mask={areaMask} brushMode={brushMode} brushSizePct={brushSizePct} onEdited={() => setMaskDirty(true)} />` becomes `<SurfaceMaskOverlay mask={areaMask} />`.

l) Hint paragraph: replace

```tsx
                    : clickTool === 'include'
                      ? 'Click parts of the surface the amber area missed.'
                      : clickTool === 'exclude'
                        ? 'Click things wrongly included (a curtain, a doorway…) to cut them out.'
                        : clickTool === 'ruler'
                          ? 'Click two points on the surface a known distance apart (e.g. floor to ceiling, a door\'s height).'
                          : 'Click the photo to move this hotspot and re-detect the surface there. The amber area is exactly what gets re-surfaced.'}
```

with

```tsx
                    : clickTool === 'ruler'
                      ? 'Click two points on the surface a known distance apart (e.g. floor to ceiling, a door\'s height).'
                      : 'Click the photo to move this hotspot and re-detect the surface there. The amber area is exactly what gets re-surfaced — use Adjust area to fix it.'}
```

m) Re-detect button: its `onClick` body

```tsx
                            setPrompts({ include: [], exclude: [] });
                            if (areaPoint) detectArea(areaPoint, area?.label, connectedOnly, { include: [], exclude: [] });
```

becomes

```tsx
                            if (areaPoint) detectArea(areaPoint, area?.label, connectedOnly);
```

n) Replace the whole "Fix:" block, from `{area && (` containing `<span className="text-[11px] text-slate-400">Fix:</span>` down to and including the `{(prompts.include.length > 0 || prompts.exclude.length > 0) && ( ... )}` paragraph, with:

```tsx
                      {area && areaMask && (
                        <button
                          type="button"
                          onClick={() => setAreaEditorOpen(true)}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-500/40 hover:bg-amber-500/25"
                        >
                          <Pencil className="w-3 h-3" /> Adjust area
                        </button>
                      )}
```

o) Render the editor layer **next to** the modal, not inside it. The outer `fixed inset-0 z-[100] … backdrop-blur-md … overflow-y-auto` div has a backdrop filter, which makes any `position: fixed` descendant position relative to that scrolling div instead of the screen.

First define the layer just above the component's `return (` (after `toolButton`):

```tsx
  const areaEditorLayer =
    areaEditorOpen && area && areaMask && selectedImage ? (
      <div className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-sm flex flex-col gap-3 p-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-semibold text-white">Adjust the “{formLabel || titleCase(area.label)}” area</h3>
            <p className="text-[10px] text-slate-400">The amber area is exactly what gets the new material. Every step can be undone.</p>
          </div>
          <button
            type="button"
            onClick={() => setAreaEditorOpen(false)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 text-slate-950 text-xs font-semibold"
          >
            <Check className="w-3.5 h-3.5" /> Done
          </button>
        </div>
        <AreaEditor
          imageUrl={selectedImage.imageUrl}
          initialMask={areaMask}
          label={formLabel || titleCase(area.label)}
          onChange={(mask) => {
            setAreaMask(mask);
            setMaskDirty(true);
            setSaveError(null);
          }}
          onPreview={previewMaterial ? (mask) => previewArea(selectedImage.imageUrl, area, mask, previewMaterial) : undefined}
        />
      </div>
    ) : null;
```

Then wrap the returned JSX in a fragment. Change

```tsx
  return (
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
```

to

```tsx
  return (
    <>
    <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-md flex items-center justify-center p-4 overflow-y-auto">
```

and change the file's final lines

```tsx
      </div>
    </div>
  );
};
```

to

```tsx
      </div>
    </div>
    {areaEditorLayer}
    </>
  );
};
```

p) `App.tsx`: in the `<ShowcaseEditorModal ... />` element, add `previewMaterial={selectedMaterial}` after `onDeleteSurface={handleDeleteSurface}`.

- [ ] **Step 5: Verify**

Run: `npm run typecheck` (expected exit 0). If it reports `PlanePoint` or another import as unused, TypeScript won't fail on it, but remove it anyway if nothing uses it. Then run `npm test` (all pass).

Then manually: `npm run dev`, sign in as a vendor, open **Manage Showcase & Hotspots**, add a surface, and click **Adjust area**. Check that the large editor opens, a Cut out click on a lamp flashes red and removes it, Undo restores it, and Done closes the editor with the amber overlay updated.

- [ ] **Step 6: Commit** (only if approved)

```bash
git add services/maskCanvas.ts services/areaPreview.ts components/SurfaceMaskOverlay.tsx components/ShowcaseEditorModal.tsx App.tsx
git commit -m "feat: hotspot editor adjusts areas in the AreaEditor"
```

---

### Task 5: Use the Area Editor in the studio's area check

**Files:**
- Modify (replace whole file): `components/SurfaceReviewModal.tsx`
- Modify: `App.tsx` (pass `previewMaterial`)
- Modify: `tests/e2e/studio-flow.spec.ts` (the review step)

**Interfaces:**
- Consumes: `AreaEditor`, `EMPTY_AREA_MESSAGE`, `previewArea`, `clearOccluderUnder`, `canvasToAlphaMask`, `coveragePct`.
- Produces: `SurfaceReviewModal` prop `previewMaterial?: Material | null`.

- [ ] **Step 1: Replace `components/SurfaceReviewModal.tsx`**

```tsx
import React, { useEffect, useState } from 'react';
import { X, Loader2, Check } from 'lucide-react';
import { DetectedItem, Material } from '../types';
import { AreaEditor, EMPTY_AREA_MESSAGE } from './AreaEditor';
import { cutSurface, cutToRenderables, CutSurface } from '../services/roomAnalysis';
import { applyEditsToParts, canvasToAlphaMask, clearOccluderUnder, unionMasks } from '../services/maskCanvas';
import { coveragePct } from '../services/areaMaskOps';
import { previewArea } from '../services/areaPreview';

interface SurfaceReviewModalProps {
  imageUrl: string;
  item: DetectedItem;
  // The studio's current material, for the Preview button
  previewMaterial?: Material | null;
  onClose: () => void;
  // The corrected surface, ready to render
  onAccept: (item: DetectedItem) => void;
}

/**
 * "Confirm only when needed": shown for a surface whose analysis confidence is below the auto
 * threshold. The user sees the exact area and adjusts it in the AreaEditor.
 */
export const SurfaceReviewModal: React.FC<SurfaceReviewModalProps> = ({ imageUrl, item, previewMaterial, onClose, onAccept }) => {
  const [cut, setCut] = useState<CutSurface | null>(null);
  const [edited, setEdited] = useState<HTMLCanvasElement | null>(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item.anchor) {
      setError(`"${item.name}" has no detected area to check.`);
      return;
    }
    let cancelled = false;
    cutSurface(imageUrl, item.anchor, { label: item.surfaceLabel })
      .then((result) => {
        if (cancelled) return;
        setCut(result);
        setEdited(unionMasks(result.parts.map((p) => p.mask)));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load the area.');
      });
    return () => {
      cancelled = true;
    };
  }, [imageUrl, item.anchor, item.surfaceLabel, item.name]);

  const accept = () => {
    if (!cut || !edited) return;
    if (coveragePct(canvasToAlphaMask(edited)) === 0) {
      setError(EMPTY_AREA_MESSAGE);
      return;
    }
    const masks = dirty ? applyEditsToParts(cut.parts.map((p) => p.mask), edited) : cut.parts.map((p) => p.mask);
    const occluder = dirty ? clearOccluderUnder(cut.occluder, edited) : cut.occluder;
    const surfaces = cutToRenderables({ ...cut, occluder, parts: cut.parts.map((p, k) => ({ ...p, mask: masks[k] })) });
    // The user has now checked this area
    onAccept({ ...item, surfaces, confidence: Math.round(cut.confidence * 100), needsReview: false, reviewDecision: 'auto' });
  };

  return (
    <div className="fixed inset-0 z-[110] bg-black/90 backdrop-blur-sm flex flex-col gap-3 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold text-white">Check the “{item.name}” area</h3>
          <p className="text-[10px] text-slate-400">The amber area is exactly what gets the new material. Every step can be undone.</p>
        </div>
        <button type="button" aria-label="Close" onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-white/[0.06]">
          <X className="w-4 h-4" />
        </button>
      </div>
      {!cut && !error && (
        <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading the area…
        </p>
      )}
      {cut && edited && (
        <AreaEditor
          imageUrl={imageUrl}
          initialMask={edited}
          label={item.name}
          onChange={(mask) => {
            setEdited(mask);
            setDirty(true);
            setError(null);
          }}
          onPreview={
            previewMaterial
              ? (mask) => previewArea(imageUrl, { kind: cut.kind, parts: cut.parts, occluder: cut.occluder }, mask, previewMaterial)
              : undefined
          }
        />
      )}
      {error && <p className="text-[11px] text-rose-300">{error}</p>}
      <div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="px-4 py-2 rounded-xl bg-white/[0.05] border border-white/[0.08] text-xs text-slate-300 hover:text-white">
          Cancel
        </button>
        <button
          type="button"
          onClick={accept}
          disabled={!cut}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-600 text-slate-950 text-xs font-semibold disabled:opacity-60"
        >
          <Check className="w-3.5 h-3.5" /> Use this area
        </button>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: Pass the material from `App.tsx`**

In the `<SurfaceReviewModal ... />` element, add `previewMaterial={selectedMaterial}` after `item={reviewingItem}`.

- [ ] **Step 3: Update the review step in `tests/e2e/studio-flow.spec.ts`**

Replace the block from `const badge = page.locator('[title="Low confidence — check and fix the area"]').first();` through the closing `}` of its `if`, with:

```ts
  const badge = page.locator('[title="Low confidence — check and fix the area"]').first();
  if (await badge.count()) {
    await badge.click();
    const title = page.getByText(/Check the “.+” area/);
    await expect(title).toBeVisible();
    const viewport = page.getByTestId('area-editor-viewport');
    await expect(viewport).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Cut out object' }).click();
    const box = (await viewport.locator('img').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.9);
    await expect(page.getByText('Outlining the object…')).toHaveCount(0, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Use this area' }).click();
    await expect(title).toHaveCount(0);
  }
```

- [ ] **Step 4: Verify**

Run: `npm run typecheck` (exit 0), `npm test` (all pass), then `npx playwright test tests/e2e/studio-flow.spec.ts`.
Expected: `1 passed` (about 2 minutes).

- [ ] **Step 5: Commit** (only if approved)

```bash
git add components/SurfaceReviewModal.tsx App.tsx tests/e2e/studio-flow.spec.ts
git commit -m "feat: studio area check uses the AreaEditor"
```

---

### Task 6: End-to-end test, real-photo check and docs

**Files:**
- Create: `tests/e2e/area-editor.spec.ts`
- Modify: `CLAUDE.md` (the "Room analysis" bullet and the storefront paragraph mention of the editor)

**Interfaces:**
- Consumes: the aria-labels and test ids from Task 3; the review modal from Task 5.

- [ ] **Step 1: Write the e2e test**

Create `tests/e2e/area-editor.spec.ts`:

```ts
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, Page, test } from '@playwright/test';

// The Area Editor through the studio's area check: polygon add, undo/redo, and a one-click
// object cut-out, each changing the area exactly as shown. Uses the room photo cached by
// studio-flow.spec.ts (same URL) and the local models.
const ROOM_URL = 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1600&q=85';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '.cache', 'room.jpg');

const roomPhoto = async (): Promise<string | null> => {
  if (fs.existsSync(CACHE)) return CACHE;
  try {
    const res = await fetch(ROOM_URL);
    if (!res.ok) return null;
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, Buffer.from(await res.arrayBuffer()));
    return CACHE;
  } catch {
    return null;
  }
};

const coverage = async (page: Page) => {
  const text = (await page.getByTestId('area-coverage').textContent()) ?? '';
  return Number(/([\d.]+)% of photo/.exec(text)?.[1]);
};

test('area editor: polygon add, undo/redo, object cut-out', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  test.skip(!fs.existsSync(path.join(HERE, '../../public/models')), 'local models missing — run npm run assets:fetch');
  const photo = await roomPhoto();
  test.skip(!photo, 'room photo could not be downloaded (offline?)');

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/studio');
  await page.locator('#room-file-input').setInputFiles(photo!);
  await expect(page.locator('[id^="detected-item-"]').first()).toBeVisible({ timeout: 6 * 60_000 });
  await page.locator('#material-card-fluted_white_oak').click();
  await expect(page.getByText('Drag line to compare')).toBeVisible({ timeout: 3 * 60_000 });

  const badge = page.locator('[title="Low confidence — check and fix the area"]').first();
  test.skip(!(await badge.count()), 'the wall was confident enough that no area check is offered');
  await badge.click();
  const viewport = page.getByTestId('area-editor-viewport');
  await expect(viewport).toBeVisible({ timeout: 60_000 });
  const img = viewport.locator('img');
  const at = async (fx: number, fy: number) => {
    const b = (await img.boundingBox())!;
    return { x: b.x + b.width * fx, y: b.y + b.height * fy };
  };
  const start = await coverage(page);

  // Polygon: add a block over the sofa (not part of the wall)
  await page.getByRole('button', { name: 'Polygon: add' }).click();
  const corners = [await at(0.68, 0.52), await at(0.95, 0.52), await at(0.95, 0.78), await at(0.68, 0.78)];
  for (const c of corners) await page.mouse.click(c.x, c.y);
  await page.mouse.click(corners[0].x, corners[0].y); // click the first corner to close
  const added = await coverage(page);
  expect(added).toBeGreaterThan(start + 3);

  // Undo / redo restore exactly
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await coverage(page)).toBeCloseTo(start, 1);
  await page.getByRole('button', { name: 'Redo' }).click();
  expect(await coverage(page)).toBeCloseTo(added, 1);

  // Cut out the sofa inside the added block
  await page.getByRole('button', { name: 'Cut out object' }).click();
  const sofa = await at(0.82, 0.66);
  await page.mouse.click(sofa.x, sofa.y);
  await expect(page.getByText('Outlining the object…')).toHaveCount(0, { timeout: 60_000 });
  expect(await coverage(page)).toBeLessThan(added - 1);

  await page.getByRole('button', { name: 'Use this area' }).click();
  await expect(viewport).toHaveCount(0);
  expect(errors).toEqual([]);
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test tests/e2e/area-editor.spec.ts`
Expected: `1 passed`. If it reports `skipped` because no area check was offered, open the photo's wall in the hotspot editor manually and check the same steps there, then note the skip in the hand-off.

- [ ] **Step 3: Real-photo check (manual)**

1. In the studio, load the bedroom demo room (`Sanctuary Master Suite`) and render a wood material on the Wall.
2. Open its area check (the "check" badge).
3. With **Cut out object**, click the left lamp, the right lamp, the chandelier and the headboard.
4. Click **Use this area** and look at the render.

Expected: no wood on the lamps, chandelier or headboard.

- [ ] **Step 4: Update `CLAUDE.md`**

In the "Room analysis" bullet, replace `` `components/SurfaceReviewModal.tsx` is the correction step (Include/Exclude clicks re-prompt SAM, plus a brush).`` with:

```
Areas are adjusted in the shared `components/AreaEditor.tsx` (used by `SurfaceReviewModal` in the studio and by `ShowcaseEditorModal` behind "Adjust area"): one-click **Cut out object** / **Add object/area** (worker `cutObject` request, a single SAM object, cut-outs dilated 2 px), polygon add/remove, brush/eraser, 30-step undo/redo, zoom/pan, Fill/Outline/Original views and a material Preview. Every tool edits the mask directly (`services/areaMaskOps.ts`, unit-tested); nothing re-cuts the whole surface.
```

- [ ] **Step 5: Full verification**

Run: `npm run typecheck && npm test && npx playwright test`
Expected: typecheck exit 0; all unit tests pass; `golden.spec.ts`, `studio-flow.spec.ts`, and `area-editor.spec.ts` pass (or it skips with the stated reason).

- [ ] **Step 6: Commit** (only if approved)

```bash
git add tests/e2e/area-editor.spec.ts CLAUDE.md
git commit -m "test: area editor e2e; docs"
```
