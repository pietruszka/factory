import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { removeWorktree } from '../../src/worktree/remove.js';
import { cleanupEventLogTest } from '../support/event-log.js';
import { git, snapshotRepo } from '../support/work-repo.js';
import { eventsOf, expectRefusal, worktreeFixture, type WorktreeFixture } from '../support/worktree-fixture.js';

afterEach(cleanupEventLogTest);

function remove(fx: WorktreeFixture, path: string): void {
  removeWorktree({ env: fx.sb.env, deps: fx.deps, log: fx.log, runId: 'run-1', repoPath: fx.repo.path, path });
}

describe('removeWorktree refuses what it did not make', () => {
  test('a folder that is not a worktree is refused and kept', () => {
    const fx = worktreeFixture();
    const folder = join(fx.sb.tmp, 'elsewhere');
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'keep.txt'), 'kept\n');

    expectRefusal(() => remove(fx, folder), ['worktree_invalid']);
    expectRefusal(() => remove(fx, join(fx.sb.tmp, 'missing')), ['worktree_invalid']);

    expect(existsSync(join(folder, 'keep.txt'))).toBe(true);
    expect(eventsOf(fx.reader, 'run-1', 'worktree_removed')).toEqual([]);
  });

  test('the work repo itself is refused and left untouched', () => {
    const fx = worktreeFixture();
    const before = snapshotRepo(fx.repo.path);

    expectRefusal(() => remove(fx, fx.repo.path), ['worktree_remove_failed']);

    expect(snapshotRepo(fx.repo.path)).toEqual(before);
    expect(eventsOf(fx.reader, 'run-1', 'worktree_removed')).toEqual([]);
  });

  test('a clone of some other repo is refused and kept', () => {
    const fx = worktreeFixture();
    const other = join(fx.sb.tmp, 'other-clone');
    git(fx.sb.tmp, 'clone', '--quiet', fx.repo.path, other);
    git(other, 'remote', 'set-url', 'origin', join(fx.sb.tmp, 'somewhere-else'));

    expectRefusal(() => remove(fx, other), ['worktree_remove_failed']);

    expect(existsSync(join(other, '.git'))).toBe(true);
  });
});
