import fs from 'node:fs';
import { loadMask, loadRgba } from './bakedPixels';

// npm run scenes:leftovers -- <scene> <item> … — finds the slivers a customer sees when those items
// are painted: every pixel within 3 px of the items that they don't paint (and no object protects),
// whose photo colour is within 18 (RGB) of the painted pixels right beside it — the same surface
// left as it was (a cornice's lip, a side panel's foot, a pilaster's lit edge). Prints the clusters
// (3 px or more) by size and place. Some are honest edges where the next surface happens to match
// (tile beside a pale cabinet, the floor's shadow under a plinth): check each with a profile across
// it, fix the real ones in the recipe, re-bake, and run it again until only those remain.
const baked = JSON.parse(fs.readFileSync('scenes/baked.json', 'utf8'));
const [scene, ...frontIds] = process.argv.slice(2);
const items = baked[scene].items;
const photo = await loadRgba(`/scenes/${scene}/photo.png`);
const { width: w, height: h, data } = photo;
const fronts = new Float32Array(w * h), other = new Float32Array(w * h);
for (const [id, it] of Object.entries<any>(items)) {
  const tgt = frontIds.includes(id) ? fronts : other;
  for (const p of it.parts) { const m = await loadMask(p.mask, w, h); for (let i = 0; i < m.length; i++) tgt[i] = Math.max(tgt[i], m[i]); }
  if (it.occluder) { const o = await loadMask(it.occluder, w, h); for (let i = 0; i < o.length; i++) other[i] = Math.max(other[i], o[i]); }
}
// The fronts' colour in the photo: median over fully painted pixels
const vals = [0, 1, 2].map(() => [] as number[]);
for (let i = 0; i < w * h; i++) if (fronts[i] > 0.99) for (let c = 0; c < 3; c++) vals[c].push(data[i * 4 + c]);
const med = vals.map((v) => (v.sort((a, b) => a - b), v[v.length >> 1]));
const R = 3;
const bad = new Uint8Array(w * h);
const occ = new Float32Array(w * h);
for (const it of Object.values<any>(items)) if (it.occluder) { const o = await loadMask(it.occluder, w, h); for (let i = 0; i < o.length; i++) occ[i] = Math.max(occ[i], o[i]); }
for (let y = R; y < h - R; y++) for (let x = R; x < w - R; x++) {
  const i = y * w + x;
  if (fronts[i] > 0.6 || occ[i] > 0.3) continue;
  // the photo colour of the fully painted front pixels within R px
  let n = 0; const m = [0, 0, 0];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) { const j = (y + dy) * w + x + dx; if (fronts[j] > 0.99) { n++; for (let c = 0; c < 3; c++) m[c] += data[j * 4 + c]; } }
  if (n < 4) continue;
  const d = Math.hypot(data[i * 4] - m[0] / n, data[i * 4 + 1] - m[1] / n, data[i * 4 + 2] - m[2] / n);
  if (d < 18) bad[i] = 1; // looks like the painted surface right beside it
}
const seen = new Uint8Array(w * h); const out: string[] = [];
for (let i = 0; i < w * h; i++) { if (!bad[i] || seen[i]) continue; const st = [i]; seen[i] = 1; let n = 0, x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
  while (st.length) { const j = st.pop()!; n++; const x = j % w, y = (j - x) / w; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    for (const k of [j - 1, j + 1, j - w, j + w]) if (bad[k] && !seen[k]) { seen[k] = 1; st.push(k); } }
  if (n >= 3) out.push(`${String(n).padStart(5)}px  x${x0}-${x1} y${y0}-${y1}`); }
console.log(`fronts' photo colour ${med.join(',')}; ${out.length} clusters`); console.log(out.join('\n'));
