import { test, expect } from '@playwright/test';

// The kitchen app's paints against the client's colour references (tests/fixtures/kitchen-refs/:
// the Classic kitchen render with its cabinets painted, pixel-aligned with our photo). Each
// reference colour is rendered by the studio itself — the textured render on the baked light, in the browser —
// and compared per pixel over the fronts' masks (CIEDE2000). The swatches were fitted to these
// references (npm run finishes:fromref); what remains is where the AI-made references' own light
// differs from the photo's (their mouldings a touch darker, the island's right end lit more evenly).
// The limits guard against a regression, not a re-fit.

const FRONTS = ['wall-cabinets', 'tall-units', 'canopy', 'base-cabinets', 'island'];
const CASES = [
  { ref: 'burgundy', material: 'kit-burgundy' },
  { ref: 'cherry-red', material: 'kit-cherry-red' },
  { ref: 'burnt-orange', material: 'kit-burnt-orange' },
  { ref: 'charcoal', material: 'kit-charcoal' },
  { ref: 'dark-wood', material: 'kit-dark-walnut' },
];
// Median ΔE2000 (2 ≈ just noticeable side by side) and the 90th percentile
const MEDIAN = 3.6;
const P90 = 10.5;

for (const { ref, material } of CASES) {
  test(`${ref}: the studio's render matches the client's reference`, async ({ page }) => {
    test.setTimeout(120_000);
    const look = FRONTS.map((id) => `${id}:${material}`).join(',');
    await page.goto(`/design?scene=kitchen&look=${encodeURIComponent(look)}&step=7`);
    await expect(page.getByTestId('look-image')).toBeVisible({ timeout: 90_000 });
    await expect(page.getByText('Preparing your finish…')).toBeHidden({ timeout: 90_000 });
    const result = await page.evaluate(
      async ({ ref, fronts }) => {
        // Served by the dev server, imported in the page (a path, not a module of this spec)
        const deltaModule = '/services/renderer/deltaE.ts';
        const { deltaE2000 } = (await import(/* @vite-ignore */ deltaModule)) as { deltaE2000: (a: number[], b: number[]) => number };
        const baked = await (await fetch('/__scenes/baked')).json();
        const load = async (src: string, w?: number, h?: number) => {
          const img = new Image();
          img.src = src;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = w ?? img.naturalWidth;
          c.height = h ?? img.naturalHeight;
          const ctx = c.getContext('2d', { willReadFrequently: true })!;
          ctx.drawImage(img, 0, 0, c.width, c.height);
          return ctx.getImageData(0, 0, c.width, c.height);
        };
        const look = await load((document.querySelector('[data-testid=look-image]') as HTMLImageElement).src);
        const { width: w, height: h } = look;
        const target = await load(`/tests/fixtures/kitchen-refs/${ref}.jpg`, w, h);
        const weight = new Float32Array(w * h);
        for (const id of fronts) {
          const item = baked.kitchen.items[id];
          const occ = item.occluder ? await load(item.occluder, w, h) : null;
          for (const part of item.parts) {
            const m = await load(part.mask, w, h);
            for (let i = 0; i < w * h; i++) weight[i] = Math.max(weight[i], (m.data[i * 4] / 255) * (occ ? 1 - occ.data[i * 4] / 255 : 1));
          }
        }
        const de: number[] = [];
        for (let i = 0; i < w * h; i++) {
          if (weight[i] <= 0.95) continue;
          const p = i * 4;
          de.push(deltaE2000([look.data[p], look.data[p + 1], look.data[p + 2]], [target.data[p], target.data[p + 1], target.data[p + 2]]));
        }
        de.sort((a, b) => a - b);
        return { n: de.length, median: de[Math.floor(de.length / 2)], p90: de[Math.floor(de.length * 0.9)] };
      },
      { ref, fronts: FRONTS }
    );
    console.log(`${ref}: ΔE2000 median ${result.median.toFixed(2)}, p90 ${result.p90.toFixed(2)} over ${result.n} px`);
    expect(result.n).toBeGreaterThan(100_000);
    expect(result.median).toBeLessThan(MEDIAN);
    expect(result.p90).toBeLessThan(P90);
  });
}
