// Scores one approved validation surface with the app's own client code: analyze, cut (with
// every stage), the exact final render mask (selectedAreaAlpha > 0.5), compared with the approved
// mask. Run by tests/e2e/validation-score.spec.ts through the Vite dev server.
import { analyzeRoom, cutSurface, cutToRenderables } from '../../../services/roomAnalysis';
import { selectedAreaAlpha } from '../../../services/renderer/materialRenderer';
import { attribute, decisionOutcome, scoreMasks } from '../../../services/validation/metrics';

const binaryOf = async (url: string, w: number, h: number) => {
  const img = new Image();
  img.src = url;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  return Uint8Array.from({ length: w * h }, (_, i) => (d[i * 4] > 127 ? 1 : 0));
};

// Photo with missed (red) and leaked (magenta) pixels, downscaled to a JPEG for the dashboard
const overlay = async (imageUrl: string, w: number, h: number, missed: (i: number) => boolean, leaked: (i: number) => boolean) => {
  const img = new Image();
  img.src = imageUrl;
  await img.decode();
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h);
  for (let i = 0; i < w * h; i++) {
    const rgb = missed(i) ? [239, 68, 68] : leaked(i) ? [217, 70, 239] : null;
    if (rgb) for (let k = 0; k < 3; k++) d.data[i * 4 + k] = d.data[i * 4 + k] * 0.35 + rgb[k] * 0.65;
  }
  ctx.putImageData(d, 0, 0);
  const s = document.createElement('canvas');
  const scale = Math.min(1, 800 / w);
  s.width = Math.round(w * scale);
  s.height = Math.round(h * scale);
  s.getContext('2d')!.drawImage(c, 0, 0, s.width, s.height);
  return s.toDataURL('image/jpeg', 0.8);
};

const scoreSurface = async (id: string, surface: string, name: string) => {
  const imageUrl = `/validation-cache/${id}.jpg`;
  const approvedUrl = `/validation-approved/${name}.png`;
  const { items } = await analyzeRoom(imageUrl);
  const item = items.find((i) => i.surfaceLabel === surface);
  if (!item?.anchor) {
    // Not proposed at all: everything approved is missed
    const photo = new Image();
    photo.src = imageUrl;
    await photo.decode();
    const { naturalWidth: w, naturalHeight: h } = photo;
    const approved = await binaryOf(approvedUrl, w, h);
    const s = scoreMasks(new Uint8Array(w * h), approved, w, h);
    return { ...s, confidence: 0, decision: 'correct', outcome: decisionOutcome('correct', s.iou), missedBy: { notProposed: 100 }, leakedBy: {}, reviewReasons: ['not proposed'], overlay: null };
  }
  const cut = await cutSurface(imageUrl, item.anchor, { label: surface, debugStages: true });
  const render = await selectedAreaAlpha(imageUrl, cutToRenderables(cut));
  const { width: w, height: h } = render;
  const predicted = Uint8Array.from(render.alpha, (v) => (v > 0.5 ? 1 : 0));
  const approved = await binaryOf(approvedUrl, w, h);
  const s = scoreMasks(predicted, approved, w, h);
  const approvedPx = approved.reduce((n, v) => n + v, 0) || 1;
  const { missedBy, leakedBy } = attribute(cut.stages!.masks, predicted, approved);
  const pct = (r: Record<string, number>) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, +((v / approvedPx) * 100).toFixed(2)]));
  return {
    ...s,
    confidence: cut.confidence,
    decision: cut.decision,
    outcome: decisionOutcome(cut.decision, s.iou),
    missedBy: pct(missedBy),
    leakedBy: pct(leakedBy),
    reviewReasons: cut.reviewReasons,
    overlay: await overlay(imageUrl, w, h, (i) => approved[i] === 1 && !predicted[i], (i) => predicted[i] === 1 && !approved[i]),
  };
};

Object.assign(window, { scoreSurface });
