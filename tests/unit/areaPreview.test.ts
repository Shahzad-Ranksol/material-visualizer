import { describe, expect, it, vi } from 'vitest';

// No WebGL/canvas in Node: stub the renderer and the canvas helpers, so this tests only
// previewArea's own wiring (the split parts become layers; none left -> the empty-area message).
const renderMaterial = vi.fn(async () => 'blob:rendered');
const applyEditsToParts = vi.fn();
vi.mock('../../services/renderer/materialRenderer', () => ({ renderMaterial }));
vi.mock('../../services/maskCanvas', () => ({ applyEditsToParts, clearOccluderUnder: () => ({}) }));

const { previewArea } = await import('../../services/areaPreview');
const { EMPTY_AREA_MESSAGE } = await import('../../services/areaMaskOps');

const canvas = {} as HTMLCanvasElement;
const area = { kind: 'wall' as const, parts: [{ mask: canvas, geometry: null }], occluder: null };
const material = {} as never;

describe('previewArea', () => {
  it('rejects with the empty-area message when the edit left no renderable part', async () => {
    applyEditsToParts.mockReturnValueOnce([]);
    renderMaterial.mockClear();
    await expect(previewArea('room.jpg', area, canvas, material)).rejects.toThrow(EMPTY_AREA_MESSAGE);
    expect(renderMaterial).not.toHaveBeenCalled();
  });

  it('renders every surviving part, with the calibration on each layer', async () => {
    const plane = { homographyFallback: null };
    applyEditsToParts.mockReturnValueOnce([{ mask: canvas, geometry: plane }]);
    const calibration = { p1: [0, 0], p2: [1, 0], distanceMm: 1000 } as never;
    await expect(previewArea('room.jpg', area, canvas, material, calibration)).resolves.toBe('blob:rendered');
    expect(renderMaterial).toHaveBeenCalledWith('room.jpg', [
      { surface: { kind: 'wall', mask: canvas, occluderMask: null, plane, calibration }, material },
    ]);
  });
});
