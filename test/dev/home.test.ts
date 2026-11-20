import { existsSync, mkdtempSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { createDevHome, DEV_HOME_MARKER, resolveFactoryHome } from '../../src/dev/home.js';

function makeTempDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

describe('resolveFactoryHome', () => {
  test('refuses when FACTORY_HOME is unset', () => {
    const homeDir = makeTempDir('factory-home-');

    expect(() => resolveFactoryHome({ HOME: homeDir })).toThrow(/FACTORY_HOME/);
  });

  test.each(['~/.factory', '~/.factory/dev'])(
    'refuses FACTORY_HOME at or inside ~/.factory for %s',
    (configuredHome) => {
      const homeDir = makeTempDir('factory-home-');

      expect(() =>
        resolveFactoryHome({ HOME: homeDir, FACTORY_HOME: configuredHome }),
      ).toThrow(/\.factory/);
    },
  );

  test('refuses FACTORY_HOME inside ~/.factory-private', () => {
    const homeDir = makeTempDir('factory-home-');
    const forbidden = join(homeDir, '.factory-private', 'dev-home');

    expect(() =>
      resolveFactoryHome({ HOME: homeDir, FACTORY_HOME: forbidden }),
    ).toThrow(/private/i);
  });

  test('refuses missing FACTORY_HOME directory and does not create it', () => {
    const homeDir = makeTempDir('factory-home-');
    const missingHome = join(homeDir, 'missing-home');

    expect(() =>
      resolveFactoryHome({ HOME: homeDir, FACTORY_HOME: missingHome }),
    ).toThrow(/exist|marker/i);
    expect(existsSync(missingHome)).toBe(false);
  });

  test('refuses existing folder without marker file', () => {
    const homeDir = makeTempDir('factory-home-');
    const factoryHome = join(homeDir, 'existing-home');
    mkdirSync(factoryHome, { recursive: true });

    expect(() =>
      resolveFactoryHome({
        HOME: homeDir,
        FACTORY_HOME: factoryHome,
      }),
    ).toThrow(/marker/i);
  });

  test('accepts an existing folder with marker file', () => {
    const homeDir = makeTempDir('factory-home-');
    const factoryHome = join(homeDir, 'existing-home');
    mkdirSync(factoryHome, { recursive: true });
    writeFileSync(join(factoryHome, DEV_HOME_MARKER), 'factory dev home marker\n', 'utf8');

    expect(resolveFactoryHome({ HOME: homeDir, FACTORY_HOME: factoryHome })).toBe(factoryHome);
  });
});

describe('createDevHome', () => {
  test('creates marker for a fresh throwaway home path', () => {
    const homeDir = makeTempDir('factory-home-');
    const factoryHome = join(homeDir, 'dev-home');

    const resolved = createDevHome(factoryHome, { HOME: homeDir });

    expect(resolved).toBe(factoryHome);
    const markerPath = join(factoryHome, DEV_HOME_MARKER);
    expect(readFileSync(markerPath, 'utf8')).toContain('factory dev home marker');
  });

  test('refuses existing folder without marker file', () => {
    const homeDir = makeTempDir('factory-home-');
    const factoryHome = join(homeDir, 'existing-home');
    mkdirSync(factoryHome, { recursive: true });

    expect(() => createDevHome(factoryHome, { HOME: homeDir })).toThrow(/marker/i);
  });

  test('refuses "~" when the home exists without marker file', () => {
    const homeDir = makeTempDir('factory-home-');

    expect(() => createDevHome('~', { HOME: homeDir })).toThrow(/marker/i);
  });

  test('refuses symlink paths that resolve into ~/.factory', () => {
    const homeDir = makeTempDir('factory-home-');
    const defaultFactoryHome = join(homeDir, '.factory');
    const aliasRoot = join(homeDir, 'factory-link');
    mkdirSync(defaultFactoryHome, { recursive: true });
    symlinkSync(defaultFactoryHome, aliasRoot);

    expect(() => createDevHome(join(aliasRoot, 'dev'), { HOME: homeDir })).toThrow(/\.factory/);
  });

  test.runIf(process.platform === 'darwin')('refuses case-variant paths inside ~/.factory', () => {
    const homeDir = makeTempDir('factory-home-');
    mkdirSync(join(homeDir, '.factory'), { recursive: true });

    expect(() => createDevHome(join(homeDir, '.Factory', 'dev'), { HOME: homeDir })).toThrow(
      /\.factory/i,
    );
  });
});
