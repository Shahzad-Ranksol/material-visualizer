import { describe, expect, it } from 'vitest';
import { defaultProfileFor } from '../../services/materialProfile';

describe('material physical profile defaults', () => {
  it('lays sheets out as whole 1220x2440 panels with joints', () => {
    expect(defaultProfileFor('sheet')).toMatchObject({ realWidthMm: 1220, realHeightMm: 2440, repeatMode: 'sheet', jointWidthMm: 3 });
  });
  it('treats tiles as 600mm modules with grout', () => {
    expect(defaultProfileFor('tile')).toMatchObject({ realWidthMm: 600, realHeightMm: 600, repeatMode: 'tile' });
  });
  it('reads the finish into roughness', () => {
    expect(defaultProfileFor('wood', 'High gloss lacquer').roughness).toBe(0.15);
    expect(defaultProfileFor('wood', 'Satin').roughness).toBe(0.35);
    expect(defaultProfileFor('metal').metallic).toBe(0.8);
  });
});
