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
    }
  | { id: number; type: 'cutObject'; imageUrl: string; point: { xPct: number; yPct: number } };

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
    }
  | { id: number; type: 'cutObject'; width: number; height: number; mask: Uint8Array | null }
  | { id: number; type: 'error'; error: string }
  // Sent while a request runs; the final response follows
  | { id: number; type: 'progress'; stage: AnalysisStage };

export type AnalysisStage = 'loading-photo' | 'surfaces' | 'geometry' | 'refining' | 'from-cache';

export const STAGE_LABELS: Record<AnalysisStage, string> = {
  'loading-photo': 'Loading the photo…',
  surfaces: 'Detecting walls, floors and ceilings…',
  geometry: 'Estimating 3D geometry…',
  refining: 'Refining the surface outline…',
  'from-cache': 'Using the saved analysis of this photo…',
};
