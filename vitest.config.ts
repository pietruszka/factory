import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Build output is never a test source.
    exclude: [...configDefaults.exclude, 'dist/**'],
    setupFiles: ['test/setup/real-home.ts', 'test/setup/network-block.ts'],
  },
});
