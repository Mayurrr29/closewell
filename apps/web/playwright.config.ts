import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against a running stack:
 *   API on :4000 (with MongoDB) and the web dev server on :5173.
 * Start both with `npm run dev` from the repository root, then `npm run test:e2e`.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 90_000,
  fullyParallel: false,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'retain-on-failure',
    ...devices['Desktop Chrome'],
  },
});
