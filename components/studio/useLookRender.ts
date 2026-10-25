import { useEffect, useRef, useState } from 'react';
import { renderMaterial } from '../../services/renderer/materialRenderer';
import { bakedItemFor, isStyled } from '../../scenes/stylesBaked';
import { materialById } from '../../scenes/materials';
import { lookKey } from '../../scenes/studioState';
import { Scene } from '../../scenes/types';

// Looks already rendered this session; switching back to one is instant
const CACHE_LIMIT = 24;

/**
 * Renders the scene — `photoUrl`, the photo with any design styles drawn in — with every assigned
 * item's finish as layers in one renderMaterial() call. The baked masks and planes (the chosen
 * style's own, where it has them) are all it needs; no model runs. Null url = the photo unfinished.
 */
export const useLookRender = (scene: Scene, assignments: Record<string, string>, styles: Record<string, string>, photoUrl: string) => {
  const cache = useRef(new Map<string, string>());
  const [url, setUrl] = useState<string | null>(null);
  const [rendering, setRendering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = `${lookKey({ sceneId: scene.id, assignments, styles })}|${photoUrl}`;

  useEffect(() => {
    setError(null);
    const layers = Object.entries(assignments).flatMap(([itemId, materialId]) => {
      const item = scene.items.find((i) => i.id === itemId);
      const material = materialById(materialId);
      const b = bakedItemFor(scene.id, itemId, styles);
      if (!item || !material || !b) return [];
      const recolor = isStyled(scene.id, itemId, styles);
      return b.parts.map((p) => ({ surface: { kind: item.kind, mask: p.mask, occluderMask: b.occluder, plane: p.plane, recolor }, material }));
    });
    if (!layers.length) {
      // Nothing finished: the photo, with any design styles drawn in
      setUrl(photoUrl === scene.photo ? null : photoUrl);
      setRendering(false);
      return;
    }
    const hit = cache.current.get(key);
    if (hit) {
      // Most recently used goes last, so eviction never drops the look on screen
      cache.current.delete(key);
      cache.current.set(key, hit);
      setUrl(hit);
      setRendering(false);
      return;
    }
    let cancelled = false;
    setRendering(true);
    renderMaterial(photoUrl, layers)
      .then((out) => {
        cache.current.set(key, out);
        if (cache.current.size > CACHE_LIMIT) {
          const [oldest, oldUrl] = cache.current.entries().next().value!;
          cache.current.delete(oldest);
          if (oldUrl !== out) URL.revokeObjectURL(oldUrl);
        }
        if (!cancelled) setUrl(out);
      })
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : 'This finish could not be shown.'))
      .finally(() => !cancelled && setRendering(false));
    return () => {
      cancelled = true;
    };
    // `key` captures the scene and every assignment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return { url, rendering, error };
};
