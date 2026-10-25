import { useEffect, useState } from 'react';
import { AlphaMask } from '../../services/areaMaskOps';
import { canvasToAlphaMask, loadMaskAsAlpha, scaleMaskCanvas, unionMasks } from '../../services/maskCanvas';
import { bakedItemFor } from '../../scenes/stylesBaked';
import { Scene } from '../../scenes/types';

// Width the item masks are kept at for hover hit-testing and the selection overlay
const OVERLAY_WIDTH = 800;

export interface ItemMask {
  id: string;
  mask: AlphaMask;
  area: number;
}

/** Every baked item of a scene (in its chosen design style) as one downscaled mask, for hit-testing and highlights. */
export const useSceneMasks = (scene: Scene, styles: Record<string, string> = {}): ItemMask[] => {
  const [masks, setMasks] = useState<ItemMask[]>([]);
  useEffect(() => {
    let cancelled = false;
    setMasks([]);
    Promise.all(
      scene.items
        .filter((item) => bakedItemFor(scene.id, item.id, styles))
        .map(async (item) => {
          const full = unionMasks(await Promise.all(bakedItemFor(scene.id, item.id, styles)!.parts.map((p) => loadMaskAsAlpha(p.mask))));
          const h = Math.round((full.height * OVERLAY_WIDTH) / full.width);
          const mask = canvasToAlphaMask(scaleMaskCanvas(full, OVERLAY_WIDTH, h));
          let area = 0;
          for (const a of mask.alpha) if (a > 127) area++;
          return { id: item.id, mask, area };
        })
    )
      .then((m) => !cancelled && setMasks(m))
      .catch(() => !cancelled && setMasks([]));
    return () => {
      cancelled = true;
    };
  }, [scene, JSON.stringify(styles)]); // eslint-disable-line react-hooks/exhaustive-deps
  return masks;
};
