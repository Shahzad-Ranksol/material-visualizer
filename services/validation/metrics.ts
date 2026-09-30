import { CUT_STAGES, CutStage } from '../analysis/protocol';
import type { ReviewDecision } from '../qualityGate';

/** Scoring a predicted surface mask against a person-approved one (validation set). */
export interface MaskScore {
  coverage: number; // approved pixels covered ÷ approved
  leak: number; // predicted pixels outside the approved area ÷ approved
  iou: number;
  boundaryF: number; // boundary pixels matched within the tolerance (F1)
  approvedPct: number; // approved area, % of the photo
  predictedPct: number;
}

// Below this IoU an area needs a person: marked 'auto' it would reach customers unchecked
export const FALSE_AUTO_IOU = 0.9;

// Mask pixels next to a pixel outside the mask. Where the photo's frame cuts a surface isn't a
// segmentation boundary, so the image border never counts.
const boundary = (m: Uint8Array, w: number, h: number) => {
  const out = new Uint8Array(m.length);
  for (let i = 0; i < m.length; i++) {
    if (!m[i]) continue;
    const x = i % w;
    const y = (i - x) / w;
    if ((x > 0 && !m[i - 1]) || (x < w - 1 && !m[i + 1]) || (y > 0 && !m[i - w]) || (y < h - 1 && !m[i + w])) out[i] = 1;
  }
  return out;
};

// Share of `from`'s boundary pixels with a boundary pixel of `to` within r (Chebyshev)
const matched = (from: Uint8Array, to: Uint8Array, w: number, h: number, r: number) => {
  let total = 0;
  let hit = 0;
  for (let i = 0; i < from.length; i++) {
    if (!from[i]) continue;
    total++;
    const x = i % w;
    const y = (i - x) / w;
    search: for (let dy = -r; dy <= r; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -r; dx <= r; dx++) {
        const xx = x + dx;
        if (xx >= 0 && xx < w && to[yy * w + xx]) {
          hit++;
          break search;
        }
      }
    }
  }
  return total ? hit / total : 1;
};

export const scoreMasks = (predicted: Uint8Array, approved: Uint8Array, w: number, h: number, tolerancePx = 2): MaskScore => {
  let a = 0;
  let p = 0;
  let both = 0;
  for (let i = 0; i < approved.length; i++) {
    if (approved[i]) a++;
    if (predicted[i]) p++;
    if (approved[i] && predicted[i]) both++;
  }
  const n = w * h;
  const union = a + p - both;
  const pb = boundary(predicted, w, h);
  const ab = boundary(approved, w, h);
  const precision = matched(pb, ab, w, h, tolerancePx);
  const recall = matched(ab, pb, w, h, tolerancePx);
  return {
    coverage: a ? both / a : 0,
    leak: a ? (p - both) / a : 0,
    iou: union ? both / union : 0,
    boundaryF: a && p ? (2 * precision * recall) / (precision + recall || 1) : 0,
    approvedPct: (a / n) * 100,
    predictedPct: (p / n) * 100,
  };
};

/** The stage that last made pixel i equal `wanted` (SAM leaving a surface pixel out counts as samRaw). */
export const lastTransition = (stages: Record<CutStage, Uint8Array>, i: number, wanted: 0 | 1): CutStage => {
  for (let k = CUT_STAGES.length - 1; k >= 1; k--) {
    const now = stages[CUT_STAGES[k]][i] ? 1 : 0;
    const before = stages[CUT_STAGES[k - 1]][i] ? 1 : 0;
    if (now === wanted && before !== wanted) return CUT_STAGES[k];
  }
  return 'samRaw';
};

/** Pixel counts of missed and leaked pixels, by the stage that last removed or added them. */
export const attribute = (stages: Record<CutStage, Uint8Array>, predicted: Uint8Array, approved: Uint8Array) => {
  const missedBy: Record<string, number> = {};
  const leakedBy: Record<string, number> = {};
  for (let i = 0; i < approved.length; i++) {
    if (approved[i] && !predicted[i]) {
      const s = lastTransition(stages, i, 0);
      missedBy[s] = (missedBy[s] ?? 0) + 1;
    } else if (!approved[i] && predicted[i]) {
      const s = lastTransition(stages, i, 1);
      leakedBy[s] = (leakedBy[s] ?? 0) + 1;
    }
  }
  return { missedBy, leakedBy };
};

export const decisionOutcome = (decision: ReviewDecision, iou: number): 'ok' | 'false-auto' | 'needless-correction' =>
  decision === 'auto' && iou < FALSE_AUTO_IOU ? 'false-auto' : decision === 'correct' && iou >= FALSE_AUTO_IOU ? 'needless-correction' : 'ok';

/** For each candidate 'auto' threshold: how many surfaces would be auto, and how many of those wrongly. */
export const calibrate = (rows: Array<{ confidence: number; iou: number }>, thresholds = [0.75, 0.8, 0.85, 0.9, 0.95]) =>
  thresholds.map((threshold) => {
    const auto = rows.filter((r) => r.confidence >= threshold);
    return { threshold, auto: auto.length, falseAuto: auto.filter((r) => r.iou < FALSE_AUTO_IOU).length };
  });
