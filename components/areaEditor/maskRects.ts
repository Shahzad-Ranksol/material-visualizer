import { AlphaMask, Pt, Rect } from '../../services/areaMaskOps';

/** Writes one rectangle of an alpha mask into its mirror canvas (white, alpha = coverage). */
export const putAlphaRect = (canvas: HTMLCanvasElement, mask: AlphaMask, r: Rect) => {
  const img = new ImageData(r.width, r.height);
  const d = img.data;
  for (let y = 0; y < r.height; y++) {
    const row = (r.y + y) * mask.width + r.x;
    for (let x = 0; x < r.width; x++) {
      const j = (y * r.width + x) * 4;
      d[j] = 255;
      d[j + 1] = 255;
      d[j + 2] = 255;
      d[j + 3] = mask.alpha[row + x];
    }
  }
  canvas.getContext('2d')!.putImageData(img, r.x, r.y);
};

/** The image-space rectangle a brush segment can touch (matches paintStroke's disc stamps). */
export const segmentRect = (mask: AlphaMask, from: Pt, to: Pt, radius: number): Rect | null => {
  const x0 = Math.max(0, Math.floor(Math.min(from.x, to.x) - radius));
  const y0 = Math.max(0, Math.floor(Math.min(from.y, to.y) - radius));
  const x1 = Math.min(mask.width - 1, Math.ceil(Math.max(from.x, to.x) + radius));
  const y1 = Math.min(mask.height - 1, Math.ceil(Math.max(from.y, to.y) + radius));
  return x1 < x0 || y1 < y0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
};
