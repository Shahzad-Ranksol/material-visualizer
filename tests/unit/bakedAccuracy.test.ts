import { describe, expect, it } from 'vitest';
import { composedPhoto, effectiveMask, loadRgba, Rgba } from '../../scripts/bakedPixels';
import { SCENE_QA } from '../../scenes/qa';
import { BAKED } from '../../scenes/baked';
import { STYLE_BAKED } from '../../scenes/stylesBaked';
import { sceneById } from '../../scenes/scenes';
import { inColourRange } from '../../scenes/recipeMask';
import { BakedItem } from '../../scenes/types';

// The committed bake against the photos: every checked item paints where it should and nowhere
// else (scenes/qa.ts). Fails when a mask leaks onto what's behind or in front of an item, or
// misses part of it — re-bake or refine (npm run scenes:refine) and review with npm run scenes:qa.

const resolve = async (key: string): Promise<{ item: BakedItem; photo: Rgba } | null> => {
  const [sceneId, ...rest] = key.split('/');
  const scene = sceneById(sceneId)!;
  if (rest.length === 1) {
    const item = BAKED[scene.id]?.items[rest[0]];
    return item ? { item, photo: await loadRgba(scene.photo) } : null;
  }
  const bake = STYLE_BAKED[scene.id]?.[rest[0]];
  const item = bake?.items[rest[1]];
  return bake && item ? { item, photo: await composedPhoto(scene.photo, bake) } : null;
};

describe('baked item accuracy', () => {
  for (const [key, qa] of Object.entries(SCENE_QA)) {
    (qa.knownIssue ? it.fails : it)(qa.knownIssue ? `${key} (known issue: ${qa.knownIssue})` : key, async () => {
      const found = await resolve(key);
      expect(found, `${key} is not baked`).not.toBeNull();
      const { item, photo } = found!;
      const { width: w, height: h, data } = photo;
      const mask = await effectiveMask(item, w, h);
      const problems: string[] = [];
      for (const [x, y] of qa.include ?? []) if (mask[y * w + x] < 0.5) problems.push(`(${x}, ${y}) should be painted, alpha ${mask[y * w + x].toFixed(2)}`);
      for (const [x, y] of qa.exclude ?? []) if (mask[y * w + x] > 0.1) problems.push(`(${x}, ${y}) must not be painted, alpha ${mask[y * w + x].toFixed(2)}`);
      if (qa.foreign) {
        let painted = 0;
        let foreign = 0;
        for (let i = 0; i < w * h; i++) {
          if (mask[i] < 0.5) continue;
          painted++;
          if (qa.foreign.some((r) => inColourRange(data, i * 4, r))) foreign++;
        }
        const share = foreign / Math.max(1, painted);
        if (share > (qa.maxForeign ?? 0)) problems.push(`${(share * 100).toFixed(2)}% of its ${painted} painted px are foreign (max ${((qa.maxForeign ?? 0) * 100).toFixed(2)}%)`);
      }
      expect(problems, key).toEqual([]);
    });
  }
});
