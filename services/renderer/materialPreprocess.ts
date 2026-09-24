import { Material } from '../../types';

// Max material photo resolution fetched and uploaded to the GPU
const TEXTURE_MAX_PX = 2048;
// Resolution of the photo-lighting estimate that gets divided out
const LIGHTING_GRID_PX = 6;
// A border column/row is trimmed while its average colour is this far (RGB distance) from the
// swatch's centre — strips white/grey studio backgrounds around product photos
const CROP_COLOR_DISTANCE = 55;
// Share of the swatch's edges cross-faded to make seamless materials tile invisibly
const SEAMLESS_BAND = 0.15;

export const loadImage = (src: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`Could not load ${src.slice(0, 80)}`));
    img.src = src;
  });

// Catalogue thumbnails are often requested small (e.g. Unsplash `w=300`) — ask for a
// render-quality version so the surface isn't an upscaled blur
const renderQualityUrl = (url: string): string => {
  if (!/images\.unsplash\.com/.test(url)) return url;
  const u = new URL(url);
  u.searchParams.set('w', String(TEXTURE_MAX_PX));
  u.searchParams.set('q', '85');
  return u.toString();
};

export const canvas2d = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return [c, c.getContext('2d', { willReadFrequently: true })!] as const;
};

/**
 * Crops a product photo down to the material itself. Catalogue shots often show a sheet or
 * tile on a white background; tiled across a wall, those margins become bright stripes.
 */
export const autoCropSwatch = (src: HTMLCanvasElement): HTMLCanvasElement => {
  const { width: w, height: h } = src;
  const data = src.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const mean = (x0: number, x1: number, y0: number, y1: number) => {
    const m = [0, 0, 0];
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * w + x) * 4;
        m[0] += data[i];
        m[1] += data[i + 1];
        m[2] += data[i + 2];
        n++;
      }
    }
    return m.map((v) => v / Math.max(1, n));
  };
  const centre = mean(Math.floor(w * 0.3), Math.ceil(w * 0.7), Math.floor(h * 0.3), Math.ceil(h * 0.7));
  const far = (c: number[]) => Math.hypot(c[0] - centre[0], c[1] - centre[1], c[2] - centre[2]) > CROP_COLOR_DISTANCE;
  const midY0 = Math.floor(h * 0.25);
  const midY1 = Math.ceil(h * 0.75);
  const midX0 = Math.floor(w * 0.25);
  const midX1 = Math.ceil(w * 0.75);
  let left = 0;
  while (left < w * 0.4 && far(mean(left, left + 1, midY0, midY1))) left++;
  let right = w;
  while (right > w * 0.6 && far(mean(right - 1, right, midY0, midY1))) right--;
  let top = 0;
  while (top < h * 0.4 && far(mean(midX0, midX1, top, top + 1))) top++;
  let bottom = h;
  while (bottom > h * 0.6 && far(mean(midX0, midX1, bottom - 1, bottom))) bottom--;
  if (left === 0 && top === 0 && right === w && bottom === h) return src;
  // Inset a little further so no soft edge of the background survives
  const inset = Math.round(Math.min(w, h) * 0.01);
  const cw = right - left - inset * 2;
  const ch = bottom - top - inset * 2;
  if (cw < w * 0.2 || ch < h * 0.2) return src;
  const [c, ctx] = canvas2d(cw, ch);
  ctx.drawImage(src, left + inset, top + inset, cw, ch, 0, 0, cw, ch);
  return c;
};

/**
 * Removes the photo's own broad lighting (vignettes, hot spots, falloff) by dividing out its
 * low-frequency luminance — the grain and colour stay, the studio lighting goes.
 */
export const removeLightingGradient = (src: HTMLCanvasElement): HTMLCanvasElement => {
  const [c, ctx] = canvas2d(src.width, src.height);
  ctx.drawImage(src, 0, 0);
  const [tiny, tinyCtx] = canvas2d(LIGHTING_GRID_PX, LIGHTING_GRID_PX);
  tinyCtx.imageSmoothingQuality = 'high';
  tinyCtx.drawImage(c, 0, 0, tiny.width, tiny.height);
  const [, lowCtx] = canvas2d(c.width, c.height);
  lowCtx.imageSmoothingEnabled = true;
  lowCtx.imageSmoothingQuality = 'high';
  lowCtx.drawImage(tiny, 0, 0, c.width, c.height);
  const low = lowCtx.getImageData(0, 0, c.width, c.height).data;

  const pixels = ctx.getImageData(0, 0, c.width, c.height);
  const px = pixels.data;
  let meanLum = 0;
  for (let i = 0; i < low.length; i += 4) meanLum += 0.299 * low[i] + 0.587 * low[i + 1] + 0.114 * low[i + 2];
  meanLum /= low.length / 4;
  for (let i = 0; i < px.length; i += 4) {
    const lowLum = 0.299 * low[i] + 0.587 * low[i + 1] + 0.114 * low[i + 2];
    const gain = Math.min(2.5, Math.max(0.4, meanLum / Math.max(1, lowLum)));
    px[i] = Math.min(255, px[i] * gain);
    px[i + 1] = Math.min(255, px[i + 1] * gain);
    px[i + 2] = Math.min(255, px[i + 2] * gain);
  }
  ctx.putImageData(pixels, 0, 0);
  return c;
};

/**
 * Makes a texture tile seamlessly: near its edges it cross-fades into a copy of itself shifted
 * by half a tile, whose content is continuous across the wrap (no mirrored "butterflies").
 */
export const makeSeamless = (tex: HTMLCanvasElement): HTMLCanvasElement => {
  const { width: w, height: h } = tex;
  const src = tex.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, w, h).data;
  const [c, ctx] = canvas2d(w, h);
  const out = ctx.createImageData(w, h);
  const bandX = Math.max(1, w * SEAMLESS_BAND);
  const bandY = Math.max(1, h * SEAMLESS_BAND);
  const smooth = (t: number) => t * t * (3 - 2 * t);
  for (let y = 0; y < h; y++) {
    const ty = smooth(Math.min(1, Math.min(y, h - 1 - y) / bandY));
    const sy = (y + (h >> 1)) % h;
    for (let x = 0; x < w; x++) {
      const t = smooth(Math.min(1, Math.min(x, w - 1 - x) / bandX)) * ty;
      const sx = (x + (w >> 1)) % w;
      const i = (y * w + x) * 4;
      const j = (sy * w + sx) * 4;
      out.data[i] = src[i] * t + src[j] * (1 - t);
      out.data[i + 1] = src[i + 1] * t + src[j + 1] * (1 - t);
      out.data[i + 2] = src[i + 2] * t + src[j + 2] * (1 - t);
      out.data[i + 3] = 255;
    }
  }
  ctx.putImageData(out, 0, 0);
  return c;
};

/** Rotates a texture by a multiple of 90° (grain direction). */
export const orient = (src: HTMLCanvasElement, deg: 0 | 90 | 180 | 270): HTMLCanvasElement => {
  if (deg === 0) return src;
  const swap = deg === 90 || deg === 270;
  const [c, ctx] = canvas2d(swap ? src.height : src.width, swap ? src.width : src.height);
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((deg * Math.PI) / 180);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return c;
};

export interface PreparedAlbedo {
  canvas: HTMLCanvasElement;
  // Optional tangent-space normal map (OpenGL convention) and roughness map, oriented like canvas
  normal: HTMLCanvasElement | null;
  roughness: HTMLCanvasElement | null;
  // Real size one copy of `canvas` covers on the surface
  tileWidthMm: number;
  tileHeightMm: number;
}

const cache = new Map<string, Promise<PreparedAlbedo>>();

const toCanvas = (img: HTMLImageElement): HTMLCanvasElement => {
  const scale = Math.min(1, TEXTURE_MAX_PX / Math.max(img.naturalWidth, img.naturalHeight));
  const [c, ctx] = canvas2d(img.naturalWidth * scale, img.naturalHeight * scale);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
};

/**
 * Turns a material's photo into a production albedo: background cropped, studio lighting
 * removed, made seamless when it repeats continuously, rotated to its grain direction, and
 * sized from the vendor's real dimensions (height from the photo's aspect when unset).
 */
export const prepareAlbedo = (material: Material): Promise<PreparedAlbedo> => {
  const source = material.albedoUrl || material.thumbnail;
  const key = [material.id, source, material.normalUrl, material.roughnessUrl, material.repeatMode, material.orientationDeg, material.realWidthMm, material.realHeightMm].join('|');
  let entry = cache.get(key);
  if (!entry) {
    entry = (async () => {
      const img = await loadImage(renderQualityUrl(source)).catch(() => loadImage(source));
      const raw = toCanvas(img);
      // A production albedo (albedoUrl) is already clean, evenly lit and tileable; only a
      // product photo (thumbnail only) needs its background, studio light and seams fixed
      const isProductPhoto = !material.albedoUrl;
      let tex = isProductPhoto ? removeLightingGradient(autoCropSwatch(raw)) : raw;
      // Sizes are given for the photo as uploaded; rotating swaps them
      const photoHeightMm = material.realHeightMm ?? material.realWidthMm * (tex.height / tex.width);
      if (isProductPhoto && material.repeatMode === 'seamless') tex = makeSeamless(tex);
      tex = orient(tex, material.orientationDeg);
      const [normal, roughness] = await Promise.all(
        [material.normalUrl, material.roughnessUrl].map(async (url) =>
          url ? orient(toCanvas(await loadImage(url)), material.orientationDeg) : null
        )
      );
      const swap = material.orientationDeg === 90 || material.orientationDeg === 270;
      return {
        canvas: tex,
        normal,
        roughness,
        tileWidthMm: swap ? photoHeightMm : material.realWidthMm,
        tileHeightMm: swap ? material.realWidthMm : photoHeightMm,
      };
    })();
    entry.catch(() => cache.delete(key));
    cache.set(key, entry);
  }
  return entry;
};
