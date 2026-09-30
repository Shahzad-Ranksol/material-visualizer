import { describe, expect, it } from 'vitest';
import { attribute, calibrate, decisionOutcome, lastTransition, scoreMasks } from '../../services/validation/metrics';
import { CUT_STAGES, CutStage } from '../../services/analysis/protocol';

const W = 20;
const H = 10;
const rect = (x0: number, x1: number) => Uint8Array.from({ length: W * H }, (_, i) => (i % W >= x0 && i % W < x1 ? 1 : 0));

describe('scoreMasks', () => {
  it('is perfect for identical masks', () => {
    const m = rect(5, 15);
    expect(scoreMasks(m, m, W, H)).toMatchObject({ coverage: 1, leak: 0, iou: 1, boundaryF: 1 });
  });

  it('measures coverage and leak against the approved area', () => {
    // approved 10 columns; predicted 8 of them plus 2 outside
    const s = scoreMasks(rect(7, 17), rect(5, 15), W, H);
    expect(s.coverage).toBeCloseTo(0.8, 9);
    expect(s.leak).toBeCloseTo(0.2, 9);
    expect(s.iou).toBeCloseTo(80 / 120, 9);
  });

  it('forgives boundary offsets within the tolerance', () => {
    expect(scoreMasks(rect(6, 16), rect(5, 15), W, H, 2).boundaryF).toBe(1);
    expect(scoreMasks(rect(9, 19), rect(5, 15), W, H, 2).boundaryF).toBeLessThan(0.5);
  });

  it('is zero, not NaN, when nothing is approved', () => {
    const none = new Uint8Array(W * H);
    expect(scoreMasks(rect(0, 5), none, W, H)).toMatchObject({ coverage: 0, iou: 0 });
  });
});

describe('stage attribution', () => {
  const stages = Object.fromEntries(CUT_STAGES.map((s) => [s, rect(0, 10)])) as Record<CutStage, Uint8Array>;
  // SAM also took columns 10-12; the band step dropped column 9
  stages.samRaw = rect(0, 13);
  for (const s of CUT_STAGES.slice(CUT_STAGES.indexOf('samAfterExclusions'))) stages[s] = rect(0, 13);
  for (const s of CUT_STAGES.slice(CUT_STAGES.indexOf('bandRefined'))) stages[s] = Uint8Array.from(rect(0, 13), (v, i) => (i % W === 9 ? 0 : v));

  it('names the stage that last changed a pixel', () => {
    expect(lastTransition(stages, 5 * W + 11, 1)).toBe('samRaw');
    expect(lastTransition(stages, 5 * W + 9, 0)).toBe('bandRefined');
  });

  it('counts misses and leaks by stage', () => {
    const r = attribute(stages, stages.onPlane, rect(0, 10));
    expect(r.missedBy).toEqual({ bandRefined: H });
    expect(r.leakedBy).toEqual({ samRaw: 3 * H });
  });
});

describe('decisions and calibration', () => {
  it('flags a bad mask marked auto, and a good one sent to correction', () => {
    expect(decisionOutcome('auto', 0.95)).toBe('ok');
    expect(decisionOutcome('auto', 0.7)).toBe('false-auto');
    expect(decisionOutcome('correct', 0.95)).toBe('needless-correction');
    expect(decisionOutcome('confirm', 0.5)).toBe('ok');
  });

  it('reports autos and false autos per threshold', () => {
    const rows = [
      { confidence: 0.9, iou: 0.95 },
      { confidence: 0.86, iou: 0.6 },
      { confidence: 0.7, iou: 0.95 },
    ];
    expect(calibrate(rows, [0.85, 0.9])).toEqual([
      { threshold: 0.85, auto: 2, falseAuto: 1 },
      { threshold: 0.9, auto: 1, falseAuto: 0 },
    ]);
  });
});
