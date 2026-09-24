import { defineConfig, devices } from '@playwright/test';

// Browser suites: golden-image checks of the WebGL renderer, the studio's customer flow, the
// Area Editor and the vendor showcase editor's Adjust area save path (mocked API).
// Both run against the Vite dev server, which also serves the golden harness page.
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  // The model specs each run SAM/SegFormer/MoGe on the CPU; three at once starve each other
  // past the per-test timeout
  workers: 2,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    ...devices['Desktop Chrome'],
    launchOptions: { args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] },
  },
  webServer: {
    command: 'npx vite --port 3000 --strictPort',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
