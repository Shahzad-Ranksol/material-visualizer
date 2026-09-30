import { describe, expect, it } from 'vitest';
import { maskFitsPhoto } from '../../services/renderer/materialRenderer';

describe('maskFitsPhoto', () => {
  it('accepts the same size, or the same shape at another resolution', () => {
    expect(maskFitsPhoto(1600, 1200, 1600, 1200)).toBe(true);
    expect(maskFitsPhoto(800, 600, 1600, 1200)).toBe(true);
    expect(maskFitsPhoto(1600, 1067, 2400, 1600)).toBe(true); // rounding within a pixel
  });
  it('rejects a rotated decode or a photo of another shape', () => {
    expect(maskFitsPhoto(1600, 1200, 1200, 1600)).toBe(false); // EXIF rotation mismatch
    expect(maskFitsPhoto(1600, 1200, 1600, 900)).toBe(false); // a replaced photo
  });
});
