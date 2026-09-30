import type { CameraIntrinsics, Vec3 } from '../../types';
import type { ConfidenceInputs } from '../qualityGate';

// Shared between the page and the analysis worker. Deliberately free of model/runtime imports,
// so importing it on the main thread never pulls the ML stack into the page bundle.

export const SEMANTIC_MODEL = 'Xenova/segformer-b2-finetuned-ade-512-512';
export const PROMPT_MODEL = 'onnx-community/sam2.1-hiera-tiny-ONNX';
export const GEOMETRY_MODEL = 'Ruicheng/moge-2-vits-normal-onnx';

export const ANALYSIS_VERSION = 'segformer-b2+sam2.1-tiny+moge2-vits@1';
export const MODEL_VERSIONS = { semantic: SEMANTIC_MODEL, prompt: PROMPT_MODEL, geometry: GEOMETRY_MODEL };

export interface SurfaceProposal {
  id: string;
  label: string;
  areaPct: number;
  anchor: { xPct: number; yPct: number };
}

export interface SurfacePartResult {
  mask: Uint8Array; // 0-255, full resolution
  plane: { normal: Vec3; origin: Vec3; axisU: Vec3; axisV: Vec3; residual: number } | null;
}

export type WorkerRequest =
  | { id: number; type: 'analyze'; imageUrl: string }
  | {
      id: number;
      type: 'cut';
      imageUrl: string;
      point: { xPct: number; yPct: number };
      label?: string;
      connectedOnly: boolean;
      include?: Array<{ xPct: number; yPct: number }>;
      exclude?: Array<{ xPct: number; yPct: number }>;
      // Also return every pipeline stage's mask (developer view, evidence runs)
      debugStages?: boolean;
    }
  | { id: number; type: 'cutObject'; imageUrl: string; point: { xPct: number; yPct: number } }
  // Stop job `target` at its next step boundary (it then sends nothing more)
  | { id: number; type: 'cancel'; target: number };

export type WorkerResponse =
  | {
      id: number;
      type: 'analyze';
      width: number;
      height: number;
      labels: string[];
      proposals: SurfaceProposal[];
      warnings: string[];
      geometryAvailable: boolean;
      fromCache: boolean;
    }
  | {
      id: number;
      type: 'cut';
      label: string;
      width: number;
      height: number;
      parts: SurfacePartResult[];
      occluder: Uint8Array;
      intrinsics: CameraIntrinsics | null;
      confidence: number;
      confidenceInputs: ConfidenceInputs;
      areaPct: number;
      // Plain-language reasons a person should check this area, whatever the confidence says
      reviewReasons: string[];
      stages?: CutStages;
    }
  // `surfaceShare`: the share of the object the class map calls a room surface (a shadow is mostly surface)
  | { id: number; type: 'cutObject'; width: number; height: number; mask: Uint8Array | null; surfaceShare: number }
  | { id: number; type: 'error'; error: string }
  // Sent while a request runs; the final response follows
  | { id: number; type: 'progress'; stage: AnalysisStage };

/**
 * A surface cut's pipeline, one binary (0/1) mask per stage at photo size, each the whole
 * surface as that stage left it (diff two neighbours to see what a stage added or removed).
 */
export const CUT_STAGES = ['classCandidate', 'samRaw', 'samAfterExclusions', 'bandRefined', 'body', 'grown', 'skirtingRemoved', 'onPlane'] as const;
export type CutStage = (typeof CUT_STAGES)[number];
export const CUT_STAGE_LABELS: Record<CutStage, string> = {
  classCandidate: 'SegFormer surface candidate',
  samRaw: "SAM's mask",
  samAfterExclusions: 'SAM minus other surfaces/objects',
  bandRefined: 'Edge band re-decided by colour',
  body: 'Body (specks dropped)',
  grown: 'Grown across continuous colour',
  skirtingRemoved: 'Skirting removed',
  onPlane: 'Off-plane pixels removed',
};
export interface CutStages {
  masks: Record<CutStage, Uint8Array>;
  // Objects restored on top (binary, before edge refinement), and the class map
  occluder: Uint8Array;
  labelMap: Uint8Array;
  labels: string[];
}

export type AnalysisStage = 'loading-photo' | 'surfaces' | 'geometry' | 'refining' | 'from-cache';

export const STAGE_LABELS: Record<AnalysisStage, string> = {
  'loading-photo': 'Loading the photo…',
  surfaces: 'Detecting walls, floors and ceilings…',
  geometry: 'Estimating 3D geometry…',
  refining: 'Refining the surface outline…',
  'from-cache': 'Using the saved analysis of this photo…',
};
