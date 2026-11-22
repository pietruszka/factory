import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createWorktree } from '../../src/worktree/create.js';
import { cleanupEventLogTest } from '../support/event-log.js';
import { git } from '../support/work-repo.js';
import { expectRefusal, listedWorktrees, worktreeFixture } from '../support/worktree-fixture.js';

afterEach(cleanupEventLogTest);

describe('createWorktree location and pinned commit', () => {
  test('createWorktree puts the worktree at <cache>/worktrees/example-frontend/FE-123 and checks out the pinned base commit', () => {
    const fx = worktreeFixture();

    const created = createWorktree(fx.options());

    const expected = join(fx.sb.home, 'cache', 'worktrees', 'example-frontend', 'FE-123');
    expect(created.path).toBe(expected);
    expect(created.baseCommit).toBe(fx.repo.baseCommit);
    expect(existsSync(join(expected, '.git'))).toBe(true);
    expect(git(expected, 'rev-parse', 'HEAD')).toBe(fx.repo.baseCommit);
    // The pinned commit has the first version of the file, not the later commit and not the dirty edit.
    expect(readFileSync(join(expected, 'src', 'app.ts'), 'utf8')).toBe('export const app = 1;\n');
    expect(existsSync(join(expected, 'src', 'later.ts'))).toBe(false);
    expect(existsSync(join(expected, 'notes.txt'))).toBe(false);
  });

  test('a repo or ticket that contains a slash or .. is refused as worktree_invalid, exit code 2', () => {
    const fx = worktreeFixture();
    const pairs: Array<[string, string]> = [
      ['example-org/example-frontend', 'FE-123'],
      ['..', 'FE-123'],
      ['example-frontend', 'FE/123'],
      ['example-frontend', '..'],
    ];

    for (const [repo, ticket] of pairs) {
      expectRefusal(() => createWorktree(fx.options({ repo, ticket })), ['worktree_invalid']);
    }

    expect(existsSync(fx.worktreesRoot)).toBe(false);
    expect(listedWorktrees(fx.repo.path)).toEqual([fx.repo.path]);
  });

  test('a missing base commit or a missing work-repo .git is refused and no destination folder is left behind', () => {
    const fx = worktreeFixture();

    expectRefusal(
      () => createWorktree(fx.options({ mode: 'linked', baseCommit: '0'.repeat(40) })),
      ['worktree_invalid', 'worktree_create_failed'],
    );
    expect(existsSync(fx.expectedPath())).toBe(false);
    expect(listedWorktrees(fx.repo.path)).toEqual([fx.repo.path]);

    expectRefusal(
      () => createWorktree(fx.options({ mode: 'standalone', baseCommit: '0'.repeat(40) })),
      ['worktree_invalid', 'worktree_create_failed'],
    );
    expect(existsSync(fx.expectedPath())).toBe(false);

    const notARepo = join(fx.sb.tmp, 'work', 'not-a-repo');
    mkdirSync(notARepo, { recursive: true });
    expectRefusal(
      () => createWorktree(fx.options({ mode: 'linked', repoPath: notARepo })),
      ['worktree_invalid', 'worktree_create_failed'],
    );
    expect(existsSync(fx.expectedPath())).toBe(false);
    expect(existsSync(join(notARepo, '.git'))).toBe(false);
  });

  test('a destination that already exists is refused and its content is kept', () => {
    const fx = worktreeFixture();
    mkdirSync(fx.expectedPath(), { recursive: true });
    writeFileSync(join(fx.expectedPath(), 'keep.txt'), 'kept\n');

    expectRefusal(() => createWorktree(fx.options({ mode: 'linked' })), ['worktree_invalid', 'worktree_create_failed']);

    expect(readFileSync(join(fx.expectedPath(), 'keep.txt'), 'utf8')).toBe('kept\n');
    expect(listedWorktrees(fx.repo.path)).toEqual([fx.repo.path]);
  });
});
