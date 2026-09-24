import { AlphaMask, clearOccluderAlpha, splitEditsIntoParts } from './areaMaskOps';

// Mask canvases on the main thread. The editor works on alpha masks (white, alpha = coverage);
// saved masks are white-on-black PNGs (what the renderer and storage use).

const canvasOf = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

const alphaOf = (mask: HTMLCanvasElement) => mask.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, mask.width, mask.height);

/** Flattens an alpha mask onto black and encodes it as the PNG stored for a surface. */
export const alphaMaskToPngBlob = (mask: HTMLCanvasElement): Promise<Blob> => {
  const canvas = canvasOf(mask.width, mask.height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(mask, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode mask'))), 'image/png')
  );
};

/** Loads a saved white-on-black mask back into an editable alpha mask. */
export const loadMaskAsAlpha = (url: string): Promise<HTMLCanvasElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = canvasOf(img.naturalWidth, img.naturalHeight);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < pixels.data.length; i += 4) {
        pixels.data[i + 3] = pixels.data[i];
        pixels.data[i] = 255;
        pixels.data[i + 1] = 255;
        pixels.data[i + 2] = 255;
      }
      ctx.putImageData(pixels, 0, 0);
      resolve(canvas);
    };
    img.onerror = () => reject(new Error('Could not load the saved area'));
    img.src = url;
  });

/** One alpha mask covering all the given ones (max alpha). */
export const unionMasks = (masks: HTMLCanvasElement[]): HTMLCanvasElement => {
  const out = canvasOf(masks[0].width, masks[0].height);
  const ctx = out.getContext('2d')!;
  for (const m of masks) ctx.drawImage(m, 0, 0);
  return out;
};

/**
 * Re-derives each part after the combined area was edited (see `splitEditsIntoParts`): a part
 * keeps only what is still in the edited area, newly added pixels go to the part whose original
 * mask is nearest (so an addition on the far side of a corner joins that plane), and a part the
 * edit emptied (below `MIN_PART_PIXELS`) is dropped along with its plane — so the first surviving
 * part becomes part 0. Returns the surviving parts, in order, with new mask canvases.
 */
export const applyEditsToParts = <P extends { mask: HTMLCanvasElement }>(parts: P[], edited: HTMLCanvasElement): P[] => {
  const e = canvasToAlphaMask(edited);
  const kept = splitEditsIntoParts(
    parts.map((p) => canvasToAlphaMask(scaleMaskCanvas(p.mask, e.width, e.height))),
    e
  );
  return kept.map(({ index, mask }) => ({ ...parts[index], mask: alphaMaskToCanvas(mask) }));
};

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

/** The occluder with the edited area removed: anything the user added is surface, not an object in front. */
export const clearOccluderUnder = (occluder: HTMLCanvasElement, area: HTMLCanvasElement): HTMLCanvasElement =>
  alphaMaskToCanvas(clearOccluderAlpha(canvasToAlphaMask(occluder), canvasToAlphaMask(scaleMaskCanvas(area, occluder.width, occluder.height))));
