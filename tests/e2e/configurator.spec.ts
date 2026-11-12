import { test, expect, Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The customer configurators on their baked scenes: no models, no network beyond the dev server.
// Kitchen (the default server, :3000) walks the steps, applies designs and finishes, and checks
// every pixel outside the finished items' masks is byte-identical to the photo; then compare,
// download and the share link. Fencing runs as its own app (VITE_APP=fencing, :3010) and offers
// fence designs only, never a colour.

const baked = JSON.parse(fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../../scenes/baked.json'), 'utf8'));
const kitchen = baked.kitchen;
const FENCING = 'http://localhost:3010';

// Pixels of the look that differ from the photo where no finished item's mask covers them
const changedOutsideMasks = async (page: Page, maskUrls: string[], photoUrl = '/scenes/kitchen/photo.png') => {
  await page.getByTestId('look-image').waitFor();
  return page.evaluate(async ({ urls, photoUrl }) => {
    const load = async (src: string) => {
      const img = new Image();
      img.src = src;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      return ctx.getImageData(0, 0, c.width, c.height);
    };
    const look = await load((document.querySelector('[data-testid=look-image]') as HTMLImageElement).src);
    const photo = await load(photoUrl);
    const masks = await Promise.all(urls.map(load));
    let changed = 0;
    for (let i = 0; i < look.data.length; i += 4) {
      if (masks.some((m) => m.data[i] > 0)) continue;
      if (look.data[i] !== photo.data[i] || look.data[i + 1] !== photo.data[i + 1] || look.data[i + 2] !== photo.data[i + 2]) changed++;
    }
    return { changed, size: [look.width, look.height, photo.width, photo.height] };
  }, { urls: maskUrls, photoUrl });
};

const settled = (page: Page) => expect(page.getByText('Preparing your finish…')).toBeHidden({ timeout: 60_000 });

test.describe('kitchen', () => {
  test.skip(!kitchen?.items?.island || !kitchen?.items?.worktop, 'kitchen not baked — run npm run scenes:bake');

  test('intro → steps → finishes, only inside the masks; compare, download, share', async ({ page }) => {
    test.setTimeout(150_000);
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Design your dream kitchen' })).toBeVisible();
    await expect(page).toHaveTitle('Hollin Kitchens');
    await page.getByTestId('start').click();
    // Step 1: the layout (Classic is chosen to start with), then the door style
    await expect(page.getByRole('heading', { name: 'Choose your layout' })).toBeVisible();
    await expect(page.getByTestId('step-note')).toHaveText('Step 1 of 7');
    await page.getByTestId('next').click();

    // Step 3: the colour goes on every front at once
    await page.getByTestId('next').click();
    await expect(page.getByRole('heading', { name: 'Choose a colour' })).toBeVisible();
    await page.locator('[data-testid=finish-chip][data-material=kit-navy-lacquer]').click();
    await expect(page.getByTestId('look-image')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('look-chip')).toContainText('Midnight Navy');

    // Step 4: only worktop materials are offered
    await page.getByTestId('next').click();
    const offered = await page.locator('[data-testid=finish-chip]').evaluateAll((els) => els.map((e) => e.getAttribute('data-material')));
    expect(offered.sort()).toEqual(['kit-bianco-quartz', 'kit-concrete', 'kit-crema-marble']);
    await page.locator('[data-testid=finish-chip][data-material=kit-bianco-quartz]').click();
    await settled(page);

    const fronts = ['wall-cabinets', 'tall-units', 'canopy', 'base-cabinets', 'island', 'worktop'];
    const maskUrls = fronts.flatMap((id) => kitchen.items[id].parts.map((p: { mask: string }) => p.mask));
    const { changed, size } = await changedOutsideMasks(page, maskUrls);
    expect(size[0]).toBe(size[2]);
    expect(size[1]).toBe(size[3]);
    expect(changed).toBe(0);

    // The URL carries the look and the step
    expect(decodeURIComponent(page.url())).toContain('island:kit-navy-lacquer');
    expect(page.url()).toContain('step=3');

    // Before / after shows the original on one side
    await page.getByTestId('compare-toggle').click();
    await expect(page.getByText('Original')).toBeVisible();
    expect(await page.getByTestId('look-image').evaluate((el) => (el as HTMLElement).style.clipPath)).toContain('inset');
    await page.getByTestId('compare-toggle').click();

    // Walk to the summary; Download hands over a PNG
    while (await page.getByTestId('next').count()) await page.getByTestId('next').click();
    await expect(page.getByTestId('design-summary')).toContainText('Midnight Navy');
    await expect(page.getByTestId('design-summary')).toContainText('Bianco Quartz');
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('download').click()]);
    expect(download.suggestedFilename()).toBe('kitchen-design.png');

    // A reload restores the look and the step
    await page.reload();
    await expect(page.getByTestId('design-summary')).toContainText('Bianco Quartz');

    // Back goes back a step; a tap on the picture jumps to the step that changes that item
    await page.getByTestId('back').click();
    await expect(page.getByTestId('step-note')).toHaveText('Step 6 of 7');
    await page.waitForTimeout(500); // item masks load for hit-testing
    const box = (await page.getByTestId('scene-canvas').boundingBox())!;
    // The island: its first step is the door style
    await page.getByTestId('scene-canvas').click({ position: { x: box.width * 0.55, y: box.height * 0.85 } });
    await expect(page.getByTestId('step-note')).toHaveText('Step 2 of 7');

    expect(requests.filter((u) => u.includes('/models/'))).toEqual([]);
  });

  test('a door style, then a colour on it; a chosen finish taps off', async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto('/design?scene=kitchen&step=1');
    await page.locator('[data-testid=style-card][data-style=slab]').click();
    await expect(page.locator('[data-testid=style-card][data-style=slab]')).toHaveAttribute('aria-pressed', 'true');
    // Styles made on the photo before the vases were removed are not offered until regenerated
    await expect(page.locator('[data-testid=style-card][data-style=thick-stone]')).toHaveCount(0);
    await page.getByTestId('next').click();
    await page.locator('[data-testid=finish-chip][data-material=kit-burgundy]').click();
    await expect.poll(() => decodeURIComponent(page.url())).toContain('styles=kitchen-doors:slab');
    expect(decodeURIComponent(page.url())).toContain('island:kit-burgundy');
    await page.locator('[data-testid=finish-chip][data-material=kit-burgundy]').click();
    await expect.poll(() => decodeURIComponent(page.url())).not.toContain('island:kit-burgundy');
  });

  for (const [sceneId, label] of [['kitchen-modern', 'Modern U-shape'], ['kitchen-galley', 'Galley with island']] as const) {
    test(`layout ${label}: a colour changes only the fronts`, async ({ page }) => {
      test.setTimeout(150_000);
      await page.goto('/design');
      await page.getByRole('button', { name: label }).click();
      await expect(page.getByTestId('look-chip')).toContainText(label);
      await page.getByTestId('next').click();
      await expect(page.getByRole('heading', { name: 'Choose a colour' })).toBeVisible();
      await page.locator('[data-testid=finish-chip][data-material=kit-charcoal]').click();
      await expect(page.getByTestId('look-image')).toBeVisible({ timeout: 90_000 });
      await settled(page);
      const items = Object.entries(baked[sceneId].items as Record<string, { parts: { mask: string }[] }>);
      const fronts = ['wall-cabinets', 'tall-units', 'canopy', 'base-cabinets', 'island'];
      const maskUrls = items.filter(([id]) => fronts.includes(id)).flatMap(([, it]) => it.parts.map((p) => p.mask));
      const { changed, size } = await changedOutsideMasks(page, maskUrls, `/scenes/${sceneId}/photo.png`);
      expect(size[0]).toBe(size[2]);
      expect(changed).toBe(0);
    });
  }

  test('old studio links open the configurator on the same look', async ({ page }) => {
    await page.goto('/studio?scene=kitchen&look=island:kit-sage-lacquer');
    await expect(page).toHaveURL(/\/design\?/);
    expect(decodeURIComponent(page.url())).toContain('island:kit-sage-lacquer');
  });

  test('a finish is rolled on over its area; with reduced motion it simply appears', async ({ page, browser }) => {
    test.setTimeout(120_000);
    await page.goto('/design?scene=kitchen&step=2');
    await page.waitForTimeout(500);
    await page.locator('[data-testid=finish-chip][data-material=kit-sage-lacquer]').click();
    const rolling = page.locator('[data-testid=scene-canvas] canvas[aria-hidden]:not(.hidden)');
    await expect(rolling).toHaveCount(1, { timeout: 60_000 });
    await expect(page.getByTestId('look-image')).toBeVisible({ timeout: 10_000 });
    await expect(rolling).toHaveCount(0);

    const reduced = await browser.newContext({ reducedMotion: 'reduce', baseURL: test.info().project.use.baseURL });
    const still = await reduced.newPage();
    await still.goto('/design?scene=kitchen&step=2');
    await still.waitForTimeout(500);
    let rolled = false;
    await still.exposeFunction('sawRoll', () => (rolled = true));
    await still.evaluate(() => {
      new MutationObserver(() => {
        if (document.querySelector('[data-testid=scene-canvas] canvas[aria-hidden]:not(.hidden)')) (window as unknown as { sawRoll: () => void }).sawRoll();
      }).observe(document.body, { subtree: true, attributes: true, childList: true });
    });
    await still.locator('[data-testid=finish-chip][data-material=kit-sage-lacquer]').click();
    await expect(still.getByTestId('look-image')).toBeVisible({ timeout: 60_000 });
    expect(rolled).toBe(false);
    await reduced.close();
  });

  test('the kitchen app never offers another scene', async ({ page }) => {
    await page.goto('/design?scene=fencing&styles=fence:closeboard');
    await expect(page.getByTestId('look-chip')).toContainText('Classic with island');
    expect(page.url()).toContain('scene=kitchen');
  });
});

test.describe('fencing', () => {
  test('design only: pick a fence style, no colour step, share it', async ({ page }) => {
    test.setTimeout(120_000);
    const requests: string[] = [];
    page.on('request', (r) => requests.push(r.url()));
    await page.goto(`${FENCING}/`);
    await expect(page).toHaveTitle('Hollin Fencing');
    await page.getByTestId('start').click();
    await expect(page.getByTestId('step-note')).toHaveText('Step 1 of 2');
    await expect(page.locator('[data-testid=finish-chip]')).toHaveCount(0);
    await page.locator('[data-testid=style-card][data-style=closeboard]').click();
    await expect(page.locator('[data-testid=style-card][data-style=closeboard]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('look-chip')).toHaveText('Closeboard');
    await page.getByTestId('next').click();
    await expect(page.getByTestId('design-summary')).toContainText('Closeboard');
    await expect(page.locator('[data-testid=finish-chip]')).toHaveCount(0);
    expect(decodeURIComponent(page.url())).toContain('styles=fence:closeboard');
    await page.reload();
    await expect(page.getByTestId('design-summary')).toContainText('Closeboard');
    // No model and no image AI from the customer app
    expect(requests.filter((u) => u.includes('/models/') || u.includes('generativelanguage.googleapis.com') || u.includes('api.openai.com'))).toEqual([]);
  });
});
