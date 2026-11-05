import { Material, RenderableSurface } from '../types';
import { materialById } from './materials';
import { bakedItemFor, isStyled } from './stylesBaked';
import { Scene } from './types';

/**
 * The render layers for a look: each assigned item's baked parts with its finish. `drawnStyles`
 * are the design styles actually drawn into the picture being rendered, never the chosen ones
 * still loading, so the masks always match the picture under them (a style's masks over the
 * unstyled photo would paint the old fence's shape in the new one's place).
 *
 * Fences, and every AI-designed item, are recoloured rather than re-textured: the boards, gaps
 * and grain in the picture are the real fence, and a stain or paint changes their colour, not
 * their shape — a plank scan laid over them never lines up with the real boards.
 */
export const lookLayers = (
  scene: Scene,
  assignments: Record<string, string>,
  drawnStyles: Record<string, string>
): Array<{ surface: RenderableSurface; material: Material }> =>
  Object.entries(assignments).flatMap(([itemId, materialId]) => {
    const item = scene.items.find((i) => i.id === itemId);
    const material = materialById(materialId);
    const b = bakedItemFor(scene.id, itemId, drawnStyles);
    if (!item || !material || !b) return [];
    const recolor = item.role === 'fence' || isStyled(scene.id, itemId, drawnStyles);
    return b.parts.map((p) => ({ surface: { kind: item.kind, mask: p.mask, occluderMask: b.occluder, plane: p.plane, recolor }, material }));
  });
