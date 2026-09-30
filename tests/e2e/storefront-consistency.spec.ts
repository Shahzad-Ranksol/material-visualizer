import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, Route } from '@playwright/test';

// A vendor's reviewed surface renders on the public storefront exactly as the studio's one render
// path renders the same saved data (masks from object storage, occluder, no plane → the mask's
// own perspective fit), changes nothing outside the saved mask, and a surface flagged because
// the photo was replaced is refused instead of painted on the wrong pixels. The API is mocked
// with page.route (no MySQL/MinIO/API needed) and no model runs: customers never run one.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOM = path.join(HERE, '.cache', 'room.jpg'); // cached by studio-flow.spec.ts
const API = 'http://localhost:4000';

// The wall between the gallery and the window in the cached photo (fractions of 1600x1200),
// with a lamp-sized occluder inside it
const WALL = { x0: 900, y0: 80, x1: 1250, y1: 250 };
const OCCLUDER = { x0: 1000, y0: 120, x1: 1060, y1: 200 };

const MATERIAL = {
  id: 'mat-1',
  tenantId: 't1',
  name: 'Grey Terrazzo',
  category: 'stone',
  description: 'Test swatch',
  thumbnail: `${API}/uploads/swatch.png`,
  finishType: 'Honed',
  colorTone: 'Grey',
  realWidthMm: 600,
  realHeightMm: 600,
  repeatMode: 'tile',
  orientationDeg: 0,
  jointWidthMm: 3,
  jointColor: '#555555',
  roughness: 0.6,
  metallic: 0,
  normalStrength: 0,
  albedoUrl: `${API}/uploads/swatch.png`,
};

const surface = (id: string, needsReview: boolean) => ({
  id,
  imageId: 'img-1',
  kind: 'wall',
  label: 'Wall',
  maskUrl: `${API}/uploads/mask.png`,
  occluderMaskUrl: `${API}/uploads/occluder.png`,
  analysisVersion: 'test',
  confidence: 0.9,
  needsReview,
  plane: null,
  calibration: null,
});

test('storefront renders a saved surface exactly like the render path, and refuses a stale one', async ({ page }) => {
  test.skip(!fs.existsSync(ROOM), 'room photo not cached — run studio-flow.spec.ts once');

  // Masks and the swatch, drawn in the browser as the editor saves them (white on black PNGs)
  await page.goto('about:blank');
  const pngs = await page.evaluate(
    ({ wall, occ }) => {
      const png = (w: number, h: number, draw: (ctx: CanvasRenderingContext2D) => void) => {
        const c = document.createElement('canvas');
        c.width = w;
        c.height = h;
        draw(c.getContext('2d')!);
        return c.toDataURL('image/png').split(',')[1];
      };
      const rect = (r: typeof wall) => (ctx: CanvasRenderingContext2D) => {
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, 1600, 1200);
        ctx.fillStyle = '#fff';
        ctx.fillRect(r.x0, r.y0, r.x1 - r.x0, r.y1 - r.y0);
      };
      return {
        mask: png(1600, 1200, rect(wall)),
        occluder: png(1600, 1200, rect(occ)),
        swatch: png(64, 64, (ctx) => {
          ctx.fillStyle = '#8a8f96';
          ctx.fillRect(0, 0, 64, 64);
        }),
      };
    },
    { wall: WALL, occ: OCCLUDER }
  );

  const files: Record<string, { type: string; body: Buffer }> = {
    '/uploads/room.jpg': { type: 'image/jpeg', body: fs.readFileSync(ROOM) },
    '/uploads/mask.png': { type: 'image/png', body: Buffer.from(pngs.mask, 'base64') },
    '/uploads/occluder.png': { type: 'image/png', body: Buffer.from(pngs.occluder, 'base64') },
    '/uploads/swatch.png': { type: 'image/png', body: Buffer.from(pngs.swatch, 'base64') },
  };
  const cors = { 'Access-Control-Allow-Origin': '*' };
  const json = (route: Route, body: unknown) => route.fulfill({ status: 200, contentType: 'application/json', headers: cors, body: JSON.stringify(body) });
  await page.route(`${API}/**`, (route) => {
    const { pathname } = new URL(route.request().url());
    if (files[pathname]) return route.fulfill({ status: 200, contentType: files[pathname].type, headers: cors, body: files[pathname].body });
    if (pathname === '/api/public/tenants/demo') return json(route, { id: 't1', name: 'Demo Showroom', slug: 'demo' });
    if (pathname === '/api/public/tenants/demo/materials') return json(route, [MATERIAL]);
    if (pathname === '/api/public/tenants/demo/showcase') {
      return json(route, [
        {
          id: 'img-1',
          tenantId: 't1',
          name: 'Living room',
          imageUrl: `${API}/uploads/room.jpg`,
          hotspots: [
            { id: 'h1', showcaseImageId: 'img-1', label: 'Feature Wall', xPct: 67, yPct: 14, allowedCategories: ['stone'], surfaceId: 's1' },
            { id: 'h2', showcaseImageId: 'img-1', label: 'Old Wall', xPct: 20, yPct: 20, allowedCategories: ['stone'], surfaceId: 's2' },
          ],
          surfaces: [surface('s1', false), surface('s2', true)],
        },
      ]);
    }
    return route.fulfill({ status: 404, headers: cors, body: '' });
  });

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/store/demo');

  // A reviewed surface: the customer's render
  await page.locator('button[title="Feature Wall"]').click();
  await page.getByRole('button', { name: /Grey Terrazzo/ }).click();
  const rendered = page.locator('img[src^="blob:"]').first();
  await expect(rendered).toBeVisible({ timeout: 60_000 });
  const storefrontUrl = await rendered.getAttribute('src');

  const result = await page.evaluate(
    async ({ url, material, saved, api }) => {
      // App modules as the dev server serves them (resolved in the browser, not by tsc)
      const load = (p: string): Promise<any> => import(/* @vite-ignore */ p);
      const { renderMaterial } = await load('/services/renderer/materialRenderer.ts');
      const { savedSurfaceToRenderable } = await load('/services/roomAnalysis.ts');
      const { toMaterial } = await load('/App.tsx');
      const room = `${api}/uploads/room.jpg`;
      // The same saved data straight through the one render path
      const direct = await renderMaterial(room, [{ surface: savedSurfaceToRenderable(saved), material: toMaterial(material) }]);
      const pixels = async (src: string) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = src;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true })!;
        ctx.drawImage(img, 0, 0);
        return ctx.getImageData(0, 0, c.width, c.height).data;
      };
      const [a, b, original, mask] = await Promise.all([pixels(url), pixels(direct), pixels(room), pixels(saved.maskUrl)]);
      let differs = 0;
      let outsideChanged = 0;
      let insideChanged = 0;
      for (let i = 0; i < a.length; i += 4) {
        if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) differs++;
        const changed = a[i] !== original[i] || a[i + 1] !== original[i + 1] || a[i + 2] !== original[i + 2];
        if (mask[i] === 0 && changed) outsideChanged++;
        if (mask[i] === 255 && changed) insideChanged++;
      }
      return { differs, outsideChanged, insideChanged };
    },
    { url: storefrontUrl!, material: MATERIAL, saved: surface('s1', false), api: API }
  );
  expect(result.differs).toBe(0); // identical to the render path, pixel for pixel
  expect(result.outsideChanged).toBe(0); // nothing outside the saved mask
  expect(result.insideChanged).toBeGreaterThan(1000); // (the wall really was re-surfaced)

  // A surface flagged when the photo was replaced: refused, the photo stays as it was
  await page.locator('button[title="Old Wall"]').click();
  await page.getByRole('button', { name: /Grey Terrazzo/ }).click();
  await expect(page.getByText('"Old Wall" is being updated by the showroom — try again soon.')).toBeVisible();

  expect(errors).toEqual([]);
});
