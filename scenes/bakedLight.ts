import json from './intrinsics.json';
import { withAssetUrls } from './assetUrl';
import type { IntrinsicSources } from '../services/renderer/intrinsics';
import { styleKey } from './styles';

// Written by scripts/intrinsic/bake.py (npm run scenes:intrinsic): each scene photo's baked light,
// and each design style's, for its rect on the photo with the patch drawn in (with the patch's alpha)
interface SceneLight {
  shading?: string;
  reflection?: string;
  shadingScale?: number;
  size?: [number, number];
  styles?: Record<string, { shading: string; reflection: string }>;
}
const LIGHT = withAssetUrls(json as unknown as Record<string, SceneLight>);

export const sceneBakedLight = (sceneId: string): IntrinsicSources | undefined => {
  const s = LIGHT[sceneId];
  return s?.shading && s.reflection && s.shadingScale ? { shading: s.shading, reflection: s.reflection, shadingScale: s.shadingScale } : undefined;
};

/**
 * A drawn style's baked light for its rect (stored at the scene's shading scale), or undefined
 * when it has none (its picture then has no baked light).
 */
export const styleBakedLight = (sceneId: string, groupId: string, optionId: string): { shading: string; reflection: string } | undefined =>
  LIGHT[sceneId]?.styles?.[styleKey(groupId, optionId)];
