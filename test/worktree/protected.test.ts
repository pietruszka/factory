import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createWorktree } from '../../src/worktree/create.js';
import { worktreePath } from '../../src/worktree/path.js';
import { cleanupEventLogTest } from '../support/event-log.js';
import { cleanupTempHomes, makeTempHome } from '../support/temp-home.js';
import { expectRefusal, eventsOf, listedWorktrees, worktreeFixture } from '../support/worktree-fixture.js';

afterEach(() => {
  cleanupEventLogTest();
  cleanupTempHomes();
});

const PROTECTED = ['Documents', 'Desktop', 'Downloads'] as const;

describe('worktree in a protected folder', () => {
  test('a computed or configured worktree path inside <HOME>/Documents, <HOME>/Desktop or <HOME>/Downloads is refused as protected_folder and no worktree is created', () => {
    const fx = worktreeFixture();

    for (const folder of PROTECTED) {
      // Computed: the factory home itself sits inside the protected folder.
      const tmp = makeTempHome();
      const env = { HOME: tmp, FACTORY_HOME: join(tmp, folder, 'factory-home') };
      expectRefusal(() => worktreePath(env, 'example-frontend', 'FE-123'), ['protected_folder']);

      // Configured: the caller passes the path.
      const configured = join(fx.sb.tmp, folder, 'worktrees', 'FE-123');
      expectRefusal(() => createWorktree(fx.options({ path: configured })), ['protected_folder']);
      expect(existsSync(join(fx.sb.tmp, folder))).toBe(false);
    }

    expect(listedWorktrees(fx.repo.path)).toEqual([fx.repo.path]);
    expect(eventsOf(fx.reader, 'run-1', 'worktree_created')).toEqual([]);
  });

  test('a path that is not inside those folders is not refused for this reason', () => {
    for (const folder of ['elsewhere', 'Documents-old']) {
      const fx = worktreeFixture();
      const path = join(fx.sb.tmp, folder, 'FE-123');

      const created = createWorktree(fx.options({ path }));

      expect(created.path).toBe(path);
      expect(existsSync(join(path, '.git'))).toBe(true);
    }
  });
});
