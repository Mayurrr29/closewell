import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts', 'src/**/*.test.ts'],
    setupFiles: ['test/setup.ts'],
    // One database server; files run one at a time, each in its own database.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      JOBS_ENABLED: 'false',
      AI_PROVIDER: 'mock',
      EMAIL_MODE: 'mock',
      AI_TIMEOUT_MS: '1500',
      APP_ORIGIN: 'http://app.test',
      API_PUBLIC_URL: 'http://api.test',
    },
  },
});
