import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

// Node-side pixel access to the committed bake (photos, masks, style patches), for the accuracy
// test (tests/unit/bakedAccuracy.test.ts) and the QA contact sheets (scripts/sceneQa.ts).

// Run from the repo root (npm scripts, vitest)
export const ROOT = process.cwd();
const pub = (url: string) => path.join(ROOT, 'public', url.split('?')[0]);

export interface Rgba {
  width: number;
  height: number;
  data: Uint8Array;
}

export const loadRgba = async (url: string): Promise<Rgba> => {
  const { data, info } = await sharp(fs.readFileSync(pub(url))).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
};

/** A white-on-black mask PNG as 0–1 per pixel, at the photo's size. */
export const loadMask = async (url: string, width: number, height: number): Promise<Float32Array> => {
  const { data, info } = await sharp(fs.readFileSync(pub(url)))
    .resize(width, height, { fit: 'fill' })
    .removeAlpha()
    .greyscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const out = new Float32Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = data[i * info.channels] / 255;
  return out;
};

/** The photo with a style's patch drawn in at its rect (what the studio shows for that style). */
export const composedPhoto = async (photo: string, patch: { patch: string; rect: { x: number; y: number; w: number; h: number } }): Promise<Rgba> => {
  const overlay = await sharp(fs.readFileSync(pub(patch.patch))).resize(patch.rect.w, patch.rect.h, { fit: 'fill' }).png().toBuffer();
  const { data, info } = await sharp(fs.readFileSync(pub(photo)))
    .ensureAlpha()
    .composite([{ input: overlay, left: patch.rect.x, top: patch.rect.y }])
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { width: info.width, height: info.height, data: new Uint8Array(data) };
};

/** Where a baked item paints: the union of its parts × (1 − occluder), as the renderer does. */
export const effectiveMask = async (item: { parts: { mask: string }[]; occluder: string | null }, width: number, height: number): Promise<Float32Array> => {
  const out = new Float32Array(width * height);
  for (const part of item.parts) {
    const m = await loadMask(part.mask, width, height);
    for (let i = 0; i < out.length; i++) out[i] = Math.max(out[i], m[i]);
  }
  if (item.occluder) {
    const o = await loadMask(item.occluder, width, height);
    for (let i = 0; i < out.length; i++) out[i] *= 1 - o[i];
  }
  return out;
};

export const hsv = (r: number, g: number, b: number) => {
  const R = r / 255;
  const G = g / 255;
  const B = b / 255;
  const max = Math.max(R, G, B);
  const min = Math.min(R, G, B);
  const s = max > 0 ? (max - min) / max : 0;
  let h = 0;
  if (max !== min) {
    h = max === R ? ((G - B) / (max - min)) % 6 : max === G ? (B - R) / (max - min) + 2 : (R - G) / (max - min) + 4;
    h = (h * 60 + 360) % 360;
  }
  return { h, s, v: max };
};
