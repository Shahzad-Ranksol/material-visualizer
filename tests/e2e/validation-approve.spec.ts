import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// The dev-only approve tool: a cached validation photo opens with the pipeline's cut in the Area
// Editor, and Approve posts a photo-sized, hard white-on-black PNG (the endpoint is stubbed so
// the test never writes into validation/approved/).
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PHOTO = path.join(HERE, '../../validation/.cache/minimalist-living.jpg');

test('approve tool posts a binary mask for a validation surface', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  test.skip(!fs.existsSync(path.join(HERE, '../../public/models')), 'local models missing — run npm run assets:fetch');
  test.skip(!fs.existsSync(PHOTO), 'validation photos missing — run npm run validation:fetch');

  let posted: { id: string; surface: string; png: string } | null = null;
  await page.route('**/__validation/state', (route) =>
    route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        photos: [{ id: 'minimalist-living', url: 'https://x', source: 'unsplash', credit: 'test', category: 'hard', surfaces: ['wall'] }],
        approved: [],
      }),
    })
  );
  await page.route('**/__validation/approve', async (route) => {
    posted = JSON.parse(route.request().postData() ?? '{}');
    await route.fulfill({ contentType: 'application/json', body: '{"ok":true}' });
  });

  await page.goto('/dev/validation');
  await page.getByTestId('validation-surface').first().click();
  await expect(page.getByTestId('area-editor-viewport')).toBeVisible({ timeout: 6 * 60_000 });
  await page.getByRole('button', { name: 'Approve' }).click();
  await expect.poll(() => posted !== null, { timeout: 30_000 }).toBe(true);

  const check = await page.evaluate(async (png) => {
    const img = new Image();
    img.src = `data:image/png;base64,${png}`;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let white = 0;
    let other = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i] === 255) white++;
      else if (d[i] !== 0) other++;
    }
    return { w: c.width, h: c.height, white, other };
  }, posted!.png);
  expect(posted!.id).toBe('minimalist-living');
  expect(check).toMatchObject({ w: 1600, h: 1200, other: 0 });
  expect(check.white).toBeGreaterThan(100_000); // the wall
});
