import { describe, expect, it } from 'vitest';
import { layerAlpha } from '../../services/renderer/materialRenderer';

describe('layerAlpha', () => {
  it('is the mask with occluders restored on top', () => {
    expect(layerAlpha(1, 0)).toBe(1);
    expect(layerAlpha(0, 0)).toBe(0); // outside the mask: never painted
    expect(layerAlpha(1, 1)).toBe(0); // an occluder in front: never painted
    expect(layerAlpha(0.5, 0.5)).toBeCloseTo(0.25, 9); // soft edges multiply
  });
});
