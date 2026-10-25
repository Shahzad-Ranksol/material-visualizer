import { SurfaceGeometry, SurfaceKind } from '../types';
import { cutObject, cutSurface, JobOptions } from '../services/roomAnalysis';
import { alphaMaskToCanvas, alphaMaskToPngBlob, applyEditsToParts, canvasToAlphaMask, clearOccluderUnder, unionMasks } from '../services/maskCanvas';
import { clearOccluderAlpha, dilateDisc } from '../services/areaMaskOps';
import { autoFitPlane, planeKindFor } from '../services/planeGeometry';
import { applyRecipeClip, colourMask, keepInside, partitionParts, polygonItemMask } from './recipeMask';
import { gradientImage, snapPolygon } from './edgeSnap';
import { BakeRecipe, Outline, PctPoint, Scene, SceneItem } from './types';

// Dev only (/dev/scenes): runs an item's bake recipe through the same worker pipeline the
// studio used to run per photo, and serialises the result for the dev server to write.

export interface BakeArea {
  kind: SurfaceKind;
  parts: Array<{ mask: HTMLCanvasElement; geometry: SurfaceGeometry | null }>;
  occluder: HTMLCanvasElement | null;
  confidence: number;
}

// Recipes store points as fractions of the photo; the analysis worker takes percentages
const workerPoint = (q: PctPoint) => ({ xPct: q.xPct * 100, yPct: q.yPct * 100 });

const loadPhoto = async (url: string) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
};

const photoSize = async (url: string) => {
  const img = await loadPhoto(url);
  return { w: img.naturalWidth, h: img.naturalHeight };
};

const fallbackGeometry = (mask: HTMLCanvasElement, label: string): SurfaceGeometry | null => {
  const plane = autoFitPlane(mask, planeKindFor(label));
  return plane ? { homographyFallback: plane } : null;
};

/**
 * One SAM cut per anchor. Each later cut keeps only what the earlier ones don't cover, so the
 * merged parts never overlap (a pixel belongs to one plane); `cuts` are the cuts as SAM gave
 * them, whose union has no gaps where they met.
 */
const cutPlanes = async (scene: Scene, recipe: BakeRecipe, options: JobOptions) => {
  const parts: BakeArea['parts'] = [];
  const occluders: HTMLCanvasElement[] = [];
  const cuts: HTMLCanvasElement[] = [];
  let confidence = 0;
  const failures: string[] = [];
  for (const anchor of recipe.anchors) {
    let cut;
    try {
      cut = await cutSurface(scene.photo, workerPoint(anchor), {
        label: recipe.label,
        exclude: recipe.exclude?.map(workerPoint),
        connectedOnly: true,
        ...options,
      });
    } catch (err) {
      // One anchor off the class map shouldn't sink the item; report it if every anchor fails
      if (options.signal?.aborted) throw err;
      failures.push(`(${anchor.xPct}, ${anchor.yPct}): ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }
    const covered = parts.length ? canvasToAlphaMask(unionMasks(parts.map((p) => p.mask))) : null;
    for (const p of cut.parts) parts.push(covered ? { ...p, mask: alphaMaskToCanvas(clearOccluderAlpha(canvasToAlphaMask(p.mask), covered)) } : p);
    occluders.push(cut.occluder);
    cuts.push(...cut.parts.map((p) => p.mask));
    confidence += cut.confidence / recipe.anchors.length;
  }
  return { parts, cuts, occluders, confidence, failures };
};

const pathOf = (ctx: CanvasRenderingContext2D, points: Array<{ x: number; y: number }>) => {
  ctx.beginPath();
  points.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
  ctx.closePath();
};

const toPx = (poly: PctPoint[], w: number, h: number) => poly.map((q) => ({ x: q.xPct * w, y: q.yPct * h }));

/**
 * An item traced as outlines: each outline's sides snapped onto the photo's real edges and
 * filled anti-aliased, less any `subtract` polygons. The SAM cuts from `anchors` only supply the
 * 3D planes (perspective); objects standing in front are the SAM objects at the `protect`
 * clicks. Exact where fitted furniture is — straight-edged — and the cut alone is wobbly.
 */
const bakeOutline = async (scene: Scene, item: SceneItem, options: JobOptions): Promise<BakeArea> => {
  const { recipe } = item;
  const photo = await loadPhoto(scene.photo);
  const w = photo.naturalWidth;
  const h = photo.naturalHeight;
  const read = document.createElement('canvas');
  read.width = w;
  read.height = h;
  const rctx = read.getContext('2d', { willReadFrequently: true })!;
  rctx.drawImage(photo, 0, 0);
  const rgba = rctx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < gray.length; i++) gray[i] = (0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2]) / 255;
  const grad = gradientImage({ width: w, height: h, data: gray });

  const area = document.createElement('canvas');
  area.width = w;
  area.height = h;
  const ctx = area.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  const shape = (o: Outline) => {
    const spec = Array.isArray(o) ? { points: o } : o;
    const pts = toPx(spec.points, w, h);
    return { pts: recipe.snap === false || spec.snap === false ? pts : snapPolygon(pts, grad, w, h), solid: !Array.isArray(o) && !!o.solid };
  };
  const outlines = recipe.outline!.map(shape);
  for (const o of outlines) {
    if (o.solid) continue;
    pathOf(ctx, o.pts);
    ctx.fill();
  }

  // Planes from the cuts, or one estimated from the outline itself
  const planes = recipe.anchors.length ? await cutPlanes(scene, recipe, options) : null;
  // Gappy items (fence boards): the outline gives the straight ends, the cut keeps the gaps
  if (recipe.intersectCut && planes?.cuts.length) {
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(unionMasks(planes.cuts), 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';
  }
  // Solid outlines (a fence post) are taken whole, whatever the cut
  for (const o of outlines) {
    if (!o.solid) continue;
    pathOf(ctx, o.pts);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'destination-out';
  for (const poly of recipe.subtract ?? []) {
    pathOf(ctx, shape(poly).pts);
    ctx.fill();
  }
  ctx.globalCompositeOperation = 'source-over';

  const split = planes?.parts.length ? applyEditsToParts(planes.parts, area) : [{ mask: area, geometry: fallbackGeometry(area, recipe.label) }];
  const parted = partitionParts(split.map((p) => canvasToAlphaMask(p.mask)), canvasToAlphaMask(area));

  // Objects in front: SAM's object at each protect click, grown a pixel to cover its soft edge
  const objects: HTMLCanvasElement[] = [];
  for (const click of recipe.protect ?? []) {
    const obj = await cutObject(scene.photo, workerPoint(click), options);
    if (obj) objects.push(alphaMaskToCanvas(dilateDisc(canvasToAlphaMask(obj.mask), 1)));
  }
  for (const { region, ...range } of recipe.protectColour ?? []) objects.push(alphaMaskToCanvas(dilateDisc(colourMask(rgba, w, h, region, range), 1)));
  // Exact shapes of objects in front (a pendant's dome), drawn as given
  if (recipe.protectShapes?.length) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const sctx = c.getContext('2d')!;
    sctx.fillStyle = '#fff';
    for (const poly of recipe.protectShapes) {
      pathOf(sctx, toPx(poly, w, h));
      sctx.fill();
    }
    objects.push(c);
  }
  if (recipe.keepOccluders && planes) objects.push(...planes.occluders);
  else if (recipe.keepOccludersIn && planes?.occluders.length)
    objects.push(alphaMaskToCanvas(keepInside(canvasToAlphaMask(unionMasks(planes.occluders)), recipe.keepOccludersIn)));
  return {
    kind: item.kind,
    parts: split.map((p, k) => ({ ...p, mask: alphaMaskToCanvas(parted[k]) })),
    occluder: objects.length ? unionMasks(objects) : null,
    confidence: 1,
  };
};

/** The item's area from its recipe: traced outlines, the SAM cut, or its polygon — clipped, split per plane. */
export const bakeItem = async (scene: Scene, item: SceneItem, options: JobOptions = {}): Promise<BakeArea> => {
  const { recipe } = item;
  if (recipe.outline) return bakeOutline(scene, item, options);
  if (recipe.polygonOnly) {
    const { w, h } = await photoSize(scene.photo);
    const mask = alphaMaskToCanvas(polygonItemMask(recipe, w, h));
    return { kind: item.kind, parts: [{ mask, geometry: fallbackGeometry(mask, recipe.label) }], occluder: null, confidence: 1 };
  }
  const { parts, cuts, occluders, confidence, failures } = await cutPlanes(scene, recipe, options);
  if (!parts.length) throw new Error(`No surface found at any anchor — ${failures.join('; ')}`);
  const merged = canvasToAlphaMask(unionMasks(cuts));
  const clipped = alphaMaskToCanvas(recipe.add || recipe.clip || recipe.subtract ? applyRecipeClip(merged, recipe) : merged);
  const occluder = unionMasks(occluders);
  const split = applyEditsToParts(parts, clipped);
  const filled = partitionParts(split.map((p) => canvasToAlphaMask(p.mask)), canvasToAlphaMask(clipped));
  return {
    kind: item.kind,
    parts: split.map((p, k) => ({ ...p, mask: alphaMaskToCanvas(filled[k]) })),
    // As a hand edit: what the item now covers is surface, not an object in front — unless the
    // recipe keeps the real objects standing before it
    occluder: recipe.keepOccluders
      ? occluder
      : recipe.keepOccludersIn
        ? unionMasks([clearOccluderUnder(occluder, clipped), alphaMaskToCanvas(keepInside(canvasToAlphaMask(occluder), recipe.keepOccludersIn))])
        : clearOccluderUnder(occluder, clipped),
    confidence,
  };
};

const pngBase64 = async (mask: HTMLCanvasElement) => {
  const bytes = new Uint8Array(await (await alphaMaskToPngBlob(mask)).arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
};

/** Writes a baked item through the dev server (public/scenes/<scene>/ + scenes/baked.json, or a style's folder and entry). */
export const saveBakedItem = async (
  sceneId: string,
  itemId: string,
  area: BakeArea,
  meta: { edited: boolean; analysisVersion: string; styleKey?: string }
): Promise<void> => {
  if (!area.parts.length) throw new Error('The area is empty — nothing to save.');
  const body = {
    sceneId,
    itemId,
    styleKey: meta.styleKey,
    width: area.parts[0].mask.width,
    height: area.parts[0].mask.height,
    analysisVersion: meta.analysisVersion,
    confidence: area.confidence,
    edited: meta.edited,
    parts: await Promise.all(area.parts.map(async (p) => ({ png: await pngBase64(p.mask), plane: p.geometry }))),
    occluder: area.occluder ? await pngBase64(area.occluder) : null,
  };
  const res = await fetch('/__scenes/save', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Save failed (${res.status})`);
};
