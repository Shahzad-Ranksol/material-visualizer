// Evidence harness for surface coverage and leakage (tests/e2e/pipeline-evidence.spec.ts), run
// through the Vite dev server with the real models. For one photo and surface it runs the app's
// own client code (analyzeRoom, cutSurface with every pipeline stage, selectedAreaAlpha,
// renderMaterial) and measures where a missed or leaked pixel came from:
// - segmentation: which stage removed a surface pixel, or added a pixel of another class;
// - alignment: whether the masks are the size of the photo the renderer and <img> decode;
// - rendering: whether any pixel outside the final render mask changed.
import { analyzeRoom, cutSurface, cutToRenderables } from '../../../services/roomAnalysis';
import { CUT_STAGES, CutStage } from '../../../services/analysis/protocol';
import { renderMaterial, selectedAreaAlpha } from '../../../services/renderer/materialRenderer';
import { MATERIALS } from '../../../constants';

export interface EvidenceResult {
  surface: string;
  photo: { img: [number, number]; masks: [number, number]; render: [number, number] };
  classPct: number;
  finalPct: number;
  // Surface-class pixels missing from the final mask, by the stage that dropped them (% of photo)
  missedPct: number;
  missedBy: Record<string, number>;
  // Final-mask pixels of another class, by class and by the stage that added them (% of photo)
  leakPct: number;
  leakByClass: Record<string, number>;
  leakBy: Record<string, number>;
  // Pixels the render changed where the final render mask is 0 (must be 0)
  changedOutside: number;
  maxDiffOutside: number;
  confidence: number;
  decision: string;
  reviewReasons: string[];
  overlays: Record<string, string>;
}

const loadImg = (url: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not load ${url}`));
    img.src = url;
  });

const pixelsOf = async (url: string, w: number, h: number) => {
  const img = await loadImg(url);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  // Decoded exactly as the renderer does (a CPU canvas): Chrome's GPU canvas decodes JPEGs
  // through a different YUV path, which alone differs by ±1 on most pixels
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  return ctx.getImageData(0, 0, w, h).data;
};

// Photo with coloured masks, downscaled to a JPEG for the report
const overlay = (img: HTMLImageElement, w: number, h: number, layers: Array<{ mask: (i: number) => number; rgb: number[] }>) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) {
    for (const { mask, rgb } of layers) {
      const a = mask(i) * 0.6;
      if (a <= 0) continue;
      for (let k = 0; k < 3; k++) d.data[i * 4 + k] = d.data[i * 4 + k] * (1 - a) + rgb[k] * a;
    }
  }
  ctx.putImageData(d, 0, 0);
  const s = document.createElement('canvas');
  const scale = Math.min(1, 900 / w);
  s.width = Math.round(w * scale);
  s.height = Math.round(h * scale);
  s.getContext('2d')!.drawImage(c, 0, 0, s.width, s.height);
  return s.toDataURL('image/jpeg', 0.8);
};

const run = async (imageUrl: string, surfaceLabel: string): Promise<EvidenceResult | null> => {
  const { items } = await analyzeRoom(imageUrl);
  const item = items.find((i) => i.surfaceLabel === surfaceLabel);
  if (!item?.anchor) return null;
  const cut = await cutSurface(imageUrl, item.anchor, { label: surfaceLabel, debugStages: true });
  const st = cut.stages!;
  const { width: w, height: h } = st;
  const n = w * h;
  const img = await loadImg(imageUrl);
  const final = await selectedAreaAlpha(imageUrl, cutToRenderables(cut));
  const pct = (k: number) => (k / n) * 100;

  const surfaceClass = st.labels.indexOf(surfaceLabel);
  const cls = st.masks.classCandidate;
  const last = st.masks.onPlane;
  const missedBy: Record<string, number> = {};
  const leakBy: Record<string, number> = {};
  const leakByClass: Record<string, number> = {};
  let classPx = 0;
  let finalPx = 0;
  let missed = 0;
  let leak = 0;
  for (let i = 0; i < n; i++) {
    if (cls[i]) classPx++;
    if (last[i]) finalPx++;
    if (cls[i] && !last[i]) {
      missed++;
      // The step that finally removed it: the last stage without it whose predecessor had it
      // (the class candidate always has it, so SAM leaving it out counts as samRaw)
      let by: CutStage = 'samRaw';
      for (let k = CUT_STAGES.length - 1; k >= 1; k--) {
        if (!st.masks[CUT_STAGES[k]][i] && st.masks[CUT_STAGES[k - 1]][i]) {
          by = CUT_STAGES[k];
          break;
        }
      }
      missedBy[by] = (missedBy[by] ?? 0) + 1;
    }
    const v = st.labelMap[i];
    if (last[i] && v !== surfaceClass && v !== 255) {
      leak++;
      const name = st.labels[v] ?? String(v);
      leakByClass[name] = (leakByClass[name] ?? 0) + 1;
      // The step that finally added it: the last stage with it whose predecessor lacked it
      let by: CutStage = 'samRaw';
      for (let k = CUT_STAGES.length - 1; k >= 1; k--) {
        if (st.masks[CUT_STAGES[k]][i] && !st.masks[CUT_STAGES[k - 1]][i]) {
          by = CUT_STAGES[k];
          break;
        }
      }
      leakBy[by] = (leakBy[by] ?? 0) + 1;
    }
  }
  const toPct = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +pct(v).toFixed(2)]));

  // Rendering: nothing may change where the final render mask is 0
  const material = MATERIALS.find((m) => m.category === (surfaceLabel === 'floor' ? 'wood' : 'stone')) ?? MATERIALS[0];
  const renderUrl = await renderMaterial(imageUrl, cutToRenderables(cut).map((surface) => ({ surface, material })));
  const rw = final.width;
  const rh = final.height;
  const before = await pixelsOf(imageUrl, rw, rh);
  const after = await pixelsOf(renderUrl, rw, rh);
  let changedOutside = 0;
  let maxDiffOutside = 0;
  for (let i = 0; i < rw * rh; i++) {
    if (final.alpha[i] > 0) continue;
    const d = Math.max(...[0, 1, 2].map((k) => Math.abs(before[i * 4 + k] - after[i * 4 + k])));
    if (d > 0) changedOutside++;
    if (d > maxDiffOutside) maxDiffOutside = d;
  }

  const sameSize = rw === w && rh === h;
  const overlays: Record<string, string> = {
    final: overlay(img, w, h, [{ mask: (i) => (sameSize ? final.alpha[i] : last[i]), rgb: [251, 191, 36] }]),
    // Red = surface class the final mask misses; magenta = final mask on another class
    faults: overlay(img, w, h, [
      { mask: (i) => (cls[i] && !last[i] ? 1 : 0), rgb: [239, 68, 68] },
      { mask: (i) => (last[i] && st.labelMap[i] !== surfaceClass && st.labelMap[i] !== 255 ? 1 : 0), rgb: [217, 70, 239] },
    ]),
    classMap: overlay(img, w, h, [{ mask: (i) => cls[i], rgb: [59, 130, 246] }]),
    samRaw: overlay(img, w, h, [{ mask: (i) => st.masks.samRaw[i], rgb: [34, 197, 94] }]),
  };

  return {
    surface: item.name,
    photo: { img: [img.naturalWidth, img.naturalHeight], masks: [w, h], render: [rw, rh] },
    classPct: +pct(classPx).toFixed(2),
    finalPct: +pct(finalPx).toFixed(2),
    missedPct: +pct(missed).toFixed(2),
    missedBy: toPct(missedBy),
    leakPct: +pct(leak).toFixed(2),
    leakByClass: toPct(leakByClass),
    leakBy: toPct(leakBy),
    changedOutside,
    maxDiffOutside,
    confidence: +cut.confidence.toFixed(3),
    decision: cut.decision,
    reviewReasons: cut.reviewReasons,
    overlays,
  };
};

// Alignment: the worker's decode of an EXIF-rotated JPEG vs the browser's <img>
const exifCheck = async (jpegUrl: string) => {
  const { items } = await analyzeRoom(jpegUrl);
  const item = items.find((i) => i.anchor);
  if (!item?.anchor) return null;
  const cut = await cutSurface(jpegUrl, item.anchor, { label: item.surfaceLabel, debugStages: true });
  const img = await loadImg(jpegUrl);
  return { img: [img.naturalWidth, img.naturalHeight], masks: [cut.stages!.width, cut.stages!.height] };
};

Object.assign(window, { runEvidence: run, exifCheck });
