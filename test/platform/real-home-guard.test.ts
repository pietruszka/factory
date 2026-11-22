import { mkdirSync, symlinkSync } from 'node:fs';
import { userInfo } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { resolveFactoryPaths } from '../../src/platform/paths.js';
import { cleanupTempHomes, makeTempHome } from '../support/temp-home.js';

const REAL_HOME_KEY = Symbol.for('factory.realHome');

afterEach(cleanupTempHomes);

describe('real homes are never touched by tests', () => {
  test('the vitest setup records the real home before any test runs', () => {
    const recorded = (globalThis as Record<symbol, unknown>)[REAL_HOME_KEY];

    expect(recorded).toBe(userInfo().homedir);
  });

  test('resolving paths while HOME equals the real user home fails with real_home_in_test', () => {
    let thrown: unknown;
    try {
      resolveFactoryPaths({ HOME: userInfo().homedir });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: 'real_home_in_test' });
  });

  test('resolving paths with a temp HOME is allowed', () => {
    const tmp = makeTempHome();

    expect(resolveFactoryPaths({ HOME: tmp }).home).toBe(join(tmp, '.factory'));
  });
});

describe('the guard covers the real home\'s factory folders, not only HOME', () => {
  // The "real home" here is an injected temp folder; the actual real home is never used.
  const protectedRoots = [
    ['.factory', '.factory'],
    ['.factory-private', '.factory-private'],
    ['.cache/factory', join('.cache', 'factory')],
  ] as const;

  function refusedCode(env: NodeJS.ProcessEnv, realHome: string): unknown {
    try {
      resolveFactoryPaths(env, { realHome });
    } catch (error) {
      return (error as { code?: string }).code;
    }
    return undefined;
  }

  test.each(protectedRoots)(
    'FACTORY_HOME at the real home\'s %s with a temp HOME fails with real_home_in_test',
    (_label, relPath) => {
      const fakeRealHome = makeTempHome();
      const tmp = makeTempHome();

      expect(refusedCode({ HOME: tmp, FACTORY_HOME: join(fakeRealHome, relPath) }, fakeRealHome)).toBe(
        'real_home_in_test',
      );
    },
  );

  test.each(protectedRoots)(
    'FACTORY_HOME inside the real home\'s %s fails with real_home_in_test',
    (_label, relPath) => {
      const fakeRealHome = makeTempHome();
      const tmp = makeTempHome();

      expect(
        refusedCode({ HOME: tmp, FACTORY_HOME: join(fakeRealHome, relPath, 'nested', 'fh') }, fakeRealHome),
      ).toBe('real_home_in_test');
    },
  );

  test('HOME equal to the injected real home is refused; a different temp HOME is allowed', () => {
    const fakeRealHome = makeTempHome();
    const tmp = makeTempHome();

    expect(refusedCode({ HOME: fakeRealHome }, fakeRealHome)).toBe('real_home_in_test');
    expect(refusedCode({ HOME: tmp }, fakeRealHome)).toBeUndefined();
  });

  test('a FACTORY_HOME reaching the real home\'s .factory through a symlink is refused', () => {
    const fakeRealHome = makeTempHome();
    const tmp = makeTempHome();
    const link = join(tmp, 'link');
    mkdirSync(join(fakeRealHome, '.factory'));
    symlinkSync(join(fakeRealHome, '.factory'), link);

    expect(refusedCode({ HOME: tmp, FACTORY_HOME: link }, fakeRealHome)).toBe('real_home_in_test');
  });

  test('a FACTORY_HOME next to the real home\'s .factory (".factory2", ".factoryx") is allowed', () => {
    const fakeRealHome = makeTempHome();
    const tmp = makeTempHome();

    expect(refusedCode({ HOME: tmp, FACTORY_HOME: join(fakeRealHome, '.factory2') }, fakeRealHome)).toBeUndefined();
    expect(refusedCode({ HOME: tmp, FACTORY_HOME: join(fakeRealHome, 'work', 'fh') }, fakeRealHome)).toBeUndefined();
  });
});
