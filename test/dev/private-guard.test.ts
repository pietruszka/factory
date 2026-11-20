import { mkdtempSync, mkdirSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { assertNotPrivatePath } from '../../src/dev/private-guard.js';

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('assertNotPrivatePath', () => {
  test('refuses paths inside ~/.factory-private', () => {
    const userHome = makeTempDir('user-home-');
    const candidate = join(userHome, '.factory-private', 'runs');

    expect(() => assertNotPrivatePath(candidate, '/tmp/factory-home', { HOME: userHome })).toThrow(
      /\.factory-private/,
    );
  });

  test('refuses paths inside sibling <home>-private', () => {
    const root = makeTempDir('factory-root-');
    const factoryHome = join(root, 'factory-home');
    const candidate = join(root, 'factory-home-private', 'runs');

    expect(() => assertNotPrivatePath(candidate, factoryHome, { HOME: root })).toThrow(/private/);
  });

  test('refuses a child path whose segment starts with ".."', () => {
    const userHome = makeTempDir('user-home-');
    const privateRoot = join(userHome, '.factory-private');
    const candidate = join(privateRoot, '..cache');

    expect(() => assertNotPrivatePath(candidate, '/tmp/factory-home', { HOME: userHome })).toThrow(
      /private/i,
    );
  });

  test('refuses a symlink path that resolves into ~/.factory-private', () => {
    const userHome = makeTempDir('user-home-');
    const privateRoot = join(userHome, '.factory-private');
    const aliasedRoot = join(userHome, 'alias');
    mkdirSync(privateRoot, { recursive: true });
    symlinkSync(privateRoot, aliasedRoot);

    const candidate = join(aliasedRoot, 'runs');
    expect(() => assertNotPrivatePath(candidate, '/tmp/factory-home', { HOME: userHome })).toThrow(
      /private/i,
    );
  });

  test.runIf(process.platform === 'darwin')(
    'refuses case-variant paths on case-insensitive macOS filesystems',
    () => {
      const userHome = makeTempDir('user-home-');
      const privateRoot = join(userHome, '.factory-private');
      mkdirSync(privateRoot, { recursive: true });

      const upperCandidate = join(userHome.toUpperCase(), '.FACTORY-PRIVATE', 'runs');
      expect(() =>
        assertNotPrivatePath(upperCandidate, '/tmp/factory-home', { HOME: userHome }),
      ).toThrow(/private/i);
    },
  );

  test('allows a normal non-private path', () => {
    const userHome = makeTempDir('user-home-');
    const candidate = join(userHome, 'sandbox-home', 'runs');

    expect(() =>
      assertNotPrivatePath(candidate, join(userHome, 'sandbox-home'), { HOME: userHome }),
    ).not.toThrow();
  });

  test('treats empty HOME as unset when checking ~/.factory-private', () => {
    const candidate = join(homedir(), '.factory-private', 'runs');

    expect(() => assertNotPrivatePath(candidate, '/tmp/factory-home', { HOME: '' })).toThrow(
      /private/i,
    );
  });
});
