import { describe, expect, it } from 'vitest';
import { emptyMask } from '../../services/areaMaskOps';
import { maskBounds, placePopover, unionBounds } from '../../components/studio/geometry';
import { rollerStrokes, strokePolygon, PAINT_MS } from '../../components/studio/paintReveal';

describe('maskBounds', () => {
  it('is the box of the painted pixels, or null for an empty mask', () => {
    const m = emptyMask(20, 10);
    expect(maskBounds(m)).toBeNull();
    for (let y = 2; y < 6; y++) for (let x = 5; x < 12; x++) m.alpha[y * 20 + x] = 255;
    expect(maskBounds(m)).toEqual({ x: 5, y: 2, w: 7, h: 4 });
  });

  it('unions boxes', () => {
    expect(unionBounds([{ x: 0, y: 5, w: 10, h: 10 }, { x: 20, y: 0, w: 5, h: 5 }])).toEqual({ x: 0, y: 0, w: 25, h: 15 });
    expect(unionBounds([])).toBeNull();
  });
});

describe('placePopover', () => {
  const container = { w: 1000, h: 600 };
  const size = { w: 300, h: 400 };

  it('sits right of the area when it fits, vertically centred on it', () => {
    const p = placePopover({ x: 100, y: 200, w: 200, h: 100 }, container, size);
    expect(p.side).toBe('right');
    expect(p.left).toBe(312);
    expect(p.top).toBe(50);
  });

  it('flips left when the right side has no room', () => {
    const p = placePopover({ x: 600, y: 200, w: 300, h: 100 }, container, size);
    expect(p.side).toBe('left');
    expect(p.left + size.w).toBeLessThanOrEqual(600);
  });

  it('goes below or above a full-width area, and always stays inside the container', () => {
    const p = placePopover({ x: 0, y: 0, w: 1000, h: 150 }, { w: 1000, h: 700 }, size);
    expect(p.side).toBe('bottom');
    for (const anchor of [{ x: 0, y: 0, w: 1000, h: 600 }, { x: 950, y: 550, w: 50, h: 50 }, { x: -20, y: -20, w: 30, h: 30 }]) {
      const q = placePopover(anchor, container, size);
      expect(q.left).toBeGreaterThanOrEqual(0);
      expect(q.top).toBeGreaterThanOrEqual(0);
      expect(q.left + size.w).toBeLessThanOrEqual(container.w);
      expect(q.top + size.h).toBeLessThanOrEqual(container.h);
    }
  });

  it('points its notch at the middle of the area, kept on the card', () => {
    const p = placePopover({ x: 100, y: 500, w: 200, h: 80 }, container, size);
    expect(p.side).toBe('right');
    // The area's middle is at y 540; the card is clamped up to the bottom, so the notch is low on it
    expect(p.notch).toBeGreaterThan(size.h / 2);
    expect(p.notch).toBeLessThanOrEqual(size.h - 16);
  });
});

/** Share of the bounds the strokes cover at time t (sampled on a grid, point-in-polygon). */
const coverage = (bounds: { x: number; y: number; w: number; h: number }, t: number) => {
  const strokes = rollerStrokes(bounds);
  const polys = strokes.map((s) => strokePolygon(s, t)).filter((p) => p.length);
  const inside = (px: number, py: number, poly: Array<{ x: number; y: number }>) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i];
      const b = poly[j];
      if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) c = !c;
    }
    return c;
  };
  let hit = 0;
  let n = 0;
  for (let y = bounds.y + 0.5; y < bounds.y + bounds.h; y += 2)
    for (let x = bounds.x + 0.5; x < bounds.x + bounds.w; x += 2) {
      n++;
      if (polys.some((p) => inside(x, y, p))) hit++;
    }
  return hit / n;
};

describe('roller strokes', () => {
  it('roll along the longer side: vertical lanes for a tall area, horizontal for a wide one', () => {
    expect(rollerStrokes({ x: 0, y: 0, w: 100, h: 300 }).every((s) => s.axis === 'y')).toBe(true);
    expect(rollerStrokes({ x: 0, y: 0, w: 300, h: 100 }).every((s) => s.axis === 'x')).toBe(true);
    const n = rollerStrokes({ x: 0, y: 0, w: 400, h: 120 }).length;
    expect(n).toBeGreaterThanOrEqual(3);
    expect(n).toBeLessThanOrEqual(7);
  });

  it('cover nothing at the start, all of the area at the end, and more as time goes on', () => {
    for (const b of [{ x: 10, y: 20, w: 120, h: 300 }, { x: 0, y: 0, w: 500, h: 40 }]) {
      expect(coverage(b, 0)).toBe(0);
      expect(coverage(b, 1)).toBe(1);
      let last = 0;
      for (const t of [0.15, 0.3, 0.45, 0.6, 0.75, 0.9]) {
        const c = coverage(b, t);
        expect(c).toBeGreaterThanOrEqual(last);
        last = c;
      }
      expect(coverage(b, 0.5)).toBeGreaterThan(0.2);
      expect(coverage(b, 0.5)).toBeLessThan(0.95);
    }
  });

  it('are deterministic and take about a second', () => {
    const b = { x: 0, y: 0, w: 200, h: 200 };
    expect(rollerStrokes(b)).toEqual(rollerStrokes(b));
    expect(PAINT_MS).toBeGreaterThanOrEqual(900);
    expect(PAINT_MS).toBeLessThanOrEqual(1500);
  });
});
