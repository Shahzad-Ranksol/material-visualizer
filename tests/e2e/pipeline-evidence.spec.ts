import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CURATED_ROOMS } from '../../constants';

// Evidence run for surface coverage and leakage: for every curated room's
// wall and floor, attributes each missed and leaked pixel to a pipeline stage, checks mask/photo
// alignment and that the render changes nothing outside the final mask, and checks an
// EXIF-rotated photo. Writes overlays and results.json to tests/e2e/.cache/evidence/.
//   EVIDENCE=1 npx playwright test tests/e2e/pipeline-evidence.spec.ts
const HERE = path.dirname(fileURLToPath(import.meta.url));
// Outside test-results/, which Playwright empties at the start of every run
const OUT = path.join(HERE, '.cache', 'evidence');
const CACHED_ROOM = path.join(HERE, '.cache', 'room.jpg');

// Regression limits (% of the photo), from the run that fixed skirting, side walls, mirrors and
// thin objects (2026-09-30) with a small margin: missed stays at or below, leak at or below,
// final coverage at or above. Tighten as the pipeline improves.
const LIMITS: Record<string, { missed?: number; leak?: number; finalAtLeast?: number }> = {
  'minimalist-living-wall': { missed: 7.3, leak: 0.8 },
  'minimalist-living-floor': { missed: 4.7, finalAtLeast: 17 },
  'nordic-master-bedroom-wall': { missed: 2.8, leak: 0.7 },
  'nordic-master-bedroom-floor': { missed: 1.0, finalAtLeast: 5.7 },
  'penthouse-dining-room-wall': { missed: 3.8, leak: 0.7 },
  'penthouse-dining-room-floor': { missed: 2.5, finalAtLeast: 9.1 },
  'executive-atelier-office-wall': { leak: 3.8 },
  'executive-atelier-office-floor': { missed: 3.5, finalAtLeast: 5.6 },
};

// A JPEG with an EXIF APP1 segment (orientation 6: rotate 90° clockwise to display) inserted
// right after SOI, so browsers that honour EXIF show it portrait
const withOrientation6 = (jpeg: Buffer) => {
  const tiff = Buffer.from([0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0]);
  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'binary'), tiff]);
  const len = payload.length + 2;
  const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, len >> 8, len & 0xff]), payload]);
  return Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]);
};

test('surface pipeline evidence', async ({ page }) => {
  test.skip(!process.env.EVIDENCE, 'evidence run only: EVIDENCE=1');
  test.skip(!fs.existsSync(path.join(HERE, '../../public/models')), 'local models missing — run npm run assets:fetch');
  test.setTimeout(40 * 60_000);
  fs.mkdirSync(OUT, { recursive: true });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/tests/e2e/evidence/harness.html');
  await page.waitForFunction(() => 'runEvidence' in window);

  const results: Record<string, unknown> = {};
  // EVIDENCE_ROOMS=id1,id2 limits the run
  const only = process.env.EVIDENCE_ROOMS?.split(',');
  for (const room of CURATED_ROOMS.filter((r) => !only || only.includes(r.id))) {
    for (const surface of ['wall', 'floor']) {
      const key = `${room.id}-${surface}`;
      const started = Date.now();
      const r = await page
        .evaluate(([url, label]) => (window as any).runEvidence(url, label), [room.fullImage, surface] as const)
        .catch((err: unknown) => ({ error: String(err) }));
      if (r && 'overlays' in r) {
        for (const [name, dataUrl] of Object.entries(r.overlays as Record<string, string>)) {
          fs.writeFileSync(path.join(OUT, `${key}-${name}.jpg`), Buffer.from(dataUrl.split(',')[1], 'base64'));
        }
        delete (r as { overlays?: unknown }).overlays;
      }
      results[key] = r ?? { skipped: `no ${surface} proposed` };
      console.log(key, `${((Date.now() - started) / 1000).toFixed(0)}s`, JSON.stringify(results[key]));
    }
  }
  if (fs.existsSync(CACHED_ROOM)) {
    results.exifOrientation6 = await page
      // As a data URL, the form a studio upload reaches the worker in (App.tsx handleFileUpload)
      .evaluate((url) => (window as any).exifCheck(url), `data:image/jpeg;base64,${withOrientation6(fs.readFileSync(CACHED_ROOM)).toString('base64')}`)
      .catch((err: unknown) => ({ error: String(err) }));
    console.log('exifOrientation6', JSON.stringify(results.exifOrientation6));
  }
  results.pageErrors = errors;
  fs.writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, null, 2));

  // Rendering and alignment: exact, for every case
  for (const [key, r] of Object.entries(results) as Array<[string, any]>) {
    if (!r || typeof r !== 'object' || !('changedOutside' in r)) continue;
    expect.soft(r.changedOutside, `${key}: pixels changed outside the final mask`).toBe(0);
    expect.soft(r.photo.masks, `${key}: mask size vs photo`).toEqual(r.photo.img);
    const limit = LIMITS[key];
    if (!limit) continue;
    if (limit.missed !== undefined) expect.soft(r.missedPct, `${key}: missed %`).toBeLessThanOrEqual(limit.missed);
    if (limit.leak !== undefined) expect.soft(r.leakPct, `${key}: leak %`).toBeLessThanOrEqual(limit.leak);
    if (limit.finalAtLeast !== undefined) expect.soft(r.finalPct, `${key}: final coverage %`).toBeGreaterThanOrEqual(limit.finalAtLeast);
  }
  const exif = results.exifOrientation6 as { img: number[]; masks: number[] } | undefined;
  if (exif) expect.soft(exif.masks, 'EXIF-rotated photo: masks vs <img>').toEqual(exif.img);
  expect(errors).toEqual([]);
});
