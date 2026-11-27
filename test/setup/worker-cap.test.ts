import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { resolveConfig, type ResolvedConfig } from 'vitest/node';

const repoRoot = join(import.meta.dirname, '..', '..');

describe('npm test runs with at most two workers', () => {
  test('the resolved config caps maxWorkers at 2', async () => {
    // resolveConfig returns Vite's ResolvedConfig; Vitest hangs its options on `.test`.
    const viteConfig = await resolveConfig({ root: repoRoot });
    const vitestConfig = (viteConfig as unknown as { test: ResolvedConfig }).test;

    expect(vitestConfig.maxWorkers).toBe(2);
  });
});
