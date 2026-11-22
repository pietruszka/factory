import { mkdirSync, readdirSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { resolveFactoryPaths } from '../../src/platform/paths.js';
import { cleanupTempHomes, makeTempHome } from '../support/temp-home.js';

const DARWIN = { platform: 'darwin' } as const;

afterEach(cleanupTempHomes);

function refusal(fn: () => unknown): Record<string, unknown> {
  try {
    fn();
  } catch (error) {
    return error as Record<string, unknown>;
  }
  throw new Error('expected the call to be refused, but it returned');
}

describe('path resolver defaults', () => {
  test('with HOME=<tmp> and no FACTORY_HOME, home is <tmp>/.factory', () => {
    const tmp = makeTempHome();

    expect(resolveFactoryPaths({ HOME: tmp }).home).toBe(join(tmp, '.factory'));
  });

  test('private sibling is <tmp>/.factory-private', () => {
    const tmp = makeTempHome();

    expect(resolveFactoryPaths({ HOME: tmp }).privateHome).toBe(join(tmp, '.factory-private'));
  });

  test('cache root is <tmp>/.cache/factory, worktrees root <cache>/worktrees, sandbox root <cache>/sandbox', () => {
    const tmp = makeTempHome();

    const paths = resolveFactoryPaths({ HOME: tmp });

    expect(paths.cacheRoot).toBe(join(tmp, '.cache', 'factory'));
    expect(paths.worktreesRoot).toBe(join(tmp, '.cache', 'factory', 'worktrees'));
    expect(paths.sandboxRoot).toBe(join(tmp, '.cache', 'factory', 'sandbox'));
  });

  test('baseline reports dir stays <home>/sandbox/baseline-reports', () => {
    const tmp = makeTempHome();

    expect(resolveFactoryPaths({ HOME: tmp }).baselineReportsDir).toBe(
      join(tmp, '.factory', 'sandbox', 'baseline-reports'),
    );
  });

  test('database stays under the factory home, not the cache', () => {
    const tmp = makeTempHome();

    expect(resolveFactoryPaths({ HOME: tmp }).dbPath).toBe(join(tmp, '.factory', 'factory.db'));
  });

  test('resolving paths creates no folder and writes nothing', () => {
    const tmp = makeTempHome();

    resolveFactoryPaths({ HOME: tmp });
    resolveFactoryPaths({ HOME: tmp, FACTORY_HOME: join(tmp, 'fh') });

    expect(readdirSync(tmp)).toEqual([]);
  });
});

describe('path resolver with FACTORY_HOME', () => {
  test('FACTORY_HOME=<tmp>/fh gives home <tmp>/fh, private <tmp>/fh-private, cache <tmp>/fh/cache', () => {
    const tmp = makeTempHome();

    const paths = resolveFactoryPaths({ HOME: tmp, FACTORY_HOME: join(tmp, 'fh') });

    expect(paths.home).toBe(join(tmp, 'fh'));
    expect(paths.privateHome).toBe(join(tmp, 'fh-private'));
    expect(paths.cacheRoot).toBe(join(tmp, 'fh', 'cache'));
    expect(paths.worktreesRoot).toBe(join(tmp, 'fh', 'cache', 'worktrees'));
    expect(paths.sandboxRoot).toBe(join(tmp, 'fh', 'cache', 'sandbox'));
  });

  test('FACTORY_HOME=~/x expands ~ against HOME', () => {
    const tmp = makeTempHome();

    expect(resolveFactoryPaths({ HOME: tmp, FACTORY_HOME: '~/x' }).home).toBe(join(tmp, 'x'));
  });

  test('XDG_CACHE_HOME=<tmp>/xdg changes nothing', () => {
    const tmp = makeTempHome();
    const xdg = join(tmp, 'xdg');

    const withoutHome = resolveFactoryPaths({ HOME: tmp, XDG_CACHE_HOME: xdg });
    const withHome = resolveFactoryPaths({
      HOME: tmp,
      FACTORY_HOME: join(tmp, 'fh'),
      XDG_CACHE_HOME: xdg,
    });

    expect(withoutHome).toEqual(resolveFactoryPaths({ HOME: tmp }));
    expect(withoutHome.cacheRoot).toBe(join(tmp, '.cache', 'factory'));
    expect(withHome.cacheRoot).toBe(join(tmp, 'fh', 'cache'));
  });

  test('relative FACTORY_HOME is refused with code factory_home_relative and a next action', () => {
    const tmp = makeTempHome();

    const error = refusal(() => resolveFactoryPaths({ HOME: tmp, FACTORY_HOME: 'fh' }));

    expect(error).toMatchObject({ code: 'factory_home_relative', exitCode: 2 });
    expect(String(error.next).length).toBeGreaterThan(0);
  });
});

describe('protected folders are refused', () => {
  test.each(['Documents', 'Desktop', 'Downloads'])(
    'FACTORY_HOME=<HOME>/%s/fh is refused: code protected_folder, where = the path, next names ~/.cache/factory',
    (folder) => {
      const tmp = makeTempHome();
      const target = join(tmp, folder, 'fh');

      const error = refusal(() => resolveFactoryPaths({ HOME: tmp, FACTORY_HOME: target }, DARWIN));

      expect(error).toMatchObject({ code: 'protected_folder', where: target, exitCode: 2 });
      expect(String(error.next)).toContain('~/.cache/factory');
    },
  );

  test('a nested path <HOME>/Documents/a/b is refused', () => {
    const tmp = makeTempHome();
    const target = join(tmp, 'Documents', 'a', 'b');

    const error = refusal(() => resolveFactoryPaths({ HOME: tmp, FACTORY_HOME: target }, DARWIN));

    expect(error).toMatchObject({ code: 'protected_folder', where: target });
  });

  test('case variants (<HOME>/documents/fh) are refused on darwin', () => {
    const tmp = makeTempHome();
    const target = join(tmp, 'documents', 'fh');

    const error = refusal(() => resolveFactoryPaths({ HOME: tmp, FACTORY_HOME: target }, DARWIN));

    expect(error).toMatchObject({ code: 'protected_folder' });
  });

  test('a symlink outside Documents that points into Documents is refused', () => {
    const tmp = makeTempHome();
    mkdirSync(join(tmp, 'Documents'));
    symlinkSync(join(tmp, 'Documents'), join(tmp, 'link'));
    const target = join(tmp, 'link', 'fh');

    const error = refusal(() => resolveFactoryPaths({ HOME: tmp, FACTORY_HOME: target }, DARWIN));

    expect(error).toMatchObject({ code: 'protected_folder', where: target });
  });

  test('<HOME>/Documentsx/fh is allowed', () => {
    const tmp = makeTempHome();
    const target = join(tmp, 'Documentsx', 'fh');

    expect(resolveFactoryPaths({ HOME: tmp, FACTORY_HOME: target }, DARWIN).home).toBe(target);
  });

  test.each([
    ['cache root', ['cache']],
    ['worktrees root', ['cache', 'worktrees']],
    ['sandbox root', ['cache', 'sandbox']],
  ])(
    'the %s is checked, not only home',
    (_label, segments) => {
      const tmp = makeTempHome();
      const factoryHome = join(tmp, 'fh');
      const inside = join(tmp, 'Documents', 'elsewhere');
      mkdirSync(inside, { recursive: true });
      mkdirSync(join(factoryHome, ...segments.slice(0, -1)), { recursive: true });
      const linkPath = join(factoryHome, ...segments);
      symlinkSync(inside, linkPath);

      const error = refusal(() =>
        resolveFactoryPaths({ HOME: tmp, FACTORY_HOME: factoryHome }, DARWIN),
      );

      expect(error).toMatchObject({ code: 'protected_folder', where: linkPath, exitCode: 2 });
    },
  );
});
