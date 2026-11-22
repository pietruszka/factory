import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['test/setup/real-home.ts', 'test/setup/network-block.ts'],
  },
});
