import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { SCENES } from '../scenes/scenes';
import { composedPhoto, effectiveMask, loadRgba, ROOT, Rgba } from './bakedPixels';

// npm run scenes:qa — contact sheets of the committed bake for review: every scene (and every
// design style) with each item's painted area tinted in its own colour over the photo the
// customer sees. Written to test-results/scene-qa/. Look for tint on anything that isn't the
// item (garden through fence gaps, a tree, skirting) and untinted parts of an item.

const OUT = path.join(ROOT, 'test-results/scene-qa');
const TINTS = [[230, 40, 40], [40, 80, 240], [40, 200, 60], [220, 40, 220], [30, 200, 220], [240, 200, 20], [250, 130, 20], [130, 50, 200]];

const sheet = async (name: string, photo: Rgba, items: Array<{ parts: { mask: string }[]; occluder: string | null }>) => {
  const { width: w, height: h } = photo;
  const out = Buffer.from(photo.data);
  for (let k = 0; k < items.length; k++) {
    const m = await effectiveMask(items[k], w, h);
    const [r, g, b] = TINTS[k % TINTS.length];
    for (let i = 0; i < w * h; i++) {
      const a = m[i] * 0.55;
      if (!a) continue;
      out[i * 4] = out[i * 4] * (1 - a) + r * a;
      out[i * 4 + 1] = out[i * 4 + 1] * (1 - a) + g * a;
      out[i * 4 + 2] = out[i * 4 + 2] * (1 - a) + b * a;
    }
  }
  await sharp(out, { raw: { width: w, height: h, channels: 4 } }).png().toFile(path.join(OUT, `${name}.png`));
  console.log(`test-results/scene-qa/${name}.png`);
};

fs.mkdirSync(OUT, { recursive: true });
const baked = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes/baked.json'), 'utf8'));
const styles = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes/styles.baked.json'), 'utf8'));
for (const scene of SCENES) {
  const b = baked[scene.id];
  if (b) await sheet(scene.id, await loadRgba(scene.photo), Object.values(b.items));
  for (const [key, bake] of Object.entries<{ rect: { x: number; y: number; w: number; h: number }; patch: string; items: Record<string, never> }>(styles[scene.id] ?? {}))
    await sheet(`${scene.id}--${key}`, await composedPhoto(scene.photo, bake), Object.values(bake.items));
}
