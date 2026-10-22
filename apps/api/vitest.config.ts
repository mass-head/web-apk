import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 180000,
    include: ['test/**/*.test.ts'],
    exclude: ['data/**', 'node_modules/**', 'dist/**'],
    env: {
      STORAGE_DRIVER: 'local',
      NODE_ENV: 'test',
    },
  },
});
