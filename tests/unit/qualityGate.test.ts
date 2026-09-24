import { describe, expect, it } from 'vitest';
import { compositeConfidence, CONFIDENCE_WEIGHTS, reviewDecision } from '../../services/qualityGate';

describe('quality gate', () => {
  it('weights sum to one (a perfect surface scores 1)', () => {
    expect(Object.values(CONFIDENCE_WEIGHTS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
    expect(
      compositeConfidence({ maskModelScore: 1, semanticAgreement: 1, boundaryEdgeAgreement: 1, planeInlierRatio: 1, normalConsistency: 1 })
    ).toBeCloseTo(1, 9);
  });
  it('follows the documented formula and clamps inputs', () => {
    const c = compositeConfidence({ maskModelScore: 0.9, semanticAgreement: 0.8, boundaryEdgeAgreement: 0.5, planeInlierRatio: 2, normalConsistency: NaN });
    expect(c).toBeCloseTo(0.3 * 0.9 + 0.2 * 0.8 + 0.2 * 0.5 + 0.2 * 1 + 0.1 * 0, 9);
  });
  it('maps confidence to the three review decisions', () => {
    expect(reviewDecision(0.9)).toBe('auto');
    expect(reviewDecision(0.85)).toBe('auto');
    expect(reviewDecision(0.7)).toBe('confirm');
    expect(reviewDecision(0.6)).toBe('correct');
  });
});
