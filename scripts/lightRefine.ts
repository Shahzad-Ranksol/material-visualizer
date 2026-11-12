import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { SRGB8_TO_LINEAR, linearToSrgb } from '../services/renderer/colorSpace';
import { SCENES } from '../scenes/scenes';
import { applyGain, glossStreaks, LIGHT_REFINE, lightGain } from '../scenes/lightRefine';
import { effectiveMask, loadMask, loadRgba, ROOT } from './bakedPixels';

// npm run scenes:light [-- scene …] — per scene in LIGHT_REFINE (scenes/lightRefine.ts), moves the
// light Marigold left in its items' albedo into the shading: reads the scene's shading.png (as
// scripts/intrinsic/bake.py wrote it), writes shading.lit.png and points scenes/intrinsics.json at
// it; an item with `gloss` likewise gets reflection.lit.png from reflection.png. Always starts from shading.png, so a re-run gives the same result. Re-run after the scene's
// intrinsic bake (which points the index back at shading.png) or its masks change.

const pub = (url: string) => path.join(ROOT, 'public', url.split('?')[0]);
const indexPath = path.join(ROOT, 'scenes/intrinsics.json');
const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const baked = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes/baked.json'), 'utf8'));
const wanted = process.argv.slice(2);

for (const [sceneId, items] of Object.entries(LIGHT_REFINE)) {
  if (wanted.length && !wanted.includes(sceneId)) continue;
  const entry = index[sceneId];
  if (!entry?.shadingScale) throw new Error(`${sceneId}: no baked light, run npm run scenes:intrinsic -- ${sceneId}`);
  const base = `/scenes/${sceneId}/shading.png`;
  const out = `/scenes/${sceneId}/shading.lit.png`;
  const scale: number = entry.shadingScale;
  const scene = SCENES.find((s) => s.id === sceneId);
  if (!scene) throw new Error(`no scene ${sceneId}`);
  const photo = await loadRgba(scene.photo);
  const { width: w, height: h } = photo;
  const read = async (url: string, k: number) => {
    const { data, info } = await sharp(fs.readFileSync(pub(url))).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    if (info.width !== w || info.height !== h) throw new Error(`${url} is ${info.width}×${info.height}, the photo ${w}×${h}`);
    const lin = new Float32Array(w * h * 3);
    for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) lin[i * 3 + c] = SRGB8_TO_LINEAR[data[i * info.channels + c]] / k;
    return lin;
  };
  const shading = await read(base, scale);
  const reflection = await read(`/scenes/${sceneId}/reflection.png`, 1);
  const layers = { width: w, height: h, photo: photo.data, shading, reflection };
  // Every item's gain from the unrefined light, then all applied: items don't feed each other
  const gains: Float32Array[] = [];
  const streaks: Float32Array[] = [];
  for (const [itemId, opts] of Object.entries(items)) {
    const item = baked[sceneId]?.items[itemId];
    if (!item) throw new Error(`${sceneId}/${itemId} is not baked`);
    const mask = await effectiveMask(item, w, h);
    const occluder = item.occluder ? await loadMask(item.occluder, w, h) : null;
    const gain = lightGain(layers, mask, occluder, opts);
    let lo = Infinity;
    let hi = 0;
    for (const g of gain) if (g !== 1) [lo, hi] = [Math.min(lo, g), Math.max(hi, g)];
    if (hi > 0) console.log(`${sceneId}/${itemId}: gain ${lo.toFixed(2)}–${hi.toFixed(2)}`);
    gains.push(gain);
    if (opts.gloss) {
      const extra = glossStreaks(layers, mask, opts.gloss);
      console.log(`${sceneId}/${itemId}: reflection streaks on ${extra.reduce((c, v) => c + (v > 0.005 ? 1 : 0), 0)} px`);
      streaks.push(extra);
    }
  }
  for (const g of gains) applyGain(shading, g);
  const encode = async (lin: Float32Array, k: number, url: string) => {
    const rgb = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h * 3; i++) rgb[i] = Math.round(linearToSrgb(lin[i] * k) * 255);
    await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toFile(pub(url));
  };
  if (streaks.length) {
    for (const e of streaks) for (let i = 0; i < w * h; i++) for (let c = 0; c < 3; c++) reflection[i * 3 + c] += e[i];
    const reflOut = `/scenes/${sceneId}/reflection.lit.png`;
    await encode(reflection, 1, reflOut);
    entry.reflection = reflOut;
  } else entry.reflection = `/scenes/${sceneId}/reflection.png`;
  const rgb = Buffer.alloc(w * h * 3);
  let clipped = 0;
  for (let i = 0; i < w * h * 3; i++) {
    const v = shading[i] * scale;
    if (v > 1) clipped++;
    rgb[i] = Math.round(linearToSrgb(v) * 255);
  }
  await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toFile(pub(out));
  entry.shading = out;
  console.log(`${sceneId}: wrote ${out} (${((clipped / rgb.length) * 100).toFixed(2)}% clipped)`);
}
// (keys stay in the order bake.py sorted them)
fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');
