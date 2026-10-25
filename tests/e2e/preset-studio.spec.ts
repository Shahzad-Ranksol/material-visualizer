import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The customer studio on a baked scene: no models, no network beyond the dev server. Picks items
// on the canvas and by chip, applies finishes, and checks every pixel outside the finished items'
// masks is byte-identical to the photo; then compare, download and the share link.

const baked = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scenes/baked.json'), 'utf8'));
const kitchen = baked.kitchen;

// Pixels of the look that differ from the photo where no finished item's mask covers them
const changedOutsideMasks = async (page: Page, maskUrls: string[]) => {
  // The finished look, once its fade-in is over
  await page.getByTestId('look-image').waitFor();
  return page.evaluate(async (urls) => {
    const load = async (src: string) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true })!; // as the renderer reads it (CPU decode)
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height);
    };
    const look = await load((document.querySelector('[data-testid=look-image]') as HTMLImageElement).src);
    const photo = await load('/scenes/kitchen/photo.png');
    const masks = await Promise.all(urls.map(load));
    let changed = 0;
    for (let i = 0; i < look.data.length; i += 4) {
      if (masks.some((m) => m.data[i] > 0)) continue;
      if (look.data[i] !== photo.data[i] || look.data[i + 1] !== photo.data[i + 1] || look.data[i + 2] !== photo.data[i + 2]) changed++;
    }
    return { changed, size: [look.width, look.height, photo.width, photo.height] };
  }, maskUrls);
};

test.skip(!kitchen?.items?.island || !kitchen?.items?.worktop, 'kitchen not baked — run npm run scenes:bake');

test('select items, apply finishes, compare, download and share', async ({ page }) => {
  test.setTimeout(120_000);
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/studio?scene=kitchen');
  await expect(page.getByRole('heading', { name: 'Kitchen' })).toBeVisible();

  // Pick the island by clicking it in the picture
  const canvas = page.getByTestId('scene-canvas');
  const box = (await canvas.boundingBox())!;
  await expect(page.locator('[data-testid=item-chip][data-item=island]')).toBeEnabled();
  await page.waitForTimeout(500); // item masks load for hit-testing
  await canvas.click({ position: { x: box.width * 0.55, y: box.height * 0.85 } });
  await expect(page.locator('[data-testid=item-chip][data-item=island]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-testid=finish-chip][data-material=kit-navy-lacquer]').click();
  await expect(page.getByTestId('look-image')).toBeVisible({ timeout: 60_000 });

  // Add the worktop by its chip (island stays selected → mixed roles), then pick it alone
  await page.locator('[data-testid=item-chip][data-item=island]').click();
  await page.locator('[data-testid=item-chip][data-item=worktop]').click();
  await page.locator('[data-testid=finish-chip][data-material=kit-bianco-quartz]').click();
  await expect(page.getByTestId('design-summary')).toContainText('Midnight Navy Lacquer');
  await expect(page.getByTestId('design-summary')).toContainText('Bianco Quartz');
  await expect(page.getByText('Applying finish…')).toBeHidden({ timeout: 60_000 });

  const maskUrls = ['island', 'worktop'].flatMap((id) => kitchen.items[id].parts.map((p: { mask: string }) => p.mask));
  const { changed, size } = await changedOutsideMasks(page, maskUrls);
  expect(size[0]).toBe(size[2]);
  expect(size[1]).toBe(size[3]);
  expect(changed).toBe(0);

  // The share link carries the look
  expect(page.url()).toContain('look=');
  expect(decodeURIComponent(page.url())).toContain('island:kit-navy-lacquer');

  // Compare shows the original on one side
  await page.getByTestId('compare-toggle').click();
  await expect(page.getByText('Original')).toBeVisible();
  const clip = await page.getByTestId('look-image').evaluate((el) => (el as HTMLElement).style.clipPath);
  expect(clip).toContain('inset');
  await page.getByTestId('compare-toggle').click();

  // Download hands over a PNG
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
  expect(download.suggestedFilename()).toBe('kitchen-design.png');

  // A reload restores the look from the URL
  await page.reload();
  await expect(page.getByTestId('design-summary')).toContainText('Bianco Quartz');

  // Customers never load a model
  expect(requests.filter((u) => u.includes('/models/'))).toEqual([]);
});

test('swap a design style, finish it, and share it', async ({ page }) => {
  test.setTimeout(120_000);
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto('/studio?scene=fencing');
  await page.locator('[data-testid=item-chip][data-item=front-fence]').click();
  await page.locator('[data-testid=style-card][data-style=closeboard]').click();
  await expect(page.locator('[data-testid=style-card][data-style=closeboard]')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('[data-testid=finish-chip][data-material=fen-charcoal]').click();
  await expect(page.getByTestId('look-image')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Applying finish…')).toBeHidden({ timeout: 60_000 });
  expect(decodeURIComponent(page.url())).toContain('styles=fence:closeboard');
  await page.reload();
  await expect(page.getByTestId('design-summary')).toContainText('Charcoal Stain');
  await page.locator('[data-testid=item-chip][data-item=front-fence]').click();
  await expect(page.locator('[data-testid=style-card][data-style=closeboard]')).toHaveAttribute('aria-pressed', 'true');
  // No model and no image AI from the customer studio
  expect(requests.filter((u) => u.includes('/models/') || u.includes('generativelanguage.googleapis.com') || u.includes('api.openai.com'))).toEqual([]);
});
