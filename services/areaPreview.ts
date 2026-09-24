import { Material, SurfaceCalibration, SurfaceGeometry, SurfaceKind } from '../types';
import { EMPTY_AREA_MESSAGE } from './areaMaskOps';
import { applyEditsToParts, clearOccluderUnder } from './maskCanvas';
import { renderMaterial } from './renderer/materialRenderer';

/** Renders a material on an edited area, split back into its planes, exactly as it will be saved. */
export const previewArea = (
  imageUrl: string,
  area: { kind: SurfaceKind; parts: Array<{ mask: HTMLCanvasElement; geometry: SurfaceGeometry | null }>; occluder: HTMLCanvasElement | null },
  edited: HTMLCanvasElement,
  material: Material,
  // The vendor's measured scale, saved on every part — so the preview's texture scale matches
  calibration: SurfaceCalibration | null = null
): Promise<string> => {
  const parts = applyEditsToParts(area.parts, edited);
  // Every part was emptied by the edit: say so, rather than the renderer's generic message
  if (!parts.length) return Promise.reject(new Error(EMPTY_AREA_MESSAGE));
  const occluder = area.occluder ? clearOccluderUnder(area.occluder, edited) : null;
  return renderMaterial(
    imageUrl,
    parts.map((p) => ({ surface: { kind: area.kind, mask: p.mask, occluderMask: occluder, plane: p.geometry, calibration }, material }))
  );
};
