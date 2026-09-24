import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// The customer flow the plan requires: upload -> select surface -> correct mask -> choose
// material -> compare/download. Runs the real local models (SegFormer, MoGe, SAM from
// public/models — `npm run assets:fetch`), so the first run is slow.
const ROOM_URL = 'https://images.unsplash.com/photo-1600210492486-724fe5c67fb0?auto=format&fit=crop&w=1600&q=85';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const CACHE = path.join(HERE, '.cache', 'room.jpg');

const roomPhoto = async (): Promise<string | null> => {
  if (fs.existsSync(CACHE)) return CACHE;
  try {
    const res = await fetch(ROOM_URL);
    if (!res.ok) return null;
    fs.mkdirSync(path.dirname(CACHE), { recursive: true });
    fs.writeFileSync(CACHE, Buffer.from(await res.arrayBuffer()));
    return CACHE;
  } catch {
    return null;
  }
};

test('upload, check the surface, render, compare and download', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  test.skip(!fs.existsSync(path.join(HERE, '../../public/models')), 'local models missing — run npm run assets:fetch');
  const photo = await roomPhoto();
  test.skip(!photo, 'room photo could not be downloaded (offline?)');

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/studio');
  await page.locator('#room-file-input').setInputFiles(photo!);

  // Analysis finds surfaces and pre-selects a wall
  const items = page.locator('[id^="detected-item-"]');
  const analysisError = page.locator('p.text-rose-300');
  await expect(items.first().or(analysisError.first())).toBeVisible({ timeout: 6 * 60_000 });
  expect(await analysisError.allTextContents()).toEqual([]);
  await expect(page.getByText(/Detected Surfaces?/)).not.toHaveText(/^0 /);
  await expect(page.getByText('Analyzing the room', { exact: false })).toHaveCount(0);

  // Choosing a material renders it straight onto the selected surface
  await page.locator('#material-card-fluted_white_oak').click();
  await expect(page.getByText('Drag line to compare')).toBeVisible({ timeout: 3 * 60_000 });

  // Correct the mask: open the area check, exclude a spot, accept (the flagged path when the
  // analysis asks for it; either way the surface ends up accepted)
  const badge = page.locator('[title="Low confidence — check and fix the area"]').first();
  if (await badge.count()) {
    await badge.click();
    const title = page.getByText(/Check the “.+” area/);
    await expect(title).toBeVisible();
    const viewport = page.getByTestId('area-editor-viewport');
    await expect(viewport).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('surface-review-confidence')).toHaveText(/^Confidence \d{1,3}%$/);
    await page.getByRole('button', { name: 'Cut out object' }).click();
    const box = (await viewport.locator('img').boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.9);
    await expect(page.getByText('Outlining the object…')).toHaveCount(0, { timeout: 60_000 });
    await page.getByRole('button', { name: 'Use this area' }).click();
    await expect(title).toHaveCount(0);
  }

  // Compare views
  await page.locator('[title="Side by Side Comparison"]').click();
  await page.locator('[title="Rendered Concept"]').click();
  await expect(page.getByText('Render: White Oak Veneer')).toBeVisible();

  // Download the render: a real PNG
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#btn-download-render').click()]);
  expect(download.suggestedFilename()).toMatch(/\.png$/);
  const file = fs.readFileSync((await download.path())!);
  expect(file.subarray(1, 4).toString()).toBe('PNG');

  expect(errors).toEqual([]);
});
