import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, Page, test } from '@playwright/test';

// The Area Editor through the studio's area check: polygon add, undo/redo, Protect object
// (the object stays out even when painted over again, and is untouched in the render) and
// Include area (a missed region comes back, nothing else changes). Uses the room photo cached
// by studio-flow.spec.ts (same URL) and the local models.
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

test('area editor: polygon add, undo/redo, protect object, include area', async ({ page }) => {
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

  // The click points below are fractions of the displayed photo, picked by eye for ROOM_URL
  // (https://images.unsplash.com/photo-1600210492486-724fe5c67fb0): the polygon block over the
  // sofa at the right of the frame, and the click on the sofa inside it. They mean nothing for
  // another photo — if ROOM_URL (or the cached tests/e2e/.cache/room.jpg) changes, re-pick them.
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

  // Protect the sofa inside the added block: previewed first, applied on request
  await page.getByRole('button', { name: 'Protect object' }).click();
  const sofa = await at(0.82, 0.66);
  await page.mouse.click(sofa.x, sofa.y);
  await expect(page.getByTestId('area-pending')).toBeVisible({ timeout: 60_000 });
  expect(await coverage(page)).toBeCloseTo(added, 1); // nothing changes until Apply
  await page.getByRole('button', { name: 'Apply' }).click();
  const protectedCoverage = await coverage(page);
  expect(protectedCoverage).toBeLessThan(added - 1);

  // Painting the same block again can't put the sofa back
  await page.getByRole('button', { name: 'Polygon: add' }).click();
  for (const c of corners) await page.mouse.click(c.x, c.y);
  await page.mouse.click(corners[0].x, corners[0].y);
  expect(await coverage(page)).toBeCloseTo(protectedCoverage, 1);

  // Include area: remove a block of plain wall, then one click brings back that region only
  await page.getByRole('button', { name: 'Polygon: remove' }).click();
  const hole = [await at(0.06, 0.12), await at(0.2, 0.12), await at(0.2, 0.3), await at(0.06, 0.3)];
  for (const c of hole) await page.mouse.click(c.x, c.y);
  await page.mouse.click(hole[0].x, hole[0].y);
  const holed = await coverage(page);
  expect(holed).toBeLessThan(protectedCoverage - 1);
  await page.getByRole('button', { name: 'Include area' }).click();
  const inHole = await at(0.13, 0.21);
  await page.mouse.click(inHole.x, inHole.y);
  await expect(page.getByTestId('area-pending')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Apply' }).click();
  const included = await coverage(page);
  expect(included).toBeGreaterThan(holed + 1);
  expect(included).toBeLessThanOrEqual(protectedCoverage + 0.2); // only the hole, nothing more

  await page.getByRole('button', { name: 'Use this area' }).click();
  await expect(viewport).toHaveCount(0);

  // The protected sofa is restored exactly in the render
  await page.locator('[title="Rendered Concept"]').click();
  await expect(page.getByText('Render: White Oak Veneer')).toBeVisible({ timeout: 3 * 60_000 });
  const photoUrl = `data:image/jpeg;base64,${fs.readFileSync(photo!).toString('base64')}`;
  const sofaUnchanged = await page.evaluate(async (originalUrl) => {
    const shown = document.querySelector<HTMLImageElement>('img[alt="Interior Visualizer"]')!;
    const decode = async (src: string) => {
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
    const rendered = await decode(shown.src);
    const original = await decode(originalUrl);
    // A small patch in the middle of the sofa
    const cx = Math.round(original.width * 0.82);
    const cy = Math.round(original.height * 0.66);
    let differing = 0;
    for (let y = cy - 5; y <= cy + 5; y++) {
      for (let x = cx - 5; x <= cx + 5; x++) {
        const i = (y * original.width + x) * 4;
        if (rendered.data[i] !== original.data[i] || rendered.data[i + 1] !== original.data[i + 1] || rendered.data[i + 2] !== original.data[i + 2]) differing++;
      }
    }
    return differing;
  }, photoUrl);
  expect(sofaUnchanged).toBe(0);
  expect(errors).toEqual([]);
});
