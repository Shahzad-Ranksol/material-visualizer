import { defineConfig } from 'vitest/config';

// Unit tests for the pure maths (no DOM/WebGL). Browser/GPU behaviour is covered by the
// Playwright suites in tests/e2e.
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
