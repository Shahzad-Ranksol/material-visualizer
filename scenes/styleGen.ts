import { clearOccluderAlpha, dilateDisc } from '../services/areaMaskOps';
import { canvasToAlphaMask, loadMaskAsAlpha, unionMasks } from '../services/maskCanvas';
import { ANALYSIS_VERSION } from '../services/roomAnalysis';
import { bakeItem, saveBakedItem } from './sceneBake';
import { blendStyle, featherInside, Rgba, seamGain, stylePatch } from './styleBlend';
import { generationPrompt, StyleGroup, StyleOption, styleKey } from './styles';
import { BakedScenes, Scene } from './types';

// Dev only (/dev/styles): asks the image AI (through the dev server) for a style inside a group's
// area, blends the chosen candidate, saves its patch and bakes the style's items.

// How far past the items' masks the AI may paint (their soft edges, a picket's new tops)
const REGION_GROW = 6;
// Edge ramp of the blend, inside the region
const FEATHER = 4;

const canvasOf = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

const b64 = (c: HTMLCanvasElement, type = 'image/png', quality?: number) =>
  new Promise<string>((resolve, reject) =>
    c.toBlob(
      async (blob) => {
        if (!blob) return reject(new Error('Could not encode the image'));
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        resolve(btoa(s));
      },
      type,
      quality
    )
  );

const loadImage = async (src: string) => {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
};

export const rgbaOf = (source: CanvasImageSource, w: number, h: number): Rgba => {
  const c = canvasOf(w, h);
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(source, 0, 0, w, h);
  return { width: w, height: h, data: ctx.getImageData(0, 0, w, h).data };
};

export const rgbaCanvas = (img: Rgba) => {
  const c = canvasOf(img.width, img.height);
  c.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), 0, 0);
  return c;
};

/**
 * The area a group's style may change: its items' baked masks, grown a little — less everything
 * standing in front of them (their occluders: a tree, a lamp, a vase), which stays the photo's own
 * pixels whatever the AI paints.
 */
export const groupRegion = async (baked: BakedScenes, scene: Scene, group: StyleGroup) => {
  const items = baked[scene.id]?.items ?? {};
  const masks = await Promise.all(group.itemIds.flatMap((id) => (items[id]?.parts ?? []).map((p) => loadMaskAsAlpha(p.mask))));
  if (!masks.length) throw new Error(`Bake ${group.itemIds.join(', ')} in /dev/scenes first`);
  const grown = dilateDisc(canvasToAlphaMask(unionMasks(masks)), REGION_GROW);
  const occluders = await Promise.all(group.itemIds.flatMap((id) => (items[id]?.occluder ? [loadMaskAsAlpha(items[id].occluder!)] : [])));
  return occluders.length ? clearOccluderAlpha(grown, binaryMask(canvasToAlphaMask(unionMasks(occluders)))) : grown;
};

const binaryMask = (m: ReturnType<typeof dilateDisc>) => ({ ...m, alpha: m.alpha.map((a) => (a >= 64 ? 255 : 0)) });

// The provider's output shape nearest the photo's (OpenAI takes these three; Gemini keeps the input's)
const targetSize = (w: number, h: number) => {
  const r = w / h;
  return r > 1.25 ? { w: 1536, h: 1024 } : r < 0.8 ? { w: 1024, h: 1536 } : { w: 1024, h: 1024 };
};

export interface Candidate {
  full: Rgba; // the AI's image at photo size
  blended: Rgba;
  gain: [number, number, number];
}

/**
 * Asks for `count` candidates. The photo is letterboxed (never stretched) into the provider's
 * shape, with the padding outside the mask; each answer is cropped back to the photo.
 */
export const generateCandidates = async (
  scene: Scene,
  group: StyleGroup,
  option: StyleOption,
  region: ReturnType<typeof dilateDisc>,
  count: number,
  // Show the last generated candidates for this style instead of asking again, if there are any
  reuse = false
): Promise<{ candidates: Candidate[]; errors: string[]; provider: string }> => {
  const photo = await loadImage(scene.photo);
  const W = photo.naturalWidth;
  const H = photo.naturalHeight;
  const original = rgbaOf(photo, W, H);
  const t = targetSize(W, H);
  const scale = Math.min(t.w / W, t.h / H);
  const dw = Math.round(W * scale);
  const dh = Math.round(H * scale);
  const ox = Math.floor((t.w - dw) / 2);
  const oy = Math.floor((t.h - dh) / 2);

  const image = canvasOf(t.w, t.h);
  const ictx = image.getContext('2d')!;
  ictx.fillStyle = '#808080';
  ictx.fillRect(0, 0, t.w, t.h);
  ictx.drawImage(photo, ox, oy, dw, dh);

  const regionCanvas = canvasOf(W, H);
  regionCanvas.getContext('2d')!.putImageData(
    new ImageData(Uint8ClampedArray.from({ length: W * H * 4 }, (_, i) => (i % 4 === 3 ? region.alpha[i >> 2] : 255)), W, H),
    0,
    0
  );
  // White-on-black (Gemini) and transparent-where-editable (OpenAI) masks
  const mask = canvasOf(t.w, t.h);
  const mctx = mask.getContext('2d')!;
  mctx.fillStyle = '#000';
  mctx.fillRect(0, 0, t.w, t.h);
  mctx.drawImage(regionCanvas, ox, oy, dw, dh);
  const alphaMask = canvasOf(t.w, t.h);
  const actx = alphaMask.getContext('2d')!;
  actx.fillStyle = '#000';
  actx.fillRect(0, 0, t.w, t.h);
  actx.globalCompositeOperation = 'destination-out';
  actx.drawImage(regionCanvas, ox, oy, dw, dh);

  const cached = reuse
    ? ((await (await fetch(`/__styles/candidates?sceneId=${scene.id}&styleKey=${styleKey(group.id, option.id)}`)).json()).candidates as string[])
    : [];
  const res = cached.length
    ? new Response(JSON.stringify({ candidates: cached, errors: [], provider: 'cached' }))
    : await fetch('/__styles/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sceneId: scene.id,
      image: await b64(image),
      mask: await b64(mask),
      alphaMask: await b64(alphaMask),
      prompt: generationPrompt(option, group),
      size: `${t.w}x${t.h}`,
      count,
      styleKey: styleKey(group.id, option.id),
    }),
  });
  const body = await res.json();
  if (!res.ok && !body.candidates?.length) throw new Error(body.errors?.join(' · ') || body.error || `Generation failed (${res.status})`);

  const weight = featherInside(region, FEATHER);
  const candidates: Candidate[] = [];
  for (const data of body.candidates as string[]) {
    const img = await loadImage(`data:image/png;base64,${data}`);
    // Back to the padded frame's size, then the photo's own pixels out of it
    const frame = canvasOf(t.w, t.h);
    frame.getContext('2d')!.drawImage(img, 0, 0, t.w, t.h);
    const crop = canvasOf(W, H);
    crop.getContext('2d')!.drawImage(frame, ox, oy, dw, dh, 0, 0, W, H);
    const cropped = rgbaOf(crop, W, H);
    const gain = seamGain(original, cropped, region);
    candidates.push({ full: cropped, blended: blendStyle(original, cropped, weight, gain), gain });
  }
  return { candidates, errors: body.errors ?? [], provider: body.provider };
};

/** Saves a chosen candidate's patch, then bakes every item of the group on the new design. */
export const acceptCandidate = async (
  baked: BakedScenes,
  scene: Scene,
  group: StyleGroup,
  option: StyleOption,
  region: ReturnType<typeof dilateDisc>,
  candidate: Candidate,
  provider: string,
  onProgress: (label: string) => void
) => {
  const key = styleKey(group.id, option.id);
  const weight = featherInside(region, FEATHER);
  const shipped = stylePatch(candidate.full, weight, candidate.gain);
  if (!shipped) throw new Error('The region is empty');
  onProgress('Saving the design…');
  const res = await fetch('/__styles/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sceneId: scene.id,
      styleKey: key,
      rect: shipped.rect,
      patch: await b64(rgbaCanvas(shipped.patch), 'image/webp', 0.92),
      provider,
      prompt: generationPrompt(option, group),
    }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => null))?.error ?? `Save failed (${res.status})`);

  // The new design as a photo, for the bake pipeline (an object URL the analysis worker can fetch)
  const variant = rgbaCanvas(candidate.blended);
  const blob = await new Promise<Blob>((resolve, reject) => variant.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png'));
  const url = URL.createObjectURL(blob);
  try {
    for (const itemId of group.itemIds) {
      const item = scene.items.find((i) => i.id === itemId);
      if (!item) continue;
      onProgress(`Baking ${item.label}…`);
      const recipe = { ...item.recipe, ...option.recipeOverrides?.[itemId] };
      const area = await bakeItem({ ...scene, photo: url }, { ...item, recipe }, { onProgress: (l) => onProgress(`${item.label}: ${l}`) });
      // What stands in front (knobs, lamps, vases) was never in the AI's region, so it is still the
      // photo's own pixels: keep the original item's exact occluder rather than re-detecting it on
      // the new design (colour rules for brass misfire on a wood-toned style's grooves). Styles
      // that open gaps (a picket fence) re-detect: their `protectColour` override adds the garden
      const base = baked[scene.id]?.items[itemId]?.occluder;
      if (base && !option.recipeOverrides?.[itemId]) area.occluder = await loadMaskAsAlpha(base);
      await saveBakedItem(scene.id, itemId, area, { edited: false, analysisVersion: ANALYSIS_VERSION, styleKey: key });
    }
  } finally {
    URL.revokeObjectURL(url);
  }
};
