import { describe, expect, it } from 'vitest';
import {
  MAX_ZOOM,
  PanBounds,
  clampPan,
  outlineWidthFor,
  pinchStateOf,
  pinchTransform,
  quantizeOutlineWidth,
  zoomAround,
} from '../../components/areaEditor/viewTransform';
import { segmentRect } from '../../components/areaEditor/maskRects';

// A 1000x600 viewport with an 800x600 photo fitted in the middle
const B: PanBounds = { viewW: 1000, viewH: 600, stageLeft: 100, stageTop: 0, stageW: 800, stageH: 600 };

// On-screen overlap of the image with the viewport, per axis
const visible = (t: { zoom: number; x: number; y: number }, b = B) => {
  const x0 = b.stageLeft + t.x;
  const y0 = b.stageTop + t.y;
  const ox = Math.min(b.viewW, x0 + b.stageW * t.zoom) - Math.max(0, x0);
  const oy = Math.min(b.viewH, y0 + b.stageH * t.zoom) - Math.max(0, y0);
  return { ox, oy };
};

describe('clampPan', () => {
  it('pins zoom 1 to no pan', () => {
    expect(clampPan({ zoom: 1, x: 300, y: -50 }, B)).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it('leaves an in-bounds pan unchanged (same object)', () => {
    const t = { zoom: 2, x: -400, y: -300 };
    expect(clampPan(t, B)).toBe(t);
  });

  it('keeps at least 25% of the viewport covered on each axis when dragged far away', () => {
    for (const [x, y] of [
      [1e5, 1e5],
      [-1e5, -1e5],
      [1e5, -1e5],
      [-1e5, 1e5],
    ]) {
      const t = clampPan({ zoom: 3, x, y }, B);
      const { ox, oy } = visible(t);
      expect(ox).toBeCloseTo(0.25 * B.viewW, 6);
      expect(oy).toBeCloseTo(0.25 * B.viewH, 6);
    }
  });

  it('never demands more coverage than the scaled image has', () => {
    const narrow: PanBounds = { viewW: 1000, viewH: 600, stageLeft: 450, stageTop: 0, stageW: 100, stageH: 600 };
    const t = clampPan({ zoom: 1.5, x: 1e5, y: 0 }, narrow);
    expect(visible(t, narrow).ox).toBeCloseTo(150, 6); // the whole 150px-wide image, not 250
  });

  it('passes the transform through when the stage is not measured yet', () => {
    const t = { zoom: 2, x: 9999, y: 9999 };
    expect(clampPan(t, null)).toBe(t);
    expect(clampPan(t, { ...B, stageW: 0 })).toBe(t);
  });
});

describe('zoomAround', () => {
  it('keeps the point under the cursor fixed while in bounds', () => {
    const t = zoomAround({ zoom: 1, x: 0, y: 0 }, 400, 300, 2, B);
    expect(t).toEqual({ zoom: 2, x: -400, y: -300 });
  });

  it('clamps zoom to 1–8x and resets pan at 1x', () => {
    expect(zoomAround({ zoom: 4, x: -100, y: -100 }, 0, 0, 1e6, B).zoom).toBe(MAX_ZOOM);
    expect(zoomAround({ zoom: 2, x: -100, y: -100 }, 0, 0, 1e-6, B)).toEqual({ zoom: 1, x: 0, y: 0 });
  });

  it('clamps the pan after zooming around a far corner', () => {
    const t = zoomAround({ zoom: 7, x: -5000, y: -3500 }, 0, 0, 0.2, B);
    const { ox, oy } = visible(t);
    expect(ox).toBeGreaterThanOrEqual(0.25 * B.viewW - 1e-6);
    expect(oy).toBeGreaterThanOrEqual(0.25 * B.viewH - 1e-6);
  });
});

describe('pinchTransform', () => {
  const start = { zoom: 1, x: 0, y: 0 };

  it('zooms by the finger spread around the midpoint', () => {
    const from = pinchStateOf({ x: 350, y: 300 }, { x: 450, y: 300 });
    const to = pinchStateOf({ x: 300, y: 300 }, { x: 500, y: 300 });
    const t = pinchTransform(start, from, to, B);
    expect(t.zoom).toBeCloseTo(2, 9);
    // The photo point under the midpoint (400, 300) stays under it
    expect((400 - t.x) / t.zoom).toBeCloseTo(400, 9);
    expect((300 - t.y) / t.zoom).toBeCloseTo(300, 9);
  });

  it('pans with a two-finger drag at constant spread', () => {
    const z = { zoom: 2, x: -400, y: -300 };
    const from = pinchStateOf({ x: 350, y: 300 }, { x: 450, y: 300 });
    const to = pinchStateOf({ x: 380, y: 280 }, { x: 480, y: 280 });
    expect(pinchTransform(z, from, to, B)).toEqual({ zoom: 2, x: -370, y: -320 });
  });

  it('clamps to 1–8x', () => {
    const from = pinchStateOf({ x: 390, y: 300 }, { x: 410, y: 300 });
    const wide = pinchStateOf({ x: 0, y: 300 }, { x: 800, y: 300 });
    expect(pinchTransform(start, from, wide, B).zoom).toBe(MAX_ZOOM);
    expect(pinchTransform({ zoom: 2, x: -10, y: -10 }, wide, from, B)).toEqual({ zoom: 1, x: 0, y: 0 });
  });
});

describe('outline width quantization', () => {
  it('uses whole pixels up to 4', () => {
    expect([0.2, 1, 1.4, 1.6, 2.5, 3.49, 4].map(quantizeOutlineWidth)).toEqual([1, 1, 1, 2, 3, 3, 4]);
  });

  it('snaps wider outlines to half-octave buckets', () => {
    expect([4.4, 5, 6, 7, 9, 12, 16].map(quantizeOutlineWidth)).toEqual([4, 6, 6, 8, 8, 11, 16]);
  });

  it('is monotonic and has few distinct values over a smooth zoom', () => {
    let prev = 0;
    const seen = new Set<number>();
    for (let raw = 0.5; raw <= 40; raw += 0.01) {
      const q = quantizeOutlineWidth(raw);
      expect(q).toBeGreaterThanOrEqual(prev);
      prev = q;
      seen.add(q);
    }
    expect(seen.size).toBeLessThanOrEqual(12);
  });

  it('handles degenerate inputs', () => {
    expect(quantizeOutlineWidth(0)).toBe(1);
    expect(quantizeOutlineWidth(NaN)).toBe(1);
    expect(quantizeOutlineWidth(Infinity)).toBe(1);
    expect(outlineWidthFor(1000, 0)).toBe(2); // unmeasured: as if shown at mask size
  });

  it('gives ~2 screen px and is stable within a bucket across zoom frames', () => {
    // 1000px mask shown 1000px wide: 2 mask px
    expect(outlineWidthFor(1000, 1000)).toBe(2);
    // Smooth zoom from 1x to 8x on a 500px-wide stage: width only changes at bucket edges
    const widths: number[] = [];
    for (let z = 1; z <= 8; z *= 1.01) widths.push(outlineWidthFor(1000, 500 * z));
    const changes = widths.filter((w, i) => i > 0 && w !== widths[i - 1]).length;
    expect(changes).toBeLessThanOrEqual(4);
    expect(widths.length).toBeGreaterThan(100);
  });
});

describe('segmentRect', () => {
  const mask = { width: 100, height: 50, alpha: new Uint8ClampedArray(5000) };

  it('bounds a brush segment and clips to the mask', () => {
    expect(segmentRect(mask, { x: 10, y: 10 }, { x: 20, y: 15 }, 3)).toEqual({ x: 7, y: 7, width: 17, height: 12 });
    expect(segmentRect(mask, { x: 98, y: 48 }, { x: 98, y: 48 }, 5)).toEqual({ x: 93, y: 43, width: 7, height: 7 });
  });

  it('is null entirely outside the mask', () => {
    expect(segmentRect(mask, { x: -50, y: 10 }, { x: -40, y: 10 }, 2)).toBeNull();
  });
});
