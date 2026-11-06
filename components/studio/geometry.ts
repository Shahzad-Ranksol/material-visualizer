import { AlphaMask } from '../../services/areaMaskOps';

// Pure layout maths for the studio (unit-tested): where an item sits in its mask, and where the
// finish popover goes beside it.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The box of a mask's painted pixels (alpha > 127), in mask pixels; null when it is empty. */
export const maskBounds = (mask: AlphaMask): Box | null => {
  const { width: w, height: h, alpha } = mask;
  let x0 = w;
  let y0 = h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (alpha[y * w + x] > 127) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
};

export const unionBounds = (boxes: Box[]): Box | null => {
  if (!boxes.length) return null;
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w));
  const y1 = Math.max(...boxes.map((b) => b.y + b.h));
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
};

export type PopoverSide = 'right' | 'left' | 'bottom' | 'top';

export interface PopoverPlacement {
  left: number;
  top: number;
  side: PopoverSide;
  // Where the notch points at the area, along the card's edge facing it (px from its top or left)
  notch: number;
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/**
 * Where a popover of `size` goes beside `anchor` (both in the container's pixels): to the right
 * of the area if it fits, else to its left, else below or above it — centred on the area and
 * kept inside the container. With no room anywhere it overlaps the area on its roomier side.
 */
export const placePopover = (anchor: Box, container: { w: number; h: number }, size: { w: number; h: number }, gap = 12, margin = 8): PopoverPlacement => {
  const midX = anchor.x + anchor.w / 2;
  const midY = anchor.y + anchor.h / 2;
  const clampLeft = (l: number) => clamp(l, margin, Math.max(margin, container.w - size.w - margin));
  const clampTop = (t: number) => clamp(t, margin, Math.max(margin, container.h - size.h - margin));
  const sideways = (side: 'right' | 'left', left: number): PopoverPlacement => {
    const top = clampTop(midY - size.h / 2);
    return { side, left: clampLeft(left), top, notch: clamp(midY - top, 16, size.h - 16) };
  };
  const vertical = (side: 'bottom' | 'top', top: number): PopoverPlacement => {
    const left = clampLeft(midX - size.w / 2);
    return { side, left, top: clampTop(top), notch: clamp(midX - left, 16, size.w - 16) };
  };

  const right = anchor.x + anchor.w + gap;
  if (right + size.w <= container.w - margin) return sideways('right', right);
  const left = anchor.x - gap - size.w;
  if (left >= margin) return sideways('left', left);
  const below = anchor.y + anchor.h + gap;
  if (below + size.h <= container.h - margin) return vertical('bottom', below);
  const above = anchor.y - gap - size.h;
  if (above >= margin) return vertical('top', above);
  // Nowhere clear: over the area, on the side with more room
  return container.w - (anchor.x + anchor.w) >= anchor.x ? sideways('right', container.w) : sideways('left', 0);
};
