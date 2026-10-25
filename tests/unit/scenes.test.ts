import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { emptyMask } from '../../services/areaMaskOps';
import { applyRecipeClip, hitTest, polygonItemMask } from '../../scenes/recipeMask';
import { SCENES } from '../../scenes/scenes';
import { materialsFor, STUDIO_MATERIALS } from '../../scenes/materials';
import { BAKED } from '../../scenes/baked';

const root = path.join(__dirname, '../..');

describe('recipe masks', () => {
  it('clip keeps only the polygon, subtract removes', () => {
    const m = emptyMask(10, 10);
    m.alpha.fill(255);
    const r = { clip: [{ xPct: 0, yPct: 0 }, { xPct: 0.5, yPct: 0 }, { xPct: 0.5, yPct: 1 }, { xPct: 0, yPct: 1 }] };
    const out = applyRecipeClip(m, { ...r, subtract: [[{ xPct: 0, yPct: 0 }, { xPct: 0.2, yPct: 0 }, { xPct: 0.2, yPct: 1 }, { xPct: 0, yPct: 1 }]] });
    expect(out.alpha[5 * 10 + 1]).toBe(0);
    expect(out.alpha[5 * 10 + 3]).toBe(255);
    expect(out.alpha[5 * 10 + 7]).toBe(0);
    expect(polygonItemMask(r, 10, 10).alpha[5 * 10 + 7]).toBe(0);
  });

  it('hit test prefers the smallest item under the point', () => {
    const big = emptyMask(4, 4);
    big.alpha.fill(255);
    const small = emptyMask(4, 4);
    small.alpha[0] = 255;
    const masks = [
      { id: 'wall', mask: big, area: 16 },
      { id: 'socket', mask: small, area: 1 },
    ];
    expect(hitTest(masks, 0.1, 0.1)).toBe('socket');
    expect(hitTest(masks, 0.9, 0.9)).toBe('wall');
    expect(hitTest([{ id: 'socket', mask: small, area: 1 }], 0.9, 0.9)).toBeNull();
  });
});

describe('scene catalogue', () => {
  it('every scene has a photo and unique items, and every item has finishes to offer', () => {
    for (const s of SCENES) {
      expect(fs.existsSync(path.join(root, 'public', s.photo)), s.photo).toBe(true);
      expect(new Set(s.items.map((i) => i.id)).size).toBe(s.items.length);
      for (const item of s.items) expect(materialsFor(s.id, [item.role]).length, `${s.id}/${item.id}`).toBeGreaterThan(0);
    }
  });

  it('each scene collection has 4–5 materials and ids are unique', () => {
    for (const s of SCENES) {
      const n = STUDIO_MATERIALS.filter((m) => m.collection === s.id).length;
      expect(n).toBeGreaterThanOrEqual(4);
      expect(n).toBeLessThanOrEqual(5);
    }
    expect(new Set(STUDIO_MATERIALS.map((m) => m.id)).size).toBe(STUDIO_MATERIALS.length);
  });

  it('every baked item belongs to a scene, and its mask files exist', () => {
    for (const [sceneId, scene] of Object.entries(BAKED)) {
      const def = SCENES.find((s) => s.id === sceneId);
      expect(def, sceneId).toBeDefined();
      for (const [itemId, item] of Object.entries(scene!.items)) {
        expect(def!.items.some((i) => i.id === itemId), `${sceneId}/${itemId}`).toBe(true);
        expect(item.parts.length).toBeGreaterThan(0);
        for (const p of item.parts) expect(fs.existsSync(path.join(root, 'public', p.mask)), p.mask).toBe(true);
        if (item.occluder) expect(fs.existsSync(path.join(root, 'public', item.occluder))).toBe(true);
      }
    }
  });
});

describe('keepInside', () => {
  it('keeps the mask only inside the polygons', async () => {
    const { keepInside } = await import('../../scenes/recipeMask');
    const m = emptyMask(10, 10);
    m.alpha.fill(200);
    const out = keepInside(m, [[{ xPct: 0, yPct: 0 }, { xPct: 0.5, yPct: 0 }, { xPct: 0.5, yPct: 0.5 }, { xPct: 0, yPct: 0.5 }]]);
    expect(out.alpha[2 * 10 + 2]).toBe(200);
    expect(out.alpha[8 * 10 + 8]).toBe(0);
  });
});

describe('partitionParts', () => {
  it('gives each pixel wholly to the part covering it most, at the area alpha', async () => {
    const { partitionParts } = await import('../../scenes/recipeMask');
    const a = emptyMask(4, 1);
    const b = emptyMask(4, 1);
    const area = emptyMask(4, 1);
    area.alpha.set([255, 255, 120, 0]);
    a.alpha.set([128, 0, 120, 0]);
    b.alpha.set([127, 255, 0, 90]);
    const [pa, pb] = partitionParts([a, b], area);
    expect([...pa.alpha]).toEqual([255, 0, 120, 0]);
    // Nothing outside the area, and the soft outer edge stays soft
    expect([...pb.alpha]).toEqual([0, 255, 0, 0]);
  });
});

describe('colourMask', () => {
  it('keeps green pixels inside the region only', async () => {
    const { colourMask } = await import('../../scenes/recipeMask');
    // 4×1: green, beige, green, green — region covers the first three
    const rgba = new Uint8ClampedArray([60, 160, 50, 255, 200, 180, 150, 255, 70, 150, 60, 255, 60, 160, 50, 255]);
    const region = [[{ xPct: 0, yPct: 0 }, { xPct: 0.75, yPct: 0 }, { xPct: 0.75, yPct: 1 }, { xPct: 0, yPct: 1 }]];
    expect([...colourMask(rgba, 4, 1, region, { hueMin: 55, hueMax: 170, minSat: 0.3 }).alpha]).toEqual([255, 0, 255, 0]);
    // By brightness alone: only the beige pixel is brighter than 0.7
    expect([...colourMask(rgba, 4, 1, region, { minValue: 0.7 }).alpha]).toEqual([0, 255, 0, 0]);
  });
});

describe('keepBlobs', () => {
  it('keeps compact pieces and drops long lines and specks', async () => {
    const { keepBlobs } = await import('../../scenes/recipeMask');
    const m = emptyMask(40, 20);
    for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) m.alpha[y * 40 + x] = 255; // 6×6 knob
    for (let x = 10; x < 38; x++) m.alpha[15 * 40 + x] = 255; // a long groove line
    m.alpha[2 * 40 + 30] = 255; // a speck
    const out = keepBlobs(m, { minArea: 4, maxArea: 100, maxAspect: 3 });
    expect(out.alpha[4 * 40 + 4]).toBe(255);
    expect(out.alpha[15 * 40 + 20]).toBe(0);
    expect(out.alpha[2 * 40 + 30]).toBe(0);
  });
});

describe('openMask', () => {
  it('cuts a thin line off a knob it touches', async () => {
    const { openMask } = await import('../../scenes/recipeMask');
    const m = emptyMask(40, 20);
    for (let y = 4; y < 14; y++) for (let x = 4; x < 14; x++) m.alpha[y * 40 + x] = 255; // 10×10 knob
    for (let x = 13; x < 38; x++) m.alpha[9 * 40 + x] = 255; // a 1 px groove running out of it
    const out = openMask(m, 2);
    expect(out.alpha[9 * 40 + 9]).toBe(255);
    expect(out.alpha[9 * 40 + 25]).toBe(0);
  });
});

describe('design styles catalogue', () => {
  it('every group names real items, and every option belongs to a group', async () => {
    const { STYLE_GROUPS, STYLE_OPTIONS } = await import('../../scenes/styles');
    for (const g of STYLE_GROUPS) {
      const scene = SCENES.find((s) => s.id === g.sceneId);
      expect(scene, g.id).toBeDefined();
      for (const id of g.itemIds) expect(scene!.items.some((i) => i.id === id), `${g.id}/${id}`).toBe(true);
    }
    for (const o of STYLE_OPTIONS) expect(STYLE_GROUPS.some((g) => g.id === o.groupId), o.id).toBe(true);
  });

  it('every shipped style has its patch, and its items are its own group’s with existing masks', async () => {
    const { STYLE_BAKED } = await import('../../scenes/stylesBaked');
    const { STYLE_GROUPS } = await import('../../scenes/styles');
    const file = (u: string) => path.join(root, 'public', u.split('?')[0]);
    for (const [sceneId, styles] of Object.entries(STYLE_BAKED)) {
      for (const [key, bake] of Object.entries(styles!)) {
        const group = STYLE_GROUPS.find((g) => key.startsWith(`${g.id}--`) && g.sceneId === sceneId);
        expect(group, `${sceneId}/${key}`).toBeDefined();
        expect(fs.existsSync(file(bake.patch)), bake.patch).toBe(true);
        for (const [itemId, item] of Object.entries(bake.items)) {
          expect(group!.itemIds).toContain(itemId);
          for (const p of item.parts) expect(fs.existsSync(file(p.mask)), p.mask).toBe(true);
        }
      }
    }
  });
});
