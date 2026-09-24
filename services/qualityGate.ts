/**
 * Production confidence for an analysed surface (rendering plan, "Confidence and automatic
 * fallback rules"). A model's own score is not accuracy; this combines independent signals.
 * The thresholds are starting values — calibrate them on the validation set (validation/).
 */
export interface ConfidenceInputs {
  maskModelScore: number; // SAM's predicted IoU for the chosen mask
  semanticAgreement: number; // IoU between the SAM mask and the semantic proposal
  boundaryEdgeAgreement: number; // share of the mask boundary on real image edges
  planeInlierRatio: number; // share of the surface's 3D points on its fitted plane(s)
  normalConsistency: number; // agreement of per-pixel normals with the plane
}

export const CONFIDENCE_WEIGHTS: Record<keyof ConfidenceInputs, number> = {
  maskModelScore: 0.3,
  semanticAgreement: 0.2,
  boundaryEdgeAgreement: 0.2,
  planeInlierRatio: 0.2,
  normalConsistency: 0.1,
};

export const CONFIDENCE_THRESHOLDS = {
  // At or above: render automatically
  auto: 0.85,
  // Between review and auto: render, but ask the user to confirm; below review: correct first
  review: 0.65,
};

export type ReviewDecision = 'auto' | 'confirm' | 'correct';

const clamp01 = (v: number) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0));

export const compositeConfidence = (c: ConfidenceInputs): number =>
  (Object.keys(CONFIDENCE_WEIGHTS) as Array<keyof ConfidenceInputs>).reduce((sum, k) => sum + CONFIDENCE_WEIGHTS[k] * clamp01(c[k]), 0);

export const reviewDecision = (confidence: number): ReviewDecision =>
  confidence >= CONFIDENCE_THRESHOLDS.auto ? 'auto' : confidence >= CONFIDENCE_THRESHOLDS.review ? 'confirm' : 'correct';
