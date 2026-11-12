import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { SCENES } from '../scenes/scenes';
import { STYLE_GROUPS, STYLE_OPTIONS, styleKey } from '../scenes/styles';
import { keepByColour, KeepColour, softProtect } from '../scenes/recipeMask';
import { AlphaMask, dilateDisc, emptyMask, fillPolygon, Pt } from '../services/areaMaskOps';
import { gradientImage, snapPolygon } from '../scenes/edgeSnap';
import { BakeRecipe, Outline, PctPoint } from '../scenes/types';
import { composedPhoto, loadRgba, ROOT } from './bakedPixels';

// npm run scenes:refine [-- scene/item …] — re-applies the recipes' pixel rules (the traced
// `outline`, snapped as the bake snaps it, then `keepColour`, `subtract` and `solid` outlines) to
// the masks already baked, keeping their fitted planes, without running a model: after tightening
// an outline or tuning a colour window there is no need for a full re-bake. An item keyed by
// colour is rebuilt from its outline (as the bake builds it); for any other the outline can only
// take pixels away. With no arguments: every item with `keepColour`. Style
// bakes of a group whose option has its own `keepColour` are refined on the composed photo (the
// photo with the style's patch drawn in) over the item's outline grown a few px where the AI drew,
// so parts of the new design just above the old outline are covered. Re-running gives the same masks.

const pub = (url: string) => path.join(ROOT, 'public', url.split('?')[0]);
const toPx = (poly: PctPoint[], w: number, h: number) => poly.map((q) => ({ x: q.xPct * w, y: q.yPct * h }));

const loadAlpha = async (url: string, w: number, h: number): Promise<AlphaMask> => {
  const { data, info } = await sharp(fs.readFileSync(pub(url))).resize(w, h, { fit: 'fill' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const m = emptyMask(w, h);
  for (let i = 0; i < w * h; i++) m.alpha[i] = data[i * info.channels];
  return m;
};

const saveAlpha = async (url: string, m: AlphaMask) => {
  const rgba = Buffer.alloc(m.width * m.height * 4);
  for (let i = 0; i < m.alpha.length; i++) {
    rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = m.alpha[i];
    rgba[i * 4 + 3] = 255;
  }
  await sharp(rgba, { raw: { width: m.width, height: m.height, channels: 4 } }).png().toFile(pub(url));
};

const union = (masks: AlphaMask[]) => {
  const out = emptyMask(masks[0].width, masks[0].height);
  for (const m of masks) for (let i = 0; i < out.alpha.length; i++) out.alpha[i] = Math.max(out.alpha[i], m.alpha[i]);
  return out;
};

/**
 * Splits `area` over the parts: a pixel a part already covers stays with it, any other goes to
 * the nearest part (breadth-first from every part at once, across the whole image, so a piece of
 * the area not touching any part still gets one).
 */
const assignToParts = (parts: AlphaMask[], area: AlphaMask): AlphaMask[] => {
  const { width: w, height: h } = area;
  const label = new Int16Array(w * h).fill(-1);
  let frontier: number[] = [];
  for (let i = 0; i < w * h; i++) {
    if (!area.alpha[i]) continue;
    let best = -1;
    for (let k = 0; k < parts.length; k++) if (parts[k].alpha[i] >= 128 && (best < 0 || parts[k].alpha[i] > parts[best].alpha[i])) best = k;
    if (best >= 0) {
      label[i] = best;
      frontier.push(i);
    }
  }
  while (frontier.length) {
    const next: number[] = [];
    for (const i of frontier) {
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i >= w ? i - w : -1, i + w < w * h ? i + w : -1]) {
        if (j >= 0 && label[j] < 0) {
          label[j] = label[i];
          next.push(j);
        }
      }
    }
    frontier = next;
  }
  return parts.map((_, k) => {
    const m = emptyMask(w, h);
    for (let i = 0; i < w * h; i++) if (label[i] === k) m.alpha[i] = area.alpha[i];
    return m;
  });
};

/** A polygon filled anti-aliased (4×4 supersampled), like the bake's canvas fill. */
const fillAA = (out: AlphaMask, pts: Pt[], mode: 'add' | 'remove') => {
  const { width: w, height: h } = out;
  const S = 4;
  const big = fillPolygon(emptyMask(w * S, h * S), pts.map((q) => ({ x: q.x * S, y: q.y * S })), 'add');
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let c = 0;
      for (let dy = 0; dy < S; dy++) for (let dx = 0; dx < S; dx++) c += big.alpha[(y * S + dy) * w * S + x * S + dx];
      const a = c / (S * S);
      const i = y * w + x;
      out.alpha[i] = mode === 'add' ? Math.max(out.alpha[i], a) : Math.round(out.alpha[i] * (1 - a / 255));
    }
};

/** The item's area under its recipe's pixel rules, from what it covers now (`area`) and may grow into (`zone`). */
const refineArea = (area: AlphaMask, zone: AlphaMask, rgba: ArrayLike<number>, recipe: BakeRecipe, keep: KeepColour | undefined, snap: (o: Outline) => Pt[]): AlphaMask => {
  const { width: w, height: h } = area;
  let out = emptyMask(w, h);
  // A style starts afresh from its zone (its old bake followed the old outline); an item from what it covers
  const grows = zone.alpha.some((a) => a > 0);
  for (let i = 0; i < w * h; i++) out.alpha[i] = grows ? zone.alpha[i] : area.alpha[i];
  const outlines = recipe.outline ?? [];
  const solidOf = (o: Outline) => !Array.isArray(o) && !!o.solid;
  if (outlines.length && !grows) {
    const inside = emptyMask(w, h);
    for (const o of outlines) if (!solidOf(o)) fillAA(inside, snap(o), 'add');
    // Keyed by colour, the item is its outline's pixels of its own colour — as the bake makes it
    // (no cut involved), so a re-run starts afresh. Otherwise the outline only takes pixels away
    for (let i = 0; i < w * h; i++) out.alpha[i] = keep ? inside.alpha[i] : Math.min(out.alpha[i], inside.alpha[i]);
  }
  if (keep) out = keepByColour(out, rgba, keep);
  for (const o of recipe.subtract ?? []) fillAA(out, snap(o), 'remove');
  // Solid outlines (a fence post) are taken whole, as the bake takes them
  for (const o of outlines) if (solidOf(o)) fillAA(out, snap(o), 'add');
  return out;
};

const refineItem = async (
  label: string,
  item: { parts: { mask: string }[] },
  rgba: ArrayLike<number>,
  w: number,
  h: number,
  recipe: BakeRecipe,
  keep: KeepColour | undefined,
  snap: (o: Outline) => Pt[],
  zone?: AlphaMask
) => {
  const parts = await Promise.all(item.parts.map((p) => loadAlpha(p.mask, w, h)));
  const area = union(parts);
  const refined = refineArea(area, zone ?? emptyMask(w, h), rgba, recipe, keep, snap);
  const split = assignToParts(parts, refined);
  const count = (m: AlphaMask) => m.alpha.reduce((s, a) => s + (a >= 128 ? 1 : 0), 0);
  for (let k = 0; k < split.length; k++) await saveAlpha(item.parts[k].mask, split[k]);
  console.log(`${label}: ${count(area)} → ${count(refined)} px`);
};

/** A style patch's alpha, placed at its rect on a photo-sized mask (0 outside the rect). */
const patchAlphaOf = async (bake: { patch: string; rect: { x: number; y: number; w: number; h: number } }, w: number, h: number) => {
  const { x, y, w: rw, h: rh } = bake.rect;
  const { data } = await sharp(fs.readFileSync(pub(bake.patch))).resize(rw, rh, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const out = new Uint8Array(w * h);
  for (let py = 0; py < rh; py++) for (let px = 0; px < rw; px++) if (y + py < h && x + px < w) out[(y + py) * w + x + px] = data[(py * rw + px) * 4 + 3];
  return out;
};

/** Snaps outlines onto the photo's edges exactly as the bake does (unless `snap: false`). */
const snapperFor = (rgba: ArrayLike<number>, w: number, h: number, recipe: BakeRecipe) => {
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) gray[i] = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
  const grad = gradientImage({ width: w, height: h, data: gray });
  return (o: Outline): Pt[] => {
    const spec = Array.isArray(o) ? { points: o } : o;
    const pts = toPx(spec.points, w, h);
    return recipe.snap === false || spec.snap === false ? pts : snapPolygon(pts, grad, w, h);
  };
};

const baked = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes/baked.json'), 'utf8'));
const styleBakes = JSON.parse(fs.readFileSync(path.join(ROOT, 'scenes/styles.baked.json'), 'utf8'));
const wanted = process.argv.slice(2);
const pick = (sceneId: string, itemId: string, recipe: BakeRecipe) => (wanted.length ? wanted.includes(`${sceneId}/${itemId}`) : !!recipe.keepColour);

for (const scene of SCENES) {
  const photo = await loadRgba(scene.photo);
  const { width: w, height: h } = photo;
  for (const item of scene.items) {
    const b = baked[scene.id]?.items[item.id];
    if (b && pick(scene.id, item.id, item.recipe)) {
      await refineItem(`${scene.id}/${item.id}`, b, photo.data, w, h, item.recipe, item.recipe.keepColour, snapperFor(photo.data, w, h, item.recipe));
      // Thin objects in front (protectSoft) join the occluder: a union, so a re-run changes nothing
      if (item.recipe.protectSoft?.length) {
        const url = b.occluder ?? `/scenes/${scene.id}/${item.id}.occluder.png`;
        const occ = b.occluder ? await loadAlpha(b.occluder, w, h) : emptyMask(w, h);
        for (const region of item.recipe.protectSoft) {
          const soft = softProtect(photo.data, w, h, region);
          for (let i = 0; i < w * h; i++) occ.alpha[i] = Math.max(occ.alpha[i], soft.alpha[i]);
        }
        await saveAlpha(url, occ);
        if (!b.occluder) {
          b.occluder = url;
          fs.writeFileSync(path.join(ROOT, 'scenes/baked.json'), JSON.stringify(baked, null, 2) + '\n');
        }
        console.log(`${scene.id}/${item.id}: occluder + ${item.recipe.protectSoft.length} thin object(s)`);
      }
    }
  }
  for (const group of STYLE_GROUPS.filter((g) => g.sceneId === scene.id)) {
    for (const option of STYLE_OPTIONS.filter((o) => o.groupId === group.id)) {
      const bake = styleBakes[scene.id]?.[styleKey(group.id, option.id)];
      if (!bake) continue;
      const composed = await composedPhoto(scene.photo, bake);
      const patchAlpha = await patchAlphaOf(bake, w, h);
      // Each item's own reach: its traced outline (the new design keeps the old one's place),
      // grown 14 px for what rises above it, never into another item of the group
      const reach = new Map<string, AlphaMask>();
      for (const itemId of group.itemIds) {
        const outlines = scene.items.find((i) => i.id === itemId)?.recipe.outline ?? [];
        const m = emptyMask(w, h);
        for (const o of outlines) fillAA(m, toPx(Array.isArray(o) ? o : o.points, w, h), 'add');
        reach.set(itemId, m);
      }
      for (const itemId of group.itemIds) {
        const keep = option.recipeOverrides?.[itemId]?.keepColour;
        const item = scene.items.find((i) => i.id === itemId);
        if (!keep || !item || !bake.items[itemId] || (wanted.length && !wanted.includes(`${scene.id}/${itemId}`))) continue;
        const own = reach.get(itemId)!;
        // The AI could only draw inside its region (the item masks grown 6 px), so the new design
        // reaches at most a few px past the outline: grow 6 px, and keep only where the patch is
        // mostly the AI's (alpha ≥ 50%) — beyond, the shed wall above the old fence is the photo's
        const zone = dilateDisc(own, 6);
        for (let i = 0; i < w * h; i++) if (zone.alpha[i] && own.alpha[i] < 128 && patchAlpha[i] < 128) zone.alpha[i] = 0;
        for (const [other, m] of reach) if (other !== itemId) for (let i = 0; i < w * h; i++) if (m.alpha[i] >= 128) zone.alpha[i] = 0;
        // Only inside the patch: outside it the photo is unchanged and the base rules hold
        const { x, y, w: rw, h: rh } = bake.rect;
        for (let i = 0; i < w * h; i++) {
          const px = i % w;
          const py = (i - px) / w;
          if (px < x || py < y || px >= x + rw || py >= y + rh) zone.alpha[i] = 0;
        }
        const recipe = { ...item.recipe, ...option.recipeOverrides?.[itemId] };
        await refineItem(`${scene.id}/${group.id}--${option.id}/${itemId}`, bake.items[itemId], composed.data, w, h, recipe, keep, snapperFor(composed.data, w, h, recipe), zone);
      }
    }
  }
}
console.log('Done. Review with npm run scenes:qa.');
