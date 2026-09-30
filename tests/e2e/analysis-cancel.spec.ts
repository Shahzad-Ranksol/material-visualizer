import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';

// Starting a new photo while the previous one is still being analysed cancels the old job: the
// worker is told to stop it, its result never lands, the new photo's surfaces appear, no errors.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const PHOTO = path.join(HERE, '.cache', 'room.jpg'); // cached by studio-flow.spec.ts

test('switching photos mid-analysis cancels the old job', async ({ page }) => {
  test.setTimeout(8 * 60_000);
  test.skip(!fs.existsSync(path.join(HERE, '../../public/models')), 'local models missing — run npm run assets:fetch');
  test.skip(!fs.existsSync(PHOTO), 'room photo not cached — run studio-flow.spec.ts once');

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // Record what the page sends the analysis worker
  await page.addInitScript(() => {
    const sent: unknown[] = [];
    (window as unknown as { __workerSent: unknown[] }).__workerSent = sent;
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, msg: unknown, ...rest: unknown[]) {
      sent.push(msg);
      return (post as (...a: unknown[]) => void).call(this, msg, ...rest);
    };
  });

  // The studio starts analysing its default demo room; switch to an upload straight away
  await page.goto('/studio');
  await expect.poll(() => page.evaluate(() => (window as any).__workerSent.length), { timeout: 60_000 }).toBeGreaterThan(0);
  await page.locator('#room-file-input').setInputFiles(PHOTO);

  await expect(page.locator('[id^="detected-item-"]').first()).toBeVisible({ timeout: 6 * 60_000 });
  const sent = await page.evaluate(() => (window as any).__workerSent as Array<{ type: string; target?: number; id: number }>);
  const firstAnalyze = sent.find((m) => m.type === 'analyze')!;
  expect(sent.some((m) => m.type === 'cancel' && m.target === firstAnalyze.id)).toBe(true);
  await expect(page.locator('p.text-rose-300')).toHaveCount(0);
  expect(errors).toEqual([]);
});
