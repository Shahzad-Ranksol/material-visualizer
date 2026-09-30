import { describe, expect, it, vi } from 'vitest';

// No WebGL/canvas in Node: stub the renderer and the canvas helpers, so this tests only
// previewArea's own wiring (the split parts become layers; none left -> the empty-area message).
const renderMaterial = vi.fn(async () => 'blob:rendered');
const applyEditsToParts = vi.fn();
const cleared = { cleared: true } as unknown as HTMLCanvasElement;
vi.mock('../../services/renderer/materialRenderer', () => ({ renderMaterial }));
vi.mock('../../services/maskCanvas', () => ({ applyEditsToParts, clearOccluderUnder: () => cleared, unionMasks: (masks: unknown[]) => ({ union: masks }) }));

const { previewArea, acceptedArea } = await import('../../services/areaPreview');
const { EMPTY_AREA_MESSAGE } = await import('../../services/areaMaskOps');

const canvas = {} as HTMLCanvasElement;
const area = { kind: 'wall' as const, parts: [{ mask: canvas, geometry: null }], occluder: null };
const material = {} as never;

describe('acceptedArea', () => {
  const occluder = { occluder: true } as unknown as HTMLCanvasElement;
  const withOccluder = { ...area, occluder };

  it('keeps an unedited area exactly as cut (the parts and the whole occluder)', () => {
    applyEditsToParts.mockClear();
    expect(acceptedArea(withOccluder, canvas, false)).toEqual({ parts: withOccluder.parts, occluder });
    expect(applyEditsToParts).not.toHaveBeenCalled();
  });

  it('re-splits an edited area and clears the occluder under it', () => {
    const split = [{ mask: canvas, geometry: null }];
    applyEditsToParts.mockReturnValueOnce(split);
    expect(acceptedArea(withOccluder, canvas, true)).toEqual({ parts: split, occluder: cleared });
  });

  it('adds protected objects to the occluder, so they are restored on top', () => {
    const protectedMask = { protectedMask: true } as unknown as HTMLCanvasElement;
    applyEditsToParts.mockReturnValueOnce([{ mask: canvas, geometry: null }]);
    expect(acceptedArea(withOccluder, canvas, true, protectedMask).occluder).toEqual({ union: [cleared, protectedMask] });
    applyEditsToParts.mockReturnValueOnce([{ mask: canvas, geometry: null }]);
    expect(acceptedArea(area, canvas, true, protectedMask).occluder).toBe(protectedMask); // no occluder of its own
  });
});

describe('previewArea', () => {
  it('rejects with the empty-area message when the edit left no renderable part', async () => {
    applyEditsToParts.mockReturnValueOnce([]);
    renderMaterial.mockClear();
    await expect(previewArea('room.jpg', area, canvas, true, material)).rejects.toThrow(EMPTY_AREA_MESSAGE);
    expect(renderMaterial).not.toHaveBeenCalled();
  });

  it('renders every surviving part, with the calibration on each layer', async () => {
    const plane = { homographyFallback: null };
    applyEditsToParts.mockReturnValueOnce([{ mask: canvas, geometry: plane }]);
    const calibration = { p1: [0, 0], p2: [1, 0], distanceMm: 1000 } as never;
    await expect(previewArea('room.jpg', area, canvas, true, material, calibration)).resolves.toBe('blob:rendered');
    expect(renderMaterial).toHaveBeenCalledWith('room.jpg', [
      { surface: { kind: 'wall', mask: canvas, occluderMask: null, plane, calibration }, material },
    ]);
  });

  it('previews an unedited area exactly as it will be saved (no re-split, whole occluder)', async () => {
    applyEditsToParts.mockClear();
    const occluder = { occluder: true } as unknown as HTMLCanvasElement;
    await previewArea('room.jpg', { ...area, occluder }, canvas, false, material);
    expect(applyEditsToParts).not.toHaveBeenCalled();
    expect(renderMaterial).toHaveBeenLastCalledWith('room.jpg', [
      { surface: { kind: 'wall', mask: canvas, occluderMask: occluder, plane: null, calibration: null }, material },
    ]);
  });
});
