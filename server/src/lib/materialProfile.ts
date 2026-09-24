import { z } from 'zod';

// Physical profile of a material: the real size its photo (albedo) represents and how it
// repeats. The renderer lays materials out from these values — never from pixel sizes.
export const REPEAT_MODES = ['seamless', 'sheet', 'tile', 'plank', 'bookmatch', 'none'] as const;

const optionalUrl = z.string().url().max(2048).regex(/^https?:\/\//i, 'Must be an http(s) URL').nullable().optional();

export const materialProfileSchema = z.object({
  realWidthMm: z.number().min(1).max(100000),
  realHeightMm: z.number().min(1).max(100000).nullable(),
  repeatMode: z.enum(REPEAT_MODES),
  orientationDeg: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  jointWidthMm: z.number().min(0).max(100).nullable(),
  jointColor: z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Must be a #rrggbb colour').nullable(),
  roughness: z.number().min(0).max(1),
  metallic: z.number().min(0).max(1),
  normalStrength: z.number().min(0).max(1),
  albedoUrl: optionalUrl,
  normalUrl: optionalUrl,
  roughnessUrl: optionalUrl,
  heightUrl: optionalUrl,
});

export type MaterialProfile = z.infer<typeof materialProfileSchema>;

/**
 * Sensible starting profile for a category. Vendors should replace the size with the real
 * dimensions their photo shows; these only avoid wildly wrong scale for untouched records.
 * Mirrored in the frontend's services/materialProfile.ts.
 */
export const defaultProfileFor = (category: string, finishText = ''): MaterialProfile => {
  const finish = finishText.toLowerCase();
  const base: MaterialProfile = {
    realWidthMm: 600,
    realHeightMm: null,
    repeatMode: 'seamless',
    orientationDeg: 0,
    jointWidthMm: null,
    jointColor: null,
    roughness: 0.5,
    metallic: 0,
    normalStrength: 0.3,
    albedoUrl: null,
    normalUrl: null,
    roughnessUrl: null,
    heightUrl: null,
  };
  switch (category) {
    case 'sheet':
      Object.assign(base, { realWidthMm: 1220, realHeightMm: 2440, repeatMode: 'sheet', jointWidthMm: 3, jointColor: '#2a1e14' });
      break;
    case 'tile':
      Object.assign(base, { realWidthMm: 600, realHeightMm: 600, repeatMode: 'tile', jointWidthMm: 3, jointColor: '#d9d4cc' });
      break;
    case 'stone':
      base.realWidthMm = 1200;
      break;
    case 'metal':
      Object.assign(base, { metallic: 0.8, roughness: 0.35 });
      break;
    case 'carpet':
    case 'fabric':
    case 'plaster':
    case 'paint':
      base.roughness = 0.9;
      break;
  }
  if (/gloss|lacquer|mirror|polished/.test(finish)) base.roughness = 0.15;
  else if (/satin|silk|sheen/.test(finish) && category !== 'metal') base.roughness = 0.35;
  return base;
};
