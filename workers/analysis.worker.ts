// Room analysis worker. Runs every local model off the main thread:
//   analyze: validate → SegFormer class proposals → MoGe geometry (cached per photo)
//   cut:     SAM 2.1 mask from prompts → occluders → skirting → per-wall 3D planes →
//            edge refinement → composite confidence
import { RawImage } from '@huggingface/transformers';
import { segmentSemantics, SemanticMap } from '../services/analysis/semanticSegmentation';
import { encodeForPrompts, segmentWithPrompts, PromptEncoding, PromptPoint } from '../services/analysis/promptSegmentation';
import { estimateGeometry, SceneGeometry } from '../services/analysis/geometryEstimation';
import { ANALYSIS_VERSION, AnalysisStage, WorkerRequest, WorkerResponse, SurfaceProposal } from '../services/analysis/protocol';
import { imageKey, readCachedAnalysis, writeCachedAnalysis } from '../services/analysis/analysisCache';
import {
  bbox,
  boundaryEdgeAgreement,
  connectedComponents,
  dilate,
  erode,
  floodRegion,
  guidedFilter,
  interiorPoints,
  iou,
  refineBandByColor,
  growAcrossContinuousColour,
  removeSkirting,
} from '../services/analysis/maskOps';
import { fitSurfacePlanes, PlaneOrientation } from '../services/surfacePlaneFit';
import { compositeConfidence, ConfidenceInputs } from '../services/qualityGate';

// ADE20K classes a vendor/customer might re-surface, in suggestion order
const SURFACE_LABELS = ['wall', 'floor', 'ceiling', 'cabinet', 'countertop', 'kitchen island', 'door', 'column', 'stairs', 'wardrobe', 'shelf'];
// Things in front of surfaces: never re-surfaced, restored exactly on top
const OCCLUDER_LABELS = new Set([
  'painting', 'mirror', 'plant', 'flower', 'lamp', 'sconce', 'chandelier', 'light', 'curtain', 'blind', 'windowpane', 'door',
  'chair', 'armchair', 'sofa', 'table', 'desk', 'bed', 'cushion', 'pillow', 'vase', 'pot', 'shelf', 'cabinet', 'chest of drawers',
  'television receiver', 'screen', 'radiator', 'fireplace', 'bookcase', 'box', 'basket', 'bottle', 'sculpture', 'clock', 'book',
  'stool', 'bench', 'towel', 'fan', 'switch', 'computer', 'rug', 'kitchen island', 'countertop', 'stove', 'refrigerator', 'sink',
]);
// Neighbouring structural surfaces a surface must never leak into (a pale wall and a pale
// ceiling can look like one object to SAM). Their confident interiors are hard limits; the
// exact boundary with them is decided by local colour.
const STRUCTURAL_LABELS = new Set(['wall', 'floor', 'ceiling', 'windowpane', 'door', 'column', 'stairs', 'stairway', 'railing']);
// Depth (px, at 1600px) from which another structural surface's pixels are certain enough to exclude
const STRUCTURAL_CORE_PX = 6;
// Colour-matting band around SAM's edge and the window for local colour statistics (fraction of long side)
const MATTING_BAND_FRACTION = 0.025;
// Must exceed the band, so every band pixel sees reference colours from the surface interior
const MATTING_WINDOW_FRACTION = 0.035;
// Surfaces smaller than this (% of the photo) aren't proposed automatically
const MIN_PROPOSAL_AREA_PCT = 2;
// Edge refinement (guided filter) settings
const GUIDE_RADIUS_FRACTION = 0.006;
const GUIDE_EPSILON = 0.0001;
const EDGE_SHARPNESS = 6;
// Long edge below which photos render soft
const MIN_LONG_EDGE_PX = 1280;

interface RoomState {
  image: RawImage;
  width: number;
  height: number;
  gray: Float32Array;
  semantic: SemanticMap;
  geometry: SceneGeometry | null;
  warnings: string[];
  fromCache: boolean;
  prompts?: Promise<PromptEncoding>;
}

const rooms = new Map<string, Promise<RoomState>>();

// Progress for one request. Requests can overlap (they're async), so each carries its own;
// a photo load shared by several requests reports to the one that started it.
type ReportStage = (stage: AnalysisStage) => void;

const toGray = (image: RawImage) => {
  const gray = new Float32Array(image.width * image.height);
  const { data, channels } = image;
  for (let i = 0; i < gray.length; i++) {
    const o = i * channels;
    gray[i] = (0.299 * data[o] + 0.587 * data[o + 1] + 0.114 * data[o + 2]) / 255;
  }
  return gray;
};

const loadRoom = (imageUrl: string, reportStage: ReportStage): Promise<RoomState> => {
  let entry = rooms.get(imageUrl);
  if (!entry) {
    entry = (async () => {
      reportStage('loading-photo');
      const image = await RawImage.fromURL(imageUrl);
      const warnings: string[] = [];
      if (Math.max(image.width, image.height) < MIN_LONG_EDGE_PX) {
        warnings.push(`This photo is ${Math.max(image.width, image.height)}px on its long edge; ${MIN_LONG_EDGE_PX}px or more gives sharper renders.`);
      }
      const key = await imageKey(image.data, image.width, image.height, image.channels, ANALYSIS_VERSION);
      const cached = await readCachedAnalysis(key);
      let semantic: SemanticMap;
      let geometry: SceneGeometry | null = null;
      if (cached) {
        reportStage('from-cache');
        semantic = { labels: cached.labels, labelMap: cached.labelMap };
        if (cached.geometry) {
          const g = cached.geometry;
          geometry = {
            pointMap: { width: g.width, height: g.height, points: g.points, valid: g.valid, normals: g.normals },
            intrinsics: g.intrinsics,
            reprojectionErrorPx: g.reprojectionErrorPx,
          };
        }
      } else {
        reportStage('surfaces');
        semantic = await segmentSemantics(image);
        reportStage('geometry');
        try {
          geometry = await estimateGeometry(image);
        } catch (err) {
          console.warn('Geometry model failed; surfaces fall back to perspective estimates', err);
        }
        await writeCachedAnalysis(key, {
          labels: semantic.labels,
          labelMap: semantic.labelMap,
          geometry: geometry && {
            ...geometry.pointMap,
            intrinsics: geometry.intrinsics,
            reprojectionErrorPx: geometry.reprojectionErrorPx,
          },
        });
      }
      if (!geometry) warnings.push('3D geometry is unavailable for this photo, so perspective is estimated — check the layout grid.');
      return { image, width: image.width, height: image.height, gray: toGray(image), semantic, geometry, warnings, fromCache: Boolean(cached) };
    })();
    entry.catch(() => rooms.delete(imageUrl));
    rooms.set(imageUrl, entry);
  }
  return entry;
};

const analyze = async (imageUrl: string, reportStage: ReportStage) => {
  const room = await loadRoom(imageUrl, reportStage);
  const { width: w, height: h, semantic } = room;
  const proposals: SurfaceProposal[] = [];
  for (const label of SURFACE_LABELS) {
    const index = semantic.labels.indexOf(label);
    if (index < 0) continue;
    const classMask = new Uint8Array(w * h);
    for (let i = 0; i < classMask.length; i++) classMask[i] = semantic.labelMap[i] === index ? 1 : 0;
    // Disconnected regions are separate surfaces, never one plane
    connectedComponents(classMask, w, h).forEach((comp, k) => {
      const areaPct = (comp.length / (w * h)) * 100;
      if (areaPct < MIN_PROPOSAL_AREA_PCT) return;
      const region = new Uint8Array(w * h);
      for (const i of comp) region[i] = 1;
      const [anchor] = interiorPoints(region, w, h, 1);
      if (!anchor) return;
      proposals.push({ id: `${label}-${k}`, label, areaPct, anchor: { xPct: (anchor.x / w) * 100, yPct: (anchor.y / h) * 100 } });
    });
  }
  return { width: w, height: h, labels: semantic.labels, proposals, warnings: room.warnings, geometryAvailable: Boolean(room.geometry), fromCache: room.fromCache };
};

const orientationFor = (label: string): PlaneOrientation =>
  /floor|rug|carpet|countertop|kitchen island|table|desk/.test(label) ? 'floor' : /ceiling/.test(label) ? 'ceiling' : 'vertical';

// Largest share of the photo one object click may return; more means SAM grabbed the room
const MAX_OBJECT_FRACTION = 0.6;

// Guided-filter window for edge refinement, scaled to the photo (shared by cut and cutObject)
const guideRadiusFor = (w: number, h: number) => Math.max(2, Math.round(Math.max(w, h) * GUIDE_RADIUS_FRACTION));

/**
 * The single object at a point (a lamp, a headboard…) for the Area Editor's cut-out/add tools:
 * one positive point, no box, so SAM's candidates are object-sized. Picks the best-scoring
 * candidate that contains the click and isn't room-sized; null when there is none.
 */
const cutObject = async (req: Extract<WorkerRequest, { type: 'cutObject' }>, reportStage: ReportStage) => {
  const room = await loadRoom(req.imageUrl, reportStage);
  const { width: w, height: h, gray } = room;
  const px = Math.min(w - 1, Math.max(0, Math.round((req.point.xPct / 100) * w)));
  const py = Math.min(h - 1, Math.max(0, Math.round((req.point.yPct / 100) * h)));
  reportStage('refining');
  room.prompts ??= encodeForPrompts(room.image);
  const sam = await segmentWithPrompts(await room.prompts, [{ x: px, y: py, positive: true }], null, w, h);
  // Candidates best score first (ties keep SAM's order): the first that contains the click and
  // isn't room-sized wins, so coverage is only counted until then, and each count stops as soon
  // as it passes the limit (a room-sized candidate isn't scanned to the end)
  const limit = w * h * MAX_OBJECT_FRACTION;
  // (a non-finite score is never picked, as with the old strict `>` scan)
  const order = sam.masks
    .map((_, k) => k)
    .filter((k) => Number.isFinite(sam.scores[k]))
    .sort((a, b) => sam.scores[b] - sam.scores[a] || a - b);
  const best =
    order.find((k) => {
      const m = sam.masks[k];
      if (!m[py * w + px]) return false; // (so it covers at least the click)
      let covered = 0;
      for (let i = 0; i < m.length; i++) if (m[i] && ++covered > limit) return false;
      return true;
    }) ?? -1;
  if (best < 0) return { width: w, height: h, mask: null };
  const binary = Uint8Array.from(sam.masks[best], (v) => (v ? 1 : 0));
  const radius = guideRadiusFor(w, h);
  return { width: w, height: h, mask: guidedFilter(gray, binary, w, h, radius, GUIDE_EPSILON, EDGE_SHARPNESS) };
};

const cut = async (req: Extract<WorkerRequest, { type: 'cut' }>, reportStage: ReportStage) => {
  const room = await loadRoom(req.imageUrl, reportStage);
  const { width: w, height: h, semantic, gray } = room;
  const px = Math.min(w - 1, Math.max(0, Math.round((req.point.xPct / 100) * w)));
  const py = Math.min(h - 1, Math.max(0, Math.round((req.point.yPct / 100) * h)));
  const start = py * w + px;
  const labelIndex = req.label !== undefined ? semantic.labels.indexOf(req.label) : semantic.labelMap[start];
  if (labelIndex < 0 || labelIndex === 255) throw new Error('No surface detected at this point');
  const label = semantic.labels[labelIndex];

  // 1. Semantic proposal
  const region =
    req.connectedOnly && semantic.labelMap[start] === labelIndex
      ? floodRegion(w, h, start, (i) => semantic.labelMap[i] === labelIndex)
      : Uint8Array.from(semantic.labelMap, (v) => (v === labelIndex ? 1 : 0));
  const box = bbox(region, w);
  if (!box) throw new Error('No surface detected at this point');

  // 2. Occluders (restored on top at render time). Anywhere in the photo, not just next to the
  // proposal: SAM can spill well past it (dark curtains on a dark wall), and those pixels must
  // still be recognised as objects. Only the nearby ones steer SAM with negative points.
  const long = Math.max(w, h);
  const near = dilate(region, w, h, Math.round(long * 0.02));
  const occluderIdx = new Set(semantic.labels.map((l, i) => (OCCLUDER_LABELS.has(l) && l !== label ? i : -1)).filter((i) => i >= 0));
  const occluder = Uint8Array.from(semantic.labelMap, (v) => (occluderIdx.has(v) ? 1 : 0));
  const nearOccluder = Uint8Array.from(occluder, (v, i) => (v && near[i] ? 1 : 0));

  reportStage('refining');
  // 3. SAM: positive points inside the proposal, negative points on nearby occluders, box
  const points: PromptPoint[] = [
    { x: px, y: py, positive: true },
    ...interiorPoints(region, w, h, 3).map((p) => ({ ...p, positive: true })),
    ...connectedComponents(nearOccluder, w, h)
      .slice(0, 8)
      .filter((c) => c.length > w * h * 0.001)
      .map((c) => {
        const m = new Uint8Array(w * h);
        for (const i of c) m[i] = 1;
        return interiorPoints(m, w, h, 1)[0];
      })
      .filter(Boolean)
      .map((p) => ({ ...p, positive: false })),
    ...(req.include ?? []).map((p) => ({ x: (p.xPct / 100) * w, y: (p.yPct / 100) * h, positive: true })),
    ...(req.exclude ?? []).map((p) => ({ x: (p.xPct / 100) * w, y: (p.yPct / 100) * h, positive: false })),
  ];
  room.prompts ??= encodeForPrompts(room.image);
  const enc = await room.prompts;
  const pad = Math.round(Math.max(w, h) * 0.02);
  const sam = await segmentWithPrompts(
    enc,
    points,
    { x0: Math.max(0, box.minX - pad), y0: Math.max(0, box.minY - pad), x1: Math.min(w - 1, box.maxX + pad), y1: Math.min(h - 1, box.maxY + pad) },
    w,
    h
  );
  // Best candidate: agrees with the proposal, confident, and follows real edges
  let chosen = 0;
  let chosenScore = -1;
  const userRefined = Boolean(req.include?.length || req.exclude?.length);
  sam.masks.forEach((m, k) => {
    const s = (userRefined ? 0.2 : 0.45) * iou(m, region) + (userRefined ? 0.6 : 0.35) * sam.scores[k] + 0.2 * boundaryEdgeAgreement(m, gray, w, h);
    if (s > chosenScore) {
      chosenScore = s;
      chosen = k;
    }
  });
  // SAM's mask defines the surface's extent, but not on its own: the class map's outlines are
  // too loose to subtract as-is (they would cut halos), yet its confident interiors are right.
  // So neighbouring structures' and objects' interiors are hard limits, and only the band around
  // the edges is re-decided by local colour. SAM also predicts on a 256px grid and carves blobs
  // around foliage, which the same colour band repairs.
  const otherStructural = Uint8Array.from(semantic.labelMap, (v) => (v !== labelIndex && v !== 255 && STRUCTURAL_LABELS.has(semantic.labels[v]) ? 1 : 0));
  const structuralCore = erode(otherStructural, w, h, Math.max(2, Math.round((STRUCTURAL_CORE_PX * long) / 1600)));
  // Object outlines are looser than structural ones: trust only what's a matting band deep
  const objectCore = erode(occluder, w, h, Math.max(2, Math.round(long * MATTING_BAND_FRACTION)));
  const excluded = (i: number) => structuralCore[i] === 1 || objectCore[i] === 1;
  const samMask = Uint8Array.from(sam.masks[chosen], (v, i) => (v && !excluded(i) ? 1 : 0));
  // Reference colours for "not this surface": objects in front and neighbouring structures
  const notSurface = Uint8Array.from(occluder, (v, i) => (v || structuralCore[i] ? 1 : 0));
  let surface = refineBandByColor(
    samMask,
    notSurface,
    room.image.data,
    room.image.channels,
    w,
    h,
    Math.round(long * MATTING_BAND_FRACTION),
    Math.round(long * MATTING_WINDOW_FRACTION),
    // Loose outlines may be reclaimed where the colour says wall; confident interiors never
    (i) => !excluded(i),
    // Where SAM and the class map agree is the surface's reference colour
    region
  );
  // Object outlines in the class map spill onto the wall, and those wall-coloured references
  // stop the band from reclaiming it (white blobs beside mirrors and windows). Real wall joins
  // the surface with no visible edge, so grow into it across continuous colour.
  surface = growAcrossContinuousColour(surface, room.image.data, room.image.channels, w, h, Math.round(long * MATTING_BAND_FRACTION), (i) => !excluded(i));
  for (let i = 0; i < occluder.length; i++) if (surface[i]) occluder[i] = 0;
  if (label === 'wall') removeSkirting(surface, gray, w, h);

  // 4. One plane per physical surface (a wall mask across a corner becomes two)
  const parts: Array<{ binary: Uint8Array; plane: import('../services/analysis/protocol').SurfacePartResult['plane'] }> = [];
  let planeInlierRatio = 0;
  let normalConsistency = 0;
  if (room.geometry) {
    const pm = room.geometry.pointMap;
    const toImage = (i: number) => {
      const gx = i % pm.width;
      const gy = (i - gx) / pm.width;
      return Math.min(h - 1, Math.floor(((gy + 0.5) * h) / pm.height)) * w + Math.min(w - 1, Math.floor(((gx + 0.5) * w) / pm.width));
    };
    const regionPm: number[] = [];
    for (let i = 0; i < pm.width * pm.height; i++) if (surface[toImage(i)]) regionPm.push(i);
    const planes = fitSurfacePlanes(pm, regionPm, { orientation: orientationFor(label) });
    if (planes.length) {
      planeInlierRatio = planes.reduce((s, p) => s + p.inlierRatio, 0);
      normalConsistency = planes.reduce((s, p) => s + p.normalConsistency * p.inlierRatio, 0) / Math.max(planeInlierRatio, 1e-6);
      // Each geometry cell votes for its plane; image pixels follow their cell
      const owner = new Int8Array(pm.width * pm.height).fill(-1);
      planes.forEach((p, k) => p.pixels.forEach((i) => (owner[i] = k)));
      const binaries = planes.map(() => new Uint8Array(w * h));
      for (let i = 0; i < surface.length; i++) {
        if (!surface[i]) continue;
        const x = i % w;
        const y = (i - x) / w;
        const cell = Math.min(pm.height - 1, Math.floor((y * pm.height) / h)) * pm.width + Math.min(pm.width - 1, Math.floor((x * pm.width) / w));
        const k = owner[cell] >= 0 ? owner[cell] : 0; // unexplained pixels join the main plane
        binaries[k][i] = 1;
      }
      planes.forEach((p, k) => parts.push({ binary: binaries[k], plane: { normal: p.normal, origin: p.origin, axisU: p.axisU, axisV: p.axisV, residual: p.residual } }));
    }
  }
  if (!parts.length) parts.push({ binary: surface, plane: null });

  // 5. Edge refinement at full resolution
  const radius = guideRadiusFor(w, h);
  const refined = parts.map((p) => ({ mask: guidedFilter(gray, p.binary, w, h, radius, GUIDE_EPSILON, EDGE_SHARPNESS), plane: p.plane }));
  const occluderSoft = guidedFilter(gray, occluder, w, h, radius, GUIDE_EPSILON, EDGE_SHARPNESS);

  // 6. Composite confidence (thresholds in services/qualityGate.ts)
  const confidenceInputs: ConfidenceInputs = {
    maskModelScore: sam.scores[chosen],
    semanticAgreement: iou(surface, region),
    boundaryEdgeAgreement: boundaryEdgeAgreement(surface, gray, w, h),
    planeInlierRatio: room.geometry ? planeInlierRatio : 0.5,
    normalConsistency: room.geometry ? normalConsistency : 0.5,
  };
  let covered = 0;
  for (let i = 0; i < surface.length; i++) covered += surface[i];
  return {
    label,
    width: w,
    height: h,
    parts: refined,
    occluder: occluderSoft,
    intrinsics: room.geometry?.intrinsics ?? null,
    confidence: compositeConfidence(confidenceInputs),
    confidenceInputs,
    areaPct: (covered / (w * h)) * 100,
  };
};

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  const post = (response: WorkerResponse, transfer: Transferable[] = []) => (self as unknown as Worker).postMessage(response, transfer);
  const reportStage: ReportStage = (stage) => post({ id: req.id, type: 'progress', stage });
  try {
    if (req.type === 'analyze') {
      post({ id: req.id, type: 'analyze', ...(await analyze(req.imageUrl, reportStage)) });
    } else if (req.type === 'cutObject') {
      const result = await cutObject(req, reportStage);
      post({ id: req.id, type: 'cutObject', ...result }, result.mask ? [result.mask.buffer] : []);
    } else {
      const result = await cut(req, reportStage);
      post({ id: req.id, type: 'cut', ...result }, [...result.parts.map((p) => p.mask.buffer), result.occluder.buffer]);
    }
  } catch (err) {
    post({ id: req.id, type: 'error', error: err instanceof Error ? err.message : String(err) });
  }
};
