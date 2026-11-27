import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { resolveConfig } from 'vitest/node';

describe('vitest config', () => {
  test('npm test uses the forks pool with at most two workers', async () => {
    // resolveConfig is typed as Vite's ResolvedConfig; the Vitest fields sit on `.test`.
    const { test: vitest } = (await resolveConfig({
      config: resolve(import.meta.dirname, '../vitest.config.ts'),
    })) as { test?: { pool?: string; maxWorkers?: number } };

    expect(vitest?.pool).toBe('forks');
    expect(vitest?.maxWorkers).toBe(2);
  });
});
