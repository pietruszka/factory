import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Build output and the to-do sample's own pack inputs (it has its own tests) are never test sources.
    exclude: [...configDefaults.exclude, 'dist/**', 'scripts/sandbox/todo-app/**'],
    setupFiles: ['test/setup/real-home.ts', 'test/setup/network-block.ts'],
    // Vitest 5 has no min forks; maxWorkers is the cap (poolOptions was removed in Vitest 4).
    pool: 'forks',
    maxWorkers: 2,
  },
});
