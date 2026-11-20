import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
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
    expect(config).not.toContain('protected-paths');
    expect(existsSync(join(throwawayHome, '.factory'))).toBe(false);
    expect(existsSync(join(unrelatedHome, 'config.yaml'))).toBe(false);
  });
});

describe('dev:init entry point', () => {
  test('runs via npm script and creates home-level config in the provided throwaway home', () => {
    const repoRoot = fileURLToPath(new URL('../..', import.meta.url));
    const userHome = makeTempDir('factory-user-home-');
    const throwawayHome = join(userHome, 'cli-dev-home');

    const result = spawnSync('npm', ['run', 'dev:init', '--', throwawayHome], {
      cwd: resolve(repoRoot),
      env: {
        ...process.env,
        HOME: userHome,
      },
      encoding: 'utf8',
    });

    expect(result.status).toBe(0);
    expect(existsSync(join(throwawayHome, '.factory-dev-home'))).toBe(true);
    expect(existsSync(join(throwawayHome, 'config.yaml'))).toBe(true);
    expect(existsSync(join(throwawayHome, '.factory'))).toBe(false);
    const config = readFileSync(join(throwawayHome, 'config.yaml'), 'utf8');
    expect(config).not.toContain('protected-paths');
  });
});
