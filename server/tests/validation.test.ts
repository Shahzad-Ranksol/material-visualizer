import { describe, expect, it } from 'vitest';
import { defaultProfileFor, materialProfileSchema } from '../src/lib/materialProfile.js';
import { hotspotSchema, planeSchema, surfaceSchema } from '../src/lib/showcaseSchemas.js';

const surface = {
  kind: 'wall',
  label: 'Feature wall',
  maskUrl: 'https://cdn.example.com/tenants/t1/showcase/a.png',
  analysisVersion: 'v1',
  confidence: 0.8,
  needsReview: false,
};

describe('surface validation', () => {
  it('accepts a surface with a fitted 3D plane or a four-corner fallback', () => {
    expect(planeSchema.safeParse({ normal: [0, 0, -1], origin: [0, 0, 5], axisU: [1, 0, 0], axisV: [0, 1, 0] }).success).toBe(true);
    const corners = [{ xPct: 0, yPct: 0 }, { xPct: 100, yPct: 0 }, { xPct: 100, yPct: 100 }, { xPct: 0, yPct: 100 }];
    expect(planeSchema.safeParse({ homographyFallback: { corners, heightMm: 2700 } }).success).toBe(true);
  });
  it('rejects a plane with neither', () => {
    expect(planeSchema.safeParse({ residual: 0.01 }).success).toBe(false);
  });
  it('requires http(s) mask URLs and a confidence in [0, 1]', () => {
    expect(surfaceSchema.safeParse(surface).success).toBe(true);
    expect(surfaceSchema.safeParse({ ...surface, maskUrl: 'javascript:alert(1)' }).success).toBe(false);
    expect(surfaceSchema.safeParse({ ...surface, confidence: 1.5 }).success).toBe(false);
    expect(surfaceSchema.safeParse({ ...surface, kind: 'roof' }).success).toBe(false);
  });
  it('lets a hotspot link, relink or unlink a surface', () => {
    const hotspot = { label: 'Wall', xPct: 50, yPct: 40, allowedCategories: ['sheet'] };
    expect(hotspotSchema.safeParse({ ...hotspot, surfaceId: 'abc' }).success).toBe(true);
    expect(hotspotSchema.safeParse({ ...hotspot, surfaceId: null }).success).toBe(true);
    expect(hotspotSchema.safeParse({ ...hotspot, xPct: 120 }).success).toBe(false);
  });
});

describe('material physical profile', () => {
  it('produces valid defaults for every category', () => {
    for (const c of ['sheet', 'tile', 'wood', 'stone', 'metal', 'carpet', 'fabric', 'plaster', 'paint', 'wallpaper']) {
      expect(materialProfileSchema.safeParse(defaultProfileFor(c)).success).toBe(true);
    }
  });
  it('rejects impossible sizes and unknown repeat modes', () => {
    const base = defaultProfileFor('sheet');
    expect(materialProfileSchema.safeParse({ ...base, realWidthMm: 0 }).success).toBe(false);
    expect(materialProfileSchema.safeParse({ ...base, repeatMode: 'spiral' }).success).toBe(false);
    expect(materialProfileSchema.safeParse({ ...base, jointColor: 'brown' }).success).toBe(false);
  });
});
