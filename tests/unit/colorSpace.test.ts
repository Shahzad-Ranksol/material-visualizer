import { describe, expect, it } from 'vitest';
import { hexToLinear, linearToSrgb, srgbToLinear, SRGB8_TO_LINEAR } from '../../services/renderer/colorSpace';

describe('colour space', () => {
  it('round-trips sRGB <-> linear', () => {
    for (let v = 0; v <= 1; v += 0.05) expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 6);
  });
  it('matches the IEC 61966-2-1 reference points', () => {
    expect(srgbToLinear(0.5)).toBeCloseTo(0.2140, 4);
    expect(linearToSrgb(0.18)).toBeCloseTo(0.4614, 3);
    expect(SRGB8_TO_LINEAR[255]).toBe(1);
    expect(SRGB8_TO_LINEAR[0]).toBe(0);
  });
  it('parses joint colours to linear RGB', () => {
    expect(hexToLinear('#ffffff')).toEqual([1, 1, 1]);
    expect(hexToLinear('#000000')).toEqual([0, 0, 0]);
    expect(hexToLinear('nope')).toHaveLength(3);
  });
});
