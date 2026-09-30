import { Material, SurfaceCalibration, SurfaceGeometry, SurfaceKind } from '../types';
import { EMPTY_AREA_MESSAGE } from './areaMaskOps';
import { applyEditsToParts, clearOccluderUnder, unionMasks } from './maskCanvas';
import { renderMaterial } from './renderer/materialRenderer';

/**
 * The one rule for what an area becomes when it's accepted, saved or previewed: unedited, it is
 * exactly the cut (its parts and whole occluder); edited, the edit is split back into the parts
 * and the occluder is cleared under it. Preview, studio accept and showcase save all use this,
 * so what's previewed is what customers see.
 */
export const acceptedArea = <P extends { mask: HTMLCanvasElement }, O extends HTMLCanvasElement | null>(
  area: { parts: P[]; occluder: O },
  edited: HTMLCanvasElement,
  dirty: boolean,
  // Objects the user protected in the Area Editor: they join the occluder, restored on top
  protectedMask: HTMLCanvasElement | null = null
): { parts: P[]; occluder: O } => {
  if (!dirty) return { parts: area.parts, occluder: area.occluder };
  const cleared = area.occluder && clearOccluderUnder(area.occluder, edited);
  const occluder = protectedMask ? (cleared ? unionMasks([cleared, protectedMask]) : protectedMask) : cleared;
  return { parts: applyEditsToParts(area.parts, edited), occluder: occluder as O };
};

/** Renders a material on an area, split back into its planes, exactly as it will be saved. */
export const previewArea = (
  imageUrl: string,
  area: { kind: SurfaceKind; parts: Array<{ mask: HTMLCanvasElement; geometry: SurfaceGeometry | null }>; occluder: HTMLCanvasElement | null },
  edited: HTMLCanvasElement,
  // Whether the area was edited since it was cut or loaded (as the save path sees it)
  dirty: boolean,
  material: Material,
  // The vendor's measured scale, saved on every part — so the preview's texture scale matches
  calibration: SurfaceCalibration | null = null,
  // Objects protected in the Area Editor (restored on top, as on save)
  protectedMask: HTMLCanvasElement | null = null
): Promise<string> => {
  const { parts, occluder } = acceptedArea(area, edited, dirty, protectedMask);
  // Every part was emptied by the edit: say so, rather than the renderer's generic message
  if (!parts.length) return Promise.reject(new Error(EMPTY_AREA_MESSAGE));
  return renderMaterial(
    imageUrl,
    parts.map((p) => ({ surface: { kind: area.kind, mask: p.mask, occluderMask: occluder, plane: p.geometry, calibration }, material }))
  );
};
