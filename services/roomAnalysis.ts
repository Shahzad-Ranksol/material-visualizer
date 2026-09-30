import { DetectedItem, PlanePoint, RenderableSurface, SurfaceAnalysis, SurfaceGeometry, SurfaceKind } from '../types';
import type { CutStages, SurfaceProposal } from './analysis/protocol';
import { createWorkerClient, JobOptions } from './analysis/workerClient';
export { isAbortError, AnalysisTimeoutError } from './analysis/workerClient';
export type { JobOptions } from './analysis/workerClient';
import { autoFitPlane, planeKindFor } from './planeGeometry';
import { ConfidenceInputs, ReviewDecision, reviewDecision } from './qualityGate';

/**
 * Room analysis — the single entry point the app uses to turn a photo into renderable
 * surfaces. All models run in a Web Worker from locally hosted files; per-photo results are
 * cached (memory + IndexedDB), so switching materials never re-runs a model.
 */
export { ANALYSIS_VERSION, MODEL_VERSIONS } from './analysis/protocol';
export type { SurfaceProposal };

// One worker for the app; `new Worker(new URL(...))` stays literal here so Vite bundles it
const client = createWorkerClient(() => new Worker(new URL('../workers/analysis.worker.ts', import.meta.url), { type: 'module' }));
const send = client.send;

const KIND_BY_LABEL: Record<string, SurfaceKind> = {
  wall: 'wall',
  floor: 'floor',
  ceiling: 'ceiling',
  cabinet: 'cabinet',
  wardrobe: 'cabinet',
  shelf: 'cabinet',
  countertop: 'countertop',
  'kitchen island': 'countertop',
  door: 'door',
};
export const surfaceKindFor = (label: string): SurfaceKind => KIND_BY_LABEL[label.toLowerCase()] ?? 'custom';

const CATEGORY_BY_KIND: Record<SurfaceKind, DetectedItem['category']> = {
  wall: 'Surfaces & Walls',
  floor: 'Flooring',
  ceiling: 'Surfaces & Walls',
  cabinet: 'Cabinetry',
  countertop: 'Cabinetry',
  door: 'Architectural',
  furniture: 'Furniture',
  custom: 'Architectural',
};

const titleCase = (label: string) => label.replace(/\b\w/g, (c) => c.toUpperCase());

export interface RoomAnalysisResult {
  items: DetectedItem[];
  warnings: string[];
  geometryAvailable: boolean;
}

/** Analyzes a room photo into selectable surface proposals (exact masks are cut on first use). */
export const analyzeRoom = async (imageUrl: string, options: JobOptions = {}): Promise<RoomAnalysisResult> => {
  const res = await send({ type: 'analyze', imageUrl }, options);
  if (res.type !== 'analyze') throw new Error('Unexpected analysis response');
  const counts: Record<string, number> = {};
  const items: DetectedItem[] = res.proposals.map((p) => {
    const kind = surfaceKindFor(p.label);
    counts[p.label] = (counts[p.label] ?? 0) + 1;
    return {
      id: `surface-${p.id}`,
      name: counts[p.label] > 1 ? `${titleCase(p.label)} ${counts[p.label]}` : titleCase(p.label),
      category: CATEGORY_BY_KIND[kind],
      description: `Detected ${p.label} (${Math.round(p.areaPct)}% of the photo)`,
      anchor: p.anchor,
      surfaceLabel: p.label,
      surfaceKind: kind,
      areaPct: p.areaPct,
    };
  });
  return { items, warnings: res.warnings, geometryAvailable: res.geometryAvailable };
};

// Soft 0-255 matte -> editable alpha canvas (white, alpha = coverage)
const alphaCanvas = (values: Uint8Array, w: number, h: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);
  for (let i = 0; i < values.length; i++) {
    img.data[i * 4] = 255;
    img.data[i * 4 + 1] = 255;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = values[i];
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
};

export interface CutSurface {
  label: string;
  kind: SurfaceKind;
  // One part per physical plane (a wall mask across a corner gives two)
  parts: Array<{ mask: HTMLCanvasElement; geometry: SurfaceGeometry | null }>;
  occluder: HTMLCanvasElement;
  confidence: number;
  confidenceInputs: ConfidenceInputs;
  decision: ReviewDecision;
  // Why a person should check this area (a mirror, an object covered…); any one means ≥ 'confirm'
  reviewReasons: string[];
  areaPct: number;
  // Only with `debugStages`: every pipeline stage's binary mask at photo size
  stages?: CutStages & { width: number; height: number };
}

/**
 * Cuts the exact surface at a point: SAM-refined mask, occluders, skirting removed, split per
 * plane with fitted 3D geometry, edge-refined — plus its composite confidence. Optional
 * `include`/`exclude` points are the user's +/- corrections.
 */
export const cutSurface = async (
  imageUrl: string,
  point: PlanePoint,
  options: { label?: string; connectedOnly?: boolean; include?: PlanePoint[]; exclude?: PlanePoint[]; debugStages?: boolean } & JobOptions = {}
): Promise<CutSurface> => {
  const res = await send({
    type: 'cut',
    imageUrl,
    point,
    label: options.label,
    connectedOnly: options.connectedOnly ?? planeKindFor(options.label ?? 'wall') === 'vertical',
    include: options.include,
    exclude: options.exclude,
    debugStages: options.debugStages,
  }, { signal: options.signal, onProgress: options.onProgress });
  if (res.type !== 'cut') throw new Error('Unexpected analysis response');
  const kind = surfaceKindFor(res.label);
  const parts = res.parts.map((p) => {
    const mask = alphaCanvas(p.mask, res.width, res.height);
    let geometry: SurfaceGeometry | null = null;
    if (p.plane && res.intrinsics) {
      geometry = { ...p.plane, intrinsics: res.intrinsics };
    } else {
      // No 3D geometry: fall back to the perspective estimate from the mask (never a label guess)
      const fallback = autoFitPlane(mask, planeKindFor(res.label));
      geometry = fallback ? { homographyFallback: fallback } : null;
    }
    return { mask, geometry };
  });
  return {
    label: res.label,
    kind,
    parts,
    occluder: alphaCanvas(res.occluder, res.width, res.height),
    confidence: res.confidence,
    confidenceInputs: res.confidenceInputs,
    decision: reviewDecision(res.confidence, res.reviewReasons),
    reviewReasons: res.reviewReasons,
    areaPct: res.areaPct,
    stages: res.stages && { ...res.stages, width: res.width, height: res.height },
  };
};

/** The single object at a point (a lamp, a headboard…) as an alpha mask, or null if there is none. */
export const cutObject = async (
  imageUrl: string,
  point: PlanePoint,
  options: JobOptions = {}
): Promise<{ mask: HTMLCanvasElement; surfaceShare: number } | null> => {
  const res = await send({ type: 'cutObject', imageUrl, point }, options);
  if (res.type !== 'cutObject') throw new Error('Unexpected analysis response');
  return res.mask ? { mask: alphaCanvas(res.mask, res.width, res.height), surfaceShare: res.surfaceShare } : null;
};

export const cutToRenderables = (cut: CutSurface): RenderableSurface[] =>
  cut.parts.map((p) => ({ kind: cut.kind, mask: p.mask, occluderMask: cut.occluder, plane: p.geometry }));

/** Cuts (once) the surfaces behind a studio target and records the confidence on it. */
export const resolveSurface = async (
  imageUrl: string,
  item: DetectedItem,
  options: JobOptions = {}
): Promise<{ surfaces: RenderableSurface[]; item: DetectedItem }> => {
  if (item.surfaces?.length) return { surfaces: item.surfaces, item };
  if (!item.anchor || !item.surfaceLabel) throw new Error(`"${item.name}" has no detected area to render.`);
  const cut = await cutSurface(imageUrl, item.anchor, { label: item.surfaceLabel, ...options });
  const surfaces = cutToRenderables(cut);
  return {
    surfaces,
    item: { ...item, surfaces, confidence: Math.round(cut.confidence * 100), needsReview: cut.decision !== 'auto', reviewDecision: cut.decision },
  };
};

export const savedSurfaceToRenderable = (s: SurfaceAnalysis): RenderableSurface => ({
  kind: s.kind,
  mask: s.maskUrl,
  occluderMask: s.occluderMaskUrl ?? null,
  plane: s.plane ?? null,
  calibration: s.calibration ?? null,
});

/** A saved surface (with any extra plane parts) as a studio target. */
export const savedSurfaceToItem = (s: SurfaceAnalysis, parts: SurfaceAnalysis[], anchor?: PlanePoint): DetectedItem => ({
  id: `saved-${s.id}`,
  name: s.label,
  category: CATEGORY_BY_KIND[s.kind] ?? 'Architectural',
  description: `Saved ${s.kind} surface`,
  confidence: Math.round(s.confidence * 100),
  needsReview: s.needsReview,
  surfaceKind: s.kind,
  anchor,
  surfaces: [s, ...parts].map(savedSurfaceToRenderable),
});
