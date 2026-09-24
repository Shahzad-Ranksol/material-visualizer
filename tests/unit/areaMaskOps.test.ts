import { describe, expect, it } from 'vitest';
import {
  AlphaMask,
  cloneMask,
  combine,
  clearOccluderAlpha,
  coveragePct,
  createMaskHistory,
  diffRect,
  emptyMask,
  MIN_PART_PIXELS,
  MIN_RENDER_PIXELS,
  fillPolygon,
  isUsableObjectMask,
  maskOutline,
  paintStroke,
  splitEditsIntoParts,
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

  it('subtracts a soft mask without dilation: fully at >= 50%, scaled by its alpha below', () => {
    const area = emptyMask(5, 1);
    area.alpha.set([255, 255, 255, 200, 255]);
    const object = emptyMask(5, 1);
    object.alpha.set([255, 128, 127, 51, 0]);
    const out = combine(area, object, 'subtract', 0);
    // 128 removes fully (the old min(a, 255 - o) left 127); below that the area is scaled down
    expect(Array.from(out.alpha)).toEqual([0, 0, Math.round((255 * 128) / 255), Math.round((200 * 204) / 255), 255]);
    expect(Array.from(area.alpha)).toEqual([255, 255, 255, 200, 255]); // input untouched
  });

  it('removes a soft-edged object the same way with or without dilation, inside the object', () => {
    const full = square(20, 20, 0, 0, 20, 20);
    const object = square(20, 20, 5, 5, 10, 10);
    for (let i = 0; i < object.alpha.length; i++) if (object.alpha[i]) object.alpha[i] = 180; // soft but >= 50%
    const plain = combine(full, object, 'subtract', 0);
    const dilated = combine(full, object, 'subtract', 2);
    for (let y = 5; y < 10; y++) for (let x = 5; x < 10; x++) expect([at(plain, x, y), at(dilated, x, y)]).toEqual([0, 0]);
    expect(at(plain, 3, 7)).toBe(255); // no dilation: nothing outside the object is touched
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

describe('diffRect', () => {
  it('bounds exactly the changed pixels, or returns null', () => {
    const a = emptyMask(40, 30);
    expect(diffRect(a, cloneMask(a))).toBeNull();
    const b = cloneMask(a);
    b.alpha[5 * 40 + 7] = 9;
    b.alpha[20 * 40 + 31] = 200;
    b.alpha[12 * 40 + 3] = 1;
    expect(diffRect(a, b)).toEqual({ x: 3, y: 5, width: 29, height: 16 });
  });

  it('matches a brute-force scan at any width (word-wise compare crossing rows)', () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    for (const w of [1, 3, 5, 7, 13]) {
      for (let trial = 0; trial < 20; trial++) {
        const h = 9;
        const a = emptyMask(w, h);
        const b = cloneMask(a);
        const changes = Math.floor(rand() * 4);
        for (let c = 0; c < changes; c++) b.alpha[Math.floor(rand() * w * h)] = 1 + Math.floor(rand() * 254);
        let x0 = w, x1 = -1, y0 = -1, y1 = -1;
        for (let i = 0; i < w * h; i++) {
          if (a.alpha[i] === b.alpha[i]) continue;
          const x = i % w, y = Math.floor(i / w);
          if (y0 < 0) y0 = y;
          y1 = y;
          x0 = Math.min(x0, x);
          x1 = Math.max(x1, x);
        }
        expect(diffRect(a, b)).toEqual(y0 < 0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 });
      }
    }
  });
});

describe('createMaskHistory', () => {
  // A 1-pixel mask whose value identifies the state
  const val = (v: number) => {
    const m = emptyMask(1, 1);
    m.alpha[0] = v;
    return m;
  };
  const v = (m: AlphaMask | null) => (m ? m.alpha[0] : null);

  it('undoes and redoes in order, and a new edit clears redo', () => {
    const h = createMaskHistory(val(0), 30);
    h.push(val(1));
    h.push(val(2));
    expect(v(h.undo())).toBe(1);
    expect(v(h.undo())).toBe(0);
    expect(h.undo()).toBeNull();
    expect(v(h.redo())).toBe(1);
    h.push(val(5));
    expect(h.canRedo()).toBe(false);
    expect(v(h.current())).toBe(5);
  });

  it('keeps at most the limit of undo steps', () => {
    const h = createMaskHistory(val(0), 30);
    for (let i = 1; i <= 35; i++) h.push(val(i));
    let undone = 0;
    while (h.undo() !== null) undone++;
    expect(undone).toBe(30);
    expect(v(h.current())).toBe(5);
  });

  it('counts an edit that changed nothing as a step, like any other', () => {
    const h = createMaskHistory(val(3), 30);
    h.push(val(3));
    expect(h.canUndo()).toBe(true);
    expect(v(h.undo())).toBe(3);
    expect(h.canUndo()).toBe(false);
    expect(v(h.redo())).toBe(3);
  });

  it('restores whole masks exactly, without mutating any pushed state', () => {
    const s0 = square(50, 40, 0, 0, 50, 20);
    const s1 = fillPolygon(s0, [{ x: 10, y: 25 }, { x: 20, y: 25 }, { x: 20, y: 35 }, { x: 10, y: 35 }], 'add');
    const s2 = square(50, 40, 30, 5, 45, 38);
    const snap = [s0, s1, s2].map((m) => m.alpha.slice());
    const h = createMaskHistory(s0, 30);
    h.push(s1);
    h.push(s2);
    expect(h.undo()!.alpha).toEqual(snap[1]);
    expect(h.undo()!.alpha).toEqual(snap[0]);
    expect(h.redo()!.alpha).toEqual(snap[1]);
    expect(h.redo()!.alpha).toEqual(snap[2]);
    [s0, s1, s2].forEach((m, k) => expect(m.alpha).toEqual(snap[k]));
    expect(h.undo()).not.toBe(s1); // a fresh mask
  });

  it('uses a precomputed changed rectangle when given one, instead of diffing again', () => {
    const s0 = square(50, 40, 0, 0, 50, 20);
    const s1 = fillPolygon(s0, [{ x: 10, y: 25 }, { x: 20, y: 25 }, { x: 20, y: 35 }, { x: 10, y: 35 }], 'add');
    const rect = diffRect(s0, s1);
    expect(rect).toEqual({ x: 10, y: 25, width: 10, height: 10 });
    const h = createMaskHistory(s0, 30);
    h.push(s1, rect);
    expect(h.retainedBytes()).toBe(2 * 10 * 10); // exactly the rectangle it was handed
    expect(h.undo()!.alpha).toEqual(s0.alpha);
    expect(h.redo()!.alpha).toEqual(s1.alpha);
    // A null rect means "nothing changed": still a step, restoring the same state
    h.push(s1, null);
    expect(h.canUndo()).toBe(true);
    expect(h.undo()!.alpha).toEqual(s1.alpha);
  });

  it('stores only the changed rectangle, so memory scales with the edit, not the photo', () => {
    const w = 1000;
    const hgt = 800;
    const h = createMaskHistory(emptyMask(w, hgt), 30);
    let m = emptyMask(w, hgt);
    for (let i = 0; i < 30; i++) {
      m = cloneMask(m);
      paintStroke(m, { x: 100 + i * 20, y: 400 }, { x: 110 + i * 20, y: 400 }, 5, 'add');
      h.push(m);
    }
    // Each step is ~21x11 px before + after, versus 800 KB per full snapshot
    expect(h.retainedBytes()).toBeLessThan(30 * 2 * 25 * 15);
    for (let i = 0; i < 30; i++) h.undo();
    expect(coveragePct(h.current())).toBe(0);
    expect(h.retainedBytes()).toBeLessThan(30 * 2 * 25 * 15); // redo steps, same size
  });
});

describe('splitEditsIntoParts', () => {
  const W = 40;
  const H = 20;
  // Two planes meeting at x = 20 (a corner)
  const left = () => square(W, H, 0, 0, 20, H);
  const right = () => square(W, H, 20, 0, W, H);

  it('keeps each part to what is still in the edited area', () => {
    const edited = fillPolygon(combine(left(), right(), 'add', 0), [{ x: 15, y: 0 }, { x: 25, y: 0 }, { x: 25, y: H }, { x: 15, y: H }], 'remove');
    const out = splitEditsIntoParts([left(), right()], edited);
    expect(out.map((p) => p.index)).toEqual([0, 1]);
    expect(count(out[0].mask)).toBe(15 * H);
    expect(count(out[1].mask)).toBe(15 * H);
    expect(at(out[1].mask, 17, 5)).toBe(0);
  });

  it('gives an addition next to part 1 to part 1 (the far side of the corner)', () => {
    const l = square(W, H, 0, 0, 10, H);
    const r = square(W, H, 30, 0, W, H);
    const edited = combine(combine(l, r, 'add', 0), square(W, H, 25, 0, 30, H), 'add', 0); // touches part 1
    const out = splitEditsIntoParts([l, r], edited);
    expect(out.map((p) => p.index)).toEqual([0, 1]);
    expect(count(out[0].mask)).toBe(10 * H); // part 0 unchanged
    expect(count(out[1].mask)).toBe(15 * H);
    expect(at(out[1].mask, 26, 5)).toBe(255);
    expect(at(out[0].mask, 26, 5)).toBe(0);
  });

  it('keeps an addition next to part 0 in part 0', () => {
    const l = square(W, H, 0, 0, 10, H);
    const r = square(W, H, 30, 0, W, H);
    const edited = combine(combine(l, r, 'add', 0), square(W, H, 10, 0, 15, H), 'add', 0); // touches part 0
    const out = splitEditsIntoParts([l, r], edited);
    expect(out.map((p) => p.index)).toEqual([0, 1]);
    expect(count(out[0].mask)).toBe(15 * H);
    expect(at(out[0].mask, 12, 5)).toBe(255);
    expect(count(out[1].mask)).toBe(10 * H); // part 1 unchanged
  });

  it('splits an addition across the gap between two parts by distance', () => {
    const l = square(W, H, 0, 0, 10, H);
    const r = square(W, H, 30, 0, W, H);
    const edited = combine(combine(l, r, 'add', 0), square(W, H, 12, 0, 28, H), 'add', 0); // 12..27
    const out = splitEditsIntoParts([l, r], edited);
    // Columns 12..19 are nearer part 0 (last column 9), 20..27 nearer part 1 (first column 30)
    expect(at(out[0].mask, 19, 5)).toBe(255);
    expect(at(out[1].mask, 20, 5)).toBe(255);
    expect(count(out[0].mask)).toBe(18 * H);
    expect(count(out[1].mask)).toBe(18 * H);
  });

  it('with no part alive on its nearest share, gives every added pixel to the first part it keeps alive', () => {
    const l = square(W, H, 0, 0, 10, H);
    const r = square(W, H, 30, 0, W, H);
    // Both parts erased; 3 + 3 columns added, each side below the minimum on its own
    const add = combine(square(W, H, 10, 0, 13, H), square(W, H, 27, 0, 30, H), 'add', 0);
    expect(3 * H).toBeLessThan(MIN_PART_PIXELS);
    expect(6 * H).toBeGreaterThanOrEqual(MIN_PART_PIXELS);
    const out = splitEditsIntoParts([l, r], add);
    expect(out.map((p) => p.index)).toEqual([0]);
    expect(count(out[0].mask)).toBe(6 * H);
  });

  it('keeps the single-part fast path: everything added goes to the one part', () => {
    const p = square(W, H, 0, 0, 10, H);
    const edited = combine(p, square(W, H, 30, 0, 35, H), 'add', 0);
    const out = splitEditsIntoParts([p], edited);
    expect(out.map((q) => q.index)).toEqual([0]);
    expect(count(out[0].mask)).toBe(15 * H);
  });

  it('drops a part the edit emptied, so the renderer never gets an empty layer', () => {
    const out = splitEditsIntoParts([left(), right()], left());
    expect(out.map((p) => p.index)).toEqual([0]);
    expect(count(out[0].mask)).toBe(20 * H);
  });

  it('drops a part left below the minimum, even if not quite empty', () => {
    const edited = combine(left(), square(W, H, 20, 0, 22, 3), 'add', 0); // 6 px of the right plane
    expect(6).toBeLessThan(MIN_PART_PIXELS);
    expect(MIN_PART_PIXELS).toBeGreaterThanOrEqual(MIN_RENDER_PIXELS);
    expect(splitEditsIntoParts([left(), right()], edited).map((p) => p.index)).toEqual([0]);
  });

  it('promotes the next part when part 0 is emptied, and it takes the added pixels', () => {
    const l = square(W, H, 0, 0, 10, H);
    const r = square(W, H, 20, 0, W, H);
    const edited = combine(r, square(W, H, 12, 0, 15, 2), 'add', 0); // part 0 erased; 6 new px
    const out = splitEditsIntoParts([l, r], edited);
    expect(out.map((p) => p.index)).toEqual([1]);
    expect(count(out[0].mask)).toBe(20 * H + 6);
  });

  it('keeps part 0 when the pixels added to it bring it over the minimum', () => {
    const l = square(W, H, 0, 0, 10, H);
    const r = square(W, H, 20, 0, W, H);
    const edited = combine(r, square(W, H, 10, 0, 15, H), 'add', 0); // part 0 erased; 100 new px
    const out = splitEditsIntoParts([l, r], edited);
    expect(out.map((p) => p.index)).toEqual([0, 1]);
    expect(count(out[0].mask)).toBe(5 * H);
  });

  it('returns no parts when nothing usable is left', () => {
    expect(splitEditsIntoParts([left(), right()], square(W, H, 0, 0, 2, 2))).toEqual([]);
  });

  it('keeps soft (partial) coverage as the minimum of part and edit', () => {
    const p = left();
    const edited = cloneMask(p);
    for (let i = 0; i < edited.alpha.length; i++) if (edited.alpha[i]) edited.alpha[i] = 200;
    const out = splitEditsIntoParts([p], edited);
    expect(at(out[0].mask, 3, 3)).toBe(200);
  });
});

describe('clearOccluderAlpha', () => {
  it('is min(occluder, 255 - area) per pixel', () => {
    const o = emptyMask(3, 1);
    const a = emptyMask(3, 1);
    o.alpha.set([255, 200, 90]);
    a.alpha.set([0, 100, 255]);
    expect(Array.from(clearOccluderAlpha(o, a).alpha)).toEqual([255, 155, 0]);
    expect(Array.from(o.alpha)).toEqual([255, 200, 90]);
  });

  it('refuses masks of different sizes (the canvas wrapper resamples first)', () => {
    expect(() => clearOccluderAlpha(emptyMask(4, 4), emptyMask(2, 2))).toThrow();
  });
});

