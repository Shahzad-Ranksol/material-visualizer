import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { SCENES } from '../scenes/scenes';
import { loadMask, ROOT } from './bakedPixels';

// npm run scenes:seal [-- scene …] — closes the hairline seams between a scene's baked items.
// Each item is traced and baked on its own, so where two meet (a worktop on its cabinets, a
// pilaster beside the tiles) their edges often stop a pixel or two short of each other, and that
// row of the old photo shows between two new finishes as a light or dark line; where both edges
// are soft (anti-aliased) the row is half of each and a quarter of the old photo. Here every pixel
// the items together don't paint fully, with parts of two *different* items within GAP px on
// opposite sides of it, goes to the nearer of them (that part's mask, fully). Holes inside one item (a hob, a handle, a
// downlight) and wider gaps (an architrave between two runs) are left alone. Idempotent. Run
// after scenes:bake / scenes:refine for the scene, then scenes:light.

const GAP = 2;
// Painted fully: the parts composited in turn, 1 − Π(1 − alpha), leave under 5% of the photo (an
// occluder counts as painted)
const FULL = 0.95;
const pub = (url: string) => path.join(ROOT, 'public', url.split('?')[0]);
const baked = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes/baked.json'), 'utf8'));
const wanted = process.argv.slice(2);

for (const scene of SCENES) {
  if (wanted.length ? !wanted.includes(scene.id) : !baked[scene.id]) continue;
  const items = baked[scene.id]?.items ?? {};
  const meta = await sharp(fs.readFileSync(pub(scene.photo))).metadata();
  const [w, h] = [meta.width!, meta.height!];
  // Every part of every item, and which item it is
  const parts: { item: number; url: string; alpha: Float32Array }[] = [];
  const ids = Object.keys(items);
  const covered = new Float32Array(w * h);
  for (const [k, id] of ids.entries()) {
    for (const p of items[id].parts) {
      const alpha = await loadMask(p.mask, w, h);
      parts.push({ item: k, url: p.mask, alpha });
      for (let i = 0; i < alpha.length; i++) covered[i] = 1 - (1 - covered[i]) * (1 - alpha[i]);
    }
    if (items[id].occluder) {
      const o = await loadMask(items[id].occluder, w, h);
      for (let i = 0; i < o.length; i++) covered[i] = Math.max(covered[i], o[i]);
    }
  }
  // Per pixel the part that paints it most (≥ 0.5), else −1
  const owner = new Int16Array(w * h).fill(-1);
  for (let i = 0; i < w * h; i++) {
    let best = 0.5;
    for (let k = 0; k < parts.length; k++) if (parts[k].alpha[i] >= best) [best, owner[i]] = [parts[k].alpha[i], k];
  }
  const changed = new Set<number>();
  let filled = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (covered[i] >= FULL) continue;
      // The nearest painted part in a direction, within GAP px
      const look = (dx: number, dy: number) => {
        for (let d = 1; d <= GAP + 1; d++) {
          const [xx, yy] = [x + dx * d, y + dy * d];
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) return null;
          const j = yy * w + xx;
          if (owner[j] >= 0) return { part: owner[j], d };
          if (covered[j] >= FULL) return null;
        }
        return null;
      };
      let pick: { part: number; d: number } | null = null;
      for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
        const a = look(dx, dy);
        const b = look(-dx, -dy);
        if (!a || !b || parts[a.part].item === parts[b.part].item) continue;
        const near = a.d <= b.d ? a : b;
        if (!pick || near.d < pick.d) pick = near;
      }
      if (!pick) continue;
      // (the other side keeps its soft edge under it: the renderer composites parts in turn)
      parts[pick.part].alpha[i] = 1;
      changed.add(pick.part);
      filled++;
    }
  for (const k of changed) {
    const { url, alpha } = parts[k];
    const rgb = Buffer.alloc(w * h * 3);
    for (let i = 0; i < w * h; i++) rgb.fill(Math.round(alpha[i] * 255), i * 3, i * 3 + 3);
    await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toFile(pub(url));
  }
  console.log(`${scene.id}: sealed ${filled} px in ${changed.size} part(s)`);
}
