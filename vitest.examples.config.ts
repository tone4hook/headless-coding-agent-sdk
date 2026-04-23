import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['examples/**/*.ts'],
    environment: 'node',
    testTimeout: 180_000,
  },
});
