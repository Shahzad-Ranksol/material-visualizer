import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, Page, test } from '@playwright/test';

// The Area Editor through the studio's area check: polygon add, undo/redo, and a one-click
// object cut-out, each changing the area exactly as shown. Uses the room photo cached by
// studio-flow.spec.ts (same URL) and the local models.
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

const coverage = async (page: Page) => {
  const text = (await page.getByTestId('area-coverage').textContent()) ?? '';
  return Number(/([\d.]+)% of photo/.exec(text)?.[1]);
};

test('area editor: polygon add, undo/redo, object cut-out', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  test.skip(!fs.existsSync(path.join(HERE, '../../public/models')), 'local models missing — run npm run assets:fetch');
  const photo = await roomPhoto();
  test.skip(!photo, 'room photo could not be downloaded (offline?)');

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/studio');
  await page.locator('#room-file-input').setInputFiles(photo!);
  await expect(page.locator('[id^="detected-item-"]').first()).toBeVisible({ timeout: 6 * 60_000 });
  await page.locator('#material-card-fluted_white_oak').click();
  await expect(page.getByText('Drag line to compare')).toBeVisible({ timeout: 3 * 60_000 });

  const badge = page.locator('[title="Low confidence — check and fix the area"]').first();
  test.skip(!(await badge.count()), 'the wall was confident enough that no area check is offered');
  await badge.click();
  const viewport = page.getByTestId('area-editor-viewport');
  await expect(viewport).toBeVisible({ timeout: 60_000 });
  const img = viewport.locator('img');
  const at = async (fx: number, fy: number) => {
    const b = (await img.boundingBox())!;
    return { x: b.x + b.width * fx, y: b.y + b.height * fy };
  };
  const start = await coverage(page);

  // Polygon: add a block over the sofa (not part of the wall)
  await page.getByRole('button', { name: 'Polygon: add' }).click();
  const corners = [await at(0.68, 0.52), await at(0.95, 0.52), await at(0.95, 0.78), await at(0.68, 0.78)];
  for (const c of corners) await page.mouse.click(c.x, c.y);
  await page.mouse.click(corners[0].x, corners[0].y); // click the first corner to close
  const added = await coverage(page);
  expect(added).toBeGreaterThan(start + 3);

  // Undo / redo restore exactly
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(await coverage(page)).toBeCloseTo(start, 1);
  await page.getByRole('button', { name: 'Redo' }).click();
  expect(await coverage(page)).toBeCloseTo(added, 1);

  // Cut out the sofa inside the added block
  await page.getByRole('button', { name: 'Cut out object' }).click();
  const sofa = await at(0.82, 0.66);
  await page.mouse.click(sofa.x, sofa.y);
  await expect(page.getByText('Outlining the object…')).toHaveCount(0, { timeout: 60_000 });
  expect(await coverage(page)).toBeLessThan(added - 1);

  await page.getByRole('button', { name: 'Use this area' }).click();
  await expect(viewport).toHaveCount(0);
  expect(errors).toEqual([]);
});
