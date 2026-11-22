import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { worktreePath } from '../../src/worktree/path.js';
import { cleanupTempHomes, makeTempHome } from '../support/temp-home.js';
import { expectRefusal } from '../support/worktree-fixture.js';

afterEach(cleanupTempHomes);

describe('worktree location', () => {
  test('the path is under FACTORY_HOME/cache/worktrees when FACTORY_HOME is set, not under the default cache of that test\'s HOME', () => {
    const tmp = makeTempHome();
    const home = join(tmp, 'factory-home');

    const path = worktreePath({ HOME: tmp, FACTORY_HOME: home }, 'example-frontend', 'FE-123');

    expect(path).toBe(join(tmp, 'factory-home', 'cache', 'worktrees', 'example-frontend', 'FE-123'));
    expect(path.startsWith(join(tmp, '.cache', 'factory'))).toBe(false);
  });

  test('the path is under <HOME>/.cache/factory/worktrees when FACTORY_HOME is not set', () => {
    const tmp = makeTempHome();

    const path = worktreePath({ HOME: tmp }, 'example-frontend', 'FE-123');

    expect(path).toBe(join(tmp, '.cache', 'factory', 'worktrees', 'example-frontend', 'FE-123'));
  });

  test('a repo or ticket that contains a slash or .. is refused as worktree_invalid, exit code 2', () => {
    const tmp = makeTempHome();
    const env = { HOME: tmp, FACTORY_HOME: join(tmp, 'factory-home') };
    const pairs: Array<[string, string]> = [
      ['example-org/example-frontend', 'FE-123'],
      ['..', 'FE-123'],
      ['example-frontend', 'FE/123'],
      ['example-frontend', '..'],
      ['example-frontend', '../FE-123'],
      ['example-frontend', ''],
    ];

    for (const [repo, ticket] of pairs) {
      expectRefusal(() => worktreePath(env, repo, ticket), ['worktree_invalid']);
    }
    expect(pairs).toHaveLength(6);
  });
});
