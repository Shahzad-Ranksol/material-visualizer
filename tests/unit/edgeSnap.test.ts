import { describe, expect, it } from 'vitest';
import { gradientImage, GrayImage, snapPolygon } from '../../scenes/edgeSnap';

// A bright rectangle (x 20–60, y 30–70) on a dark ground
const rectImage = (w = 100, h = 100): GrayImage => {
  const data = new Float32Array(w * h).fill(0.15);
  for (let y = 30; y < 70; y++) for (let x = 20; x < 60; x++) data[y * w + x] = 0.85;
  return { width: w, height: h, data };
};

describe('snapPolygon', () => {
  it('moves a roughly traced outline onto the real edges', () => {
    const img = rectImage();
    const grad = gradientImage(img);
    const traced = [
      // Each side a few px off and up to ~2.5° askew, as hand tracing on a photo is
      { x: 22.5, y: 27 },
      { x: 58, y: 28.5 },
      { x: 59.5, y: 72 },
      { x: 21, y: 73 },
    ];
    const snapped = snapPolygon(traced, grad, img.width, img.height);
    const expected = [
      // Pixels 20–59 × 30–69 are inside: the edges lie at 20/60 and 30/70 (pixel i spans [i, i+1))
      { x: 20, y: 30 },
      { x: 60, y: 30 },
      { x: 60, y: 70 },
      { x: 20, y: 70 },
    ];
    snapped.forEach((p, i) => {
      expect(Math.abs(p.x - expected[i].x)).toBeLessThanOrEqual(0.5);
      expect(Math.abs(p.y - expected[i].y)).toBeLessThanOrEqual(0.5);
    });
  });

  it('leaves a side alone when there is no edge near it', () => {
    const img = { width: 100, height: 100, data: new Float32Array(100 * 100).fill(0.5) };
    const grad = gradientImage(img);
    const traced = [
      { x: 20, y: 20 },
      { x: 80, y: 20 },
      { x: 80, y: 80 },
      { x: 20, y: 80 },
    ];
    expect(snapPolygon(traced, grad, 100, 100)).toEqual(traced);
  });
});
