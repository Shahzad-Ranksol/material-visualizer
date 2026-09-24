import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AlphaMask, emptyMask, fillPolygon } from '../../services/areaMaskOps';
import { alphaMaskToCanvas, applyEditsToParts, canvasToAlphaMask, clearOccluderUnder } from '../../services/maskCanvas';

// Unit tests run in Node with no canvas, so this is a minimal stand-in for the 2D context calls
// maskCanvas makes: straight (non-premultiplied) RGBA, putImageData/getImageData, and drawImage
// with nearest-neighbour scaling and source-over.
class FakeCanvas {
  data: Uint8ClampedArray;
  constructor(public width = 300, public height = 150) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
  getContext() {
    const c = this;
    return {
      createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
      getImageData: (x: number, y: number, w: number, h: number) => {
        c.ensure();
        const data = new Uint8ClampedArray(w * h * 4);
        for (let r = 0; r < h; r++) data.set(c.data.subarray(((y + r) * c.width + x) * 4, ((y + r) * c.width + x + w) * 4), r * w * 4);
        return { width: w, height: h, data };
      },
      putImageData: (img: { width: number; height: number; data: Uint8ClampedArray }, x: number, y: number) => {
        c.ensure();
        for (let r = 0; r < img.height; r++) c.data.set(img.data.subarray(r * img.width * 4, (r + 1) * img.width * 4), ((y + r) * c.width + x) * 4);
      },
      drawImage: (src: FakeCanvas, dx: number, dy: number, dw = src.width, dh = src.height) => {
        c.ensure();
        src.ensure();
        for (let y = 0; y < dh; y++) {
          for (let x = 0; x < dw; x++) {
            const sx = Math.floor(((x + 0.5) * src.width) / dw);
            const sy = Math.floor(((y + 0.5) * src.height) / dh);
            const s = (sy * src.width + sx) * 4;
            const d = ((dy + y) * c.width + dx + x) * 4;
            const sa = src.data[s + 3] / 255;
            const da = c.data[d + 3] / 255;
            const oa = sa + da * (1 - sa);
            for (let k = 0; k < 3; k++) c.data[d + k] = oa ? (src.data[s + k] * sa + c.data[d + k] * da * (1 - sa)) / oa : 0;
            c.data[d + 3] = oa * 255;
          }
        }
      },
    };
  }
  // Canvases are resized by assigning width/height after construction
  ensure() {
    if (this.data.length !== this.width * this.height * 4) this.data = new Uint8ClampedArray(this.width * this.height * 4);
  }
}

beforeAll(() => {
  vi.stubGlobal('document', { createElement: () => new FakeCanvas() });
});
afterAll(() => {
  vi.unstubAllGlobals();
});

const rect = (w: number, h: number, x0: number, y0: number, x1: number, y1: number): AlphaMask =>
  fillPolygon(emptyMask(w, h), [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }], 'add');
const canvas = (m: AlphaMask) => alphaMaskToCanvas(m);
const count = (c: HTMLCanvasElement) => canvasToAlphaMask(c).alpha.reduce((s, v) => s + (v > 127 ? 1 : 0), 0);

describe('applyEditsToParts', () => {
  const W = 40;
  const H = 20;
  const planeA = { homographyFallback: null } as unknown as object;
  const planeB = { plane: 'b' } as unknown as object;

  it('re-derives every part from the edited area, keeping each part’s plane', () => {
    const parts = [
      { mask: canvas(rect(W, H, 0, 0, 20, H)), geometry: planeA },
      { mask: canvas(rect(W, H, 20, 0, W, H)), geometry: planeB },
    ];
    const edited = canvas(rect(W, H, 0, 0, 30, H));
    const out = applyEditsToParts(parts, edited);
    expect(out.map((p) => p.geometry)).toEqual([planeA, planeB]);
    expect(count(out[0].mask)).toBe(20 * H);
    expect(count(out[1].mask)).toBe(10 * H);
  });

  it('drops an emptied part 0 and promotes the next part with its plane', () => {
    const parts = [
      { mask: canvas(rect(W, H, 0, 0, 20, H)), geometry: planeA },
      { mask: canvas(rect(W, H, 20, 0, W, H)), geometry: planeB },
    ];
    const out = applyEditsToParts(parts, canvas(rect(W, H, 20, 0, W, H)));
    expect(out).toHaveLength(1);
    expect(out[0].geometry).toBe(planeB);
    expect(count(out[0].mask)).toBe(20 * H);
  });
});

describe('clearOccluderUnder', () => {
  it('keeps min(occluder, 255 - area), with the area resampled to the occluder’s size', () => {
    const occluder = emptyMask(8, 8);
    occluder.alpha.fill(200);
    // A half-size area covering the left half: (0..1, 0..3) -> (0..3, 0..7) at occluder size
    const area = rect(4, 4, 0, 0, 2, 4);
    const out = canvasToAlphaMask(clearOccluderUnder(canvas(occluder), canvas(area)));
    expect(out.width).toBe(8);
    expect(out.height).toBe(8);
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) expect(out.alpha[y * 8 + x]).toBe(x < 4 ? 0 : 200);
    }
  });

  it('keeps soft coverage as 255 - area where the occluder is stronger', () => {
    const occluder = emptyMask(2, 1);
    occluder.alpha.set([255, 50]);
    const area = emptyMask(2, 1);
    area.alpha.set([100, 100]);
    expect(Array.from(canvasToAlphaMask(clearOccluderUnder(canvas(occluder), canvas(area))).alpha)).toEqual([155, 50]);
  });
});
