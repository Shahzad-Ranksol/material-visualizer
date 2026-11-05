import { useEffect, useRef, useState } from 'react';
import { styleBake } from '../../scenes/stylesBaked';
import { sceneBakedLight, styleBakedLight } from '../../scenes/bakedLight';
import type { IntrinsicSources } from '../../services/renderer/intrinsics';
import { Scene } from '../../scenes/types';

const loadImage = async (src: string) => {
  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.src = src;
  await img.decode();
  return img;
};

/**
 * The scene's photo with every chosen design style drawn in: each style's patch over the photo at
 * its rect (its alpha already feathers inside the region, so nothing outside changes). Compositions
 * are cached per style combination.
 *
 * Returns the picture and the styles actually drawn in it (`drawn`): until the chosen combination
 * is composed (a scene switch, a new style) — or if it can't be (`error`) — that is the scene's own
 * photo with no styles, never the previous scene's picture. Masks must follow `drawn`, not the
 * chosen styles, so they always match the picture.
 *
 * `bakedLight` is that picture's baked light (scripts/intrinsic/bake.py): the scene's, with each
 * drawn style's own drawn over it the same way. Absent when the scene or a drawn style has none —
 * the renderer then recovers the light from the photo as before.
 */
type Composed = { url: string; bakedLight?: IntrinsicSources };

const toUrl = async (canvas: HTMLCanvasElement) =>
  URL.createObjectURL(await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png')));

// A base image with each style's rect image drawn over it
const compose = async (base: string, overlays: Array<{ src: string; rect: { x: number; y: number; w: number; h: number } }>) => {
  const img = await loadImage(base);
  const canvas = document.createElement('canvas');
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  for (const o of overlays) ctx.drawImage(await loadImage(o.src), o.rect.x, o.rect.y, o.rect.w, o.rect.h);
  return toUrl(canvas);
};

export const useComposedScene = (
  scene: Scene,
  styles: Record<string, string>
): { url: string; drawn: Record<string, string>; error: string | null; bakedLight?: IntrinsicSources } => {
  const cache = useRef(new Map<string, Composed>());
  const chosen = Object.entries(styles)
    .map(([groupId, optionId]) => ({ groupId, optionId, bake: styleBake(scene.id, groupId, optionId) }))
    .filter((s) => s.bake)
    .sort((a, b) => a.groupId.localeCompare(b.groupId));
  const key = `${scene.id}|${chosen.map((c) => `${c.groupId}:${c.optionId}`).join(',')}`;
  const [composed, setComposed] = useState<{ key: string; value: Composed } | null>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    if (!chosen.length || cache.current.has(key)) return;
    let cancelled = false;
    (async () => {
      const url = await compose(scene.photo, chosen.map(({ bake }) => ({ src: bake!.patch, rect: bake!.rect })));
      const base = sceneBakedLight(scene.id);
      const lights = chosen.map((c) => ({ light: styleBakedLight(scene.id, c.groupId, c.optionId), rect: c.bake!.rect }));
      let bakedLight: IntrinsicSources | undefined;
      if (base && lights.every((l) => l.light)) {
        const [shading, reflection] = await Promise.all([
          compose(base.shading, lights.map((l) => ({ src: l.light!.shading, rect: l.rect }))),
          compose(base.reflection, lights.map((l) => ({ src: l.light!.reflection, rect: l.rect }))),
        ]);
        bakedLight = { shading, reflection, shadingScale: base.shadingScale };
      }
      const value = { url, bakedLight };
      cache.current.set(key, value);
      if (!cancelled) setComposed({ key, value });
    })().catch(() => !cancelled && setFailed(key));
    return () => {
      cancelled = true;
    };
    // `key` captures the scene and the chosen styles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const none = { url: scene.photo, drawn: {}, error: null, bakedLight: sceneBakedLight(scene.id) };
  if (!chosen.length) return none;
  const value = cache.current.get(key) ?? (composed?.key === key ? composed.value : null);
  if (value) return { ...value, drawn: Object.fromEntries(chosen.map((c) => [c.groupId, c.optionId])), error: null };
  return { ...none, error: failed === key ? 'This design style could not be loaded — showing the original.' : null };
};
