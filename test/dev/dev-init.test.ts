import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { runDevInit } from '../../src/dev/dev-init.js';

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('runDevInit', () => {
  test('creates throwaway home marker and home-level config inside the target path', () => {
    const userHome = makeTempDir('factory-user-home-');
    const throwawayHome = join(userHome, 'factory-dev-home');
    const unrelatedHome = join(userHome, 'ignored-factory-home');

    const configPath = runDevInit(throwawayHome, {
      HOME: userHome,
      FACTORY_HOME: unrelatedHome,
    });

    expect(configPath).toBe(join(throwawayHome, 'config.yaml'));
    expect(readFileSync(join(throwawayHome, '.factory-dev-home'), 'utf8')).toContain(
      'factory dev home marker',
    );
    const config = readFileSync(configPath, 'utf8');
    expect(config).toContain('version: 1');
    expect(config).toContain('models:');
    expect(config).toContain('planner:');
    expect(config).toContain('model: "gpt-5.3-codex-high"');
    expect(config).toContain('reviewer:');
    expect(config).toContain('temporary: true');
    expect(config).toContain('visionJudge:');
    expect(config).toContain('cli: null');
    expect(config).not.toContain('protected-paths');
    expect(existsSync(join(throwawayHome, '.factory'))).toBe(false);
    expect(existsSync(join(unrelatedHome, 'config.yaml'))).toBe(false);
  });
});
