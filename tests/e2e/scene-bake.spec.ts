import { test, expect } from '@playwright/test';

// Opt-in (npm run scenes:bake, real models, several minutes per scene): runs every preset scene
// item's recipe in /dev/scenes and writes the masks/planes the studio ships. BAKE=missing bakes
// only items not baked yet; BAKE_SCENE=<id> limits it to one scene. Re-run after changing a
// recipe or a scene photo, then review and correct the items in /dev/scenes. Don't edit source
// files while it runs: a hot reload restarts the page and stops the bake.
test.skip(!process.env.BAKE, 'opt-in: BAKE=1');

test('bake scene items', async ({ page }) => {
  test.setTimeout(60 * 60_000);
  page.on('console', (m) => m.type() === 'error' && console.log('[page]', m.text()));
  const scene = process.env.BAKE_SCENE ? `&scene=${process.env.BAKE_SCENE}` : '';
  // Wait for the baked state to load before starting (?run reads it to skip baked items)
  await page.goto(`/dev/scenes?run=${process.env.BAKE === 'missing' ? 'missing' : 'all'}${scene}`);
  const log = page.getByTestId('bake-log');
  await expect(log).toContainText('Done.', { timeout: 60 * 60_000 });
  console.log(await log.textContent());
});
