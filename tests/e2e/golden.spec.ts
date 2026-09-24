import { expect, test } from '@playwright/test';

// The plan's non-negotiable renderer checks, measured by tests/e2e/golden/harness.ts on
// synthetic scenes whose correct output is known exactly.
test('renderer golden checks', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/tests/e2e/golden/harness.html');
  await page.waitForFunction(() => 'runGolden' in window);
  const r = await page.evaluate(() => (window as any).runGolden());

  // 1. Outside-mask preservation: exact, beyond 2px of the surface
  expect(r.outsideChanged).toBe(0);
  // 2. Occluders restored exactly (stricter than the plan's SSIM >= 0.995)
  expect(r.occluderChanged).toBe(0);
  // ...and the surface itself really was re-surfaced
  expect(r.surfaceChangedFraction).toBeGreaterThan(0.95);

  // 3. Perspective: GPU joints land where the CPU camera maths puts them, head-on and on a
  // strongly foreshortened floor (straight, converging lines are the only way to agree)
  expect(r.headOn.fraction).toBeGreaterThan(0.995);
  expect(r.floorAgreement.fraction).toBeGreaterThan(0.99);

  // 4. Physical scale within 5%, uncalibrated and after one known-distance calibration
  expect(Math.abs(r.headOnSpacing.measured / r.headOnSpacing.expected - 1)).toBeLessThan(0.05);
  expect(r.calibratedAgreement.fraction).toBeGreaterThan(0.995);
  expect(Math.abs(r.calibratedSpacing.measured / r.calibratedSpacing.expected - 1)).toBeLessThan(0.05);

  // 5. Colour fidelity on a neutral, evenly lit wall: CIEDE2000 <= 6
  expect(r.colour.deltaE).toBeLessThanOrEqual(6);

  // 6. No seam discontinuity: the jump across repeat edges stays within the texture's own
  // pixel-to-pixel variation
  expect(r.seams.seamCount).toBeGreaterThan(0);
  expect(r.seams.seamGrad).toBeLessThanOrEqual(r.seams.bodyGrad);

  // 7. Determinism
  expect(r.deterministic).toBe(true);

  // 8. Fail safely: a clear error, never a fallback render
  expect(r.failures.noLayers).toBe('NeedsSurfaceReviewError');
  expect(r.failures.emptyMask).toBe('NeedsSurfaceReviewError');
  expect(r.failures.brokenTexture).not.toBe('resolved');

  expect(errors).toEqual([]);
});
