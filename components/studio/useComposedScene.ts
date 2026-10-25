import { useEffect, useRef, useState } from 'react';
import { styleBake } from '../../scenes/stylesBaked';
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
 * its rect (its alpha already feathers inside the region, so nothing outside changes). Returns
 * the photo itself when no style is chosen. Compositions are cached per style combination.
 */
export const useComposedScene = (scene: Scene, styles: Record<string, string>) => {
  const cache = useRef(new Map<string, string>());
  const chosen = Object.entries(styles)
    .map(([groupId, optionId]) => ({ groupId, optionId, bake: styleBake(scene.id, groupId, optionId) }))
    .filter((s) => s.bake)
    .sort((a, b) => a.groupId.localeCompare(b.groupId));
  const key = `${scene.id}|${chosen.map((c) => `${c.groupId}:${c.optionId}`).join(',')}`;
  const [url, setUrl] = useState<string>(scene.photo);

  useEffect(() => {
    if (!chosen.length) {
      setUrl(scene.photo);
      return;
    }
    const hit = cache.current.get(key);
    if (hit) {
      setUrl(hit);
      return;
    }
    let cancelled = false;
    (async () => {
      const photo = await loadImage(scene.photo);
      const canvas = document.createElement('canvas');
      canvas.width = photo.naturalWidth;
      canvas.height = photo.naturalHeight;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(photo, 0, 0);
      for (const { bake } of chosen) ctx.drawImage(await loadImage(bake!.patch), bake!.rect.x, bake!.rect.y, bake!.rect.w, bake!.rect.h);
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/png'));
      const out = URL.createObjectURL(blob);
      cache.current.set(key, out);
      if (!cancelled) setUrl(out);
    })().catch(() => !cancelled && setUrl(scene.photo));
    return () => {
      cancelled = true;
    };
    // `key` captures the scene and the chosen styles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return url;
};
