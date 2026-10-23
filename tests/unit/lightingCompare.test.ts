import { describe, expect, it } from 'vitest';
import { MATERIALS } from '../../constants';
import { applyLightingPreset, LIGHTING_PRESETS, lightingComparisonKey, PixelBuffer } from '../../services/lightingCompare';
import { RenderLayerInput } from '../../services/renderer/materialRenderer';

const material = (overrides: Partial<(typeof MATERIALS)[number]> = {}) => ({
  ...MATERIALS[0],
  roughness: 0.5,
  metallic: 0,
  ...overrides,
});

const image = (width: number, height: number, pixels: number[][]): PixelBuffer => ({
  width,
  height,
  data: new Uint8ClampedArray(pixels.flatMap((pixel) => [...pixel, 255])),
});

describe('lighting comparison', () => {
  it('preserves the image shading while dimming the night-lamp preview', () => {
    const original = image(2, 1, [[32, 32, 32], [190, 190, 190]]);
    const rendered = image(2, 1, [[45, 50, 55], [205, 210, 215]]);
    const coverage = new Float32Array([0, 1]);
    const noon = applyLightingPreset(original, rendered, coverage, material(), LIGHTING_PRESETS[0]);
    const night = applyLightingPreset(original, rendered, coverage, material(), LIGHTING_PRESETS[3]);

    expect(night.data[0]).toBeLessThan(noon.data[0]);
    expect(night.data[4]).toBeLessThan(noon.data[4]);
    expect(night.data[4]).toBeGreaterThan(night.data[0]);
  });

  it('shifts cool finishes warmer or bluer under the matching preset', () => {
    const original = image(1, 1, [[120, 120, 120]]);
    const rendered = image(1, 1, [[130, 130, 130]]);
    const coverage = new Float32Array([1]);
    const cool = applyLightingPreset(original, rendered, coverage, material(), LIGHTING_PRESETS[2]);
    const warm = applyLightingPreset(original, rendered, coverage, material(), LIGHTING_PRESETS[1]);

    expect(warm.data[0] / warm.data[2]).toBeGreaterThan(cool.data[0] / cool.data[2]);
  });

  it('gives a glossy dark surface more highlight response than a matte one', () => {
    const original = image(2, 2, [[24, 24, 24], [24, 24, 24], [24, 24, 24], [235, 235, 235]]);
    const rendered = image(2, 2, [[30, 30, 30], [30, 30, 30], [30, 30, 30], [30, 30, 30]]);
    const coverage = new Float32Array([1, 1, 1, 1]);
    const glossy = applyLightingPreset(original, rendered, coverage, material({ roughness: 0.05 }), LIGHTING_PRESETS[0]);
    const matte = applyLightingPreset(original, rendered, coverage, material({ roughness: 0.95 }), LIGHTING_PRESETS[0]);

    expect(glossy.data[12]).toBeGreaterThan(matte.data[12]);
  });

  it('describes grey material undertones under cool LED', () => {
    expect(LIGHTING_PRESETS[2].note(material({ name: 'Grey tile', colorTone: 'Cool grey' }))).toContain('read bluer');
  });

  it('keys cached comparisons by stable room, mask, and material profile', () => {
    const layer: RenderLayerInput = {
      surface: { kind: 'floor', mask: 'data:image/png;base64,mask' },
      material: material({ id: 'matte-stone', roughness: 0.7 }),
    };
    const unchanged = { ...layer, material: { ...layer.material } };
    const changedFinish = { ...layer, material: { ...layer.material, roughness: 0.2 } };

    expect(lightingComparisonKey('room-a', [layer])).toBe(lightingComparisonKey('room-a', [unchanged]));
    expect(lightingComparisonKey('room-a', [layer])).not.toBe(lightingComparisonKey('room-b', [layer]));
    expect(lightingComparisonKey('room-a', [layer])).not.toBe(lightingComparisonKey('room-a', [changedFinish]));
  });
});
