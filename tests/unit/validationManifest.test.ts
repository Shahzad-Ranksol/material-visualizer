import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { approvedName, isListed, validateManifest, ValidationPhoto } from '../../services/validation/manifest';

const ok: ValidationPhoto = { id: 'a1', url: 'https://images.unsplash.com/photo-1', source: 'unsplash', credit: 'Jane (https://unsplash.com/@jane)', category: 'wall', surfaces: ['wall'] };

describe('validation manifest', () => {
  it('accepts the committed manifest', () => {
    expect(validateManifest(JSON.parse(fs.readFileSync('validation/manifest.json', 'utf8')))).toEqual([]);
  });

  it('reports duplicates, bad categories, missing surfaces and non-https urls', () => {
    const bad = [ok, { ...ok }, { ...ok, id: 'b', category: 'roof' }, { ...ok, id: 'c', surfaces: [] }, { ...ok, id: 'd', url: 'http://x' }];
    const problems = validateManifest(bad);
    expect(problems.some((p) => p.includes('duplicate id "a1"'))).toBe(true);
    expect(problems.some((p) => p.includes('"b"') && p.includes('category'))).toBe(true);
    expect(problems.some((p) => p.includes('"c"') && p.includes('surfaces'))).toBe(true);
    expect(problems.some((p) => p.includes('"d"') && p.includes('https'))).toBe(true);
  });

  it('names approved masks safely and only for listed surfaces', () => {
    expect(approvedName('a1', 'kitchen island')).toBe('a1__kitchen-island');
    expect(isListed([ok], 'a1', 'wall')).toBe(true);
    expect(isListed([ok], 'a1', 'floor')).toBe(false);
    expect(isListed([ok], '../etc', 'wall')).toBe(false);
  });
});
