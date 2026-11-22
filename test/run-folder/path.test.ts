import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { runFolderPath } from '../../src/run-folder/path.js';
import { errorFields, thrownBy } from '../support/event-log.js';
import { cleanupTempHomes, makeTempHome } from '../support/temp-home.js';

afterEach(cleanupTempHomes);

const BAD_SEGMENTS = ['a/b', '..', '../x', 'x/..', '~', '~/x', '/tmp/example-frontend', '', 'a b'];

describe('run folder path', () => {
  test('the path is under FACTORY_HOME when that is set, not under the default home of that test\'s HOME', () => {
    const tmp = makeTempHome();
    const factoryHome = join(tmp, 'custom-home');

    const path = runFolderPath({ HOME: tmp, FACTORY_HOME: factoryHome }, 'example-frontend', 'FE-123');

    expect(path).toBe(join(tmp, 'custom-home', 'runs', 'example-frontend', 'FE-123'));
    expect(path.startsWith(join(tmp, '.factory'))).toBe(false);
  });

  test('the path is under <HOME>/.factory/runs when FACTORY_HOME is not set', () => {
    const tmp = makeTempHome();

    const path = runFolderPath({ HOME: tmp }, 'example-frontend', 'FE-123');

    expect(path).toBe(join(tmp, '.factory', 'runs', 'example-frontend', 'FE-123'));
  });

  test('the path is never under the cache root', () => {
    const tmp = makeTempHome();
    const factoryHome = join(tmp, 'factory-home');

    const path = runFolderPath({ HOME: tmp, FACTORY_HOME: factoryHome }, 'example-frontend', 'FE-123');

    expect(path).toBe(join(factoryHome, 'runs', 'example-frontend', 'FE-123'));
    expect(path.startsWith(join(factoryHome, 'cache'))).toBe(false);
  });

  test('runFolderPath is a pure function of env, repo and ticket and creates nothing', () => {
    const tmp = makeTempHome();
    const factoryHome = join(tmp, 'factory-home');
    const env = { HOME: tmp, FACTORY_HOME: factoryHome };

    const first = runFolderPath(env, 'example-frontend', 'FE-123');
    const second = runFolderPath(env, 'example-frontend', 'FE-123');
    const other = runFolderPath(env, 'example-frontend', 'FE-456');

    expect(first).toBe(join(factoryHome, 'runs', 'example-frontend', 'FE-123'));
    expect(second).toBe(first);
    expect(other).toBe(join(factoryHome, 'runs', 'example-frontend', 'FE-456'));
    expect(existsSync(factoryHome)).toBe(false);
    expect(readdirSync(tmp)).toEqual([]);
  });

  test('a repo or ticket that contains a slash or .. is refused as run_folder_invalid, exit code 2', () => {
    const tmp = makeTempHome();
    const env = { HOME: tmp, FACTORY_HOME: join(tmp, 'factory-home') };

    const results = [
      ...BAD_SEGMENTS.map((repo) => ({ field: 'repo', value: repo, ...refusal(() => runFolderPath(env, repo, 'FE-123')) })),
      ...BAD_SEGMENTS.map((ticket) => ({
        field: 'ticket',
        value: ticket,
        ...refusal(() => runFolderPath(env, 'example-frontend', ticket)),
      })),
    ];

    expect(results).toEqual(
      [...BAD_SEGMENTS.map((value) => ['repo', value]), ...BAD_SEGMENTS.map((value) => ['ticket', value])].map(
        ([field, value]) => ({ field, value, code: 'run_folder_invalid', exitCode: 2, suggestsSlug: true }),
      ),
    );
  });
});

function refusal(fn: () => unknown): { code?: string; exitCode?: number; suggestsSlug: boolean } {
  const error = errorFields(thrownBy(fn));
  return {
    code: error.code,
    exitCode: error.exitCode,
    suggestsSlug: (error.next ?? '').includes('example-frontend') && (error.next ?? '').includes('FE-123'),
  };
}
