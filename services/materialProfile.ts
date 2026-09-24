import { Material } from '../types';

export type PhysicalProfile = Pick<
  Material,
  'realWidthMm' | 'realHeightMm' | 'repeatMode' | 'orientationDeg' | 'jointWidthMm' | 'jointColor' | 'roughness' | 'metallic' | 'normalStrength'
>;

/**
 * Starting physical profile for a material category (mirrors server/src/lib/materialProfile.ts).
 * Vendors should set the real size their photo shows; these only avoid wildly wrong scale.
 */
export const defaultProfileFor = (category: string, finishText = ''): PhysicalProfile => {
  const finish = finishText.toLowerCase();
  const base: PhysicalProfile = {
    realWidthMm: 600,
    realHeightMm: null,
    repeatMode: 'seamless',
    orientationDeg: 0,
    jointWidthMm: null,
    jointColor: null,
    roughness: 0.5,
    metallic: 0,
    normalStrength: 0.3,
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
