import { existsSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';

import { createWorktree } from '../../src/worktree/create.js';
import { removeWorktree } from '../../src/worktree/remove.js';
import { cleanupEventLogTest } from '../support/event-log.js';
import { factoryOwnedPaths, listTree, snapshotRepo } from '../support/work-repo.js';
import { listedWorktrees, worktreeFixture, type WorktreeFixture } from '../support/worktree-fixture.js';

afterEach(cleanupEventLogTest);

function remove(fx: WorktreeFixture, path: string): void {
  removeWorktree({ env: fx.sb.env, deps: fx.deps, log: fx.log, runId: 'run-1', repoPath: fx.repo.path, path });
}

describe('the work-repo checkout stays untouched', () => {
  test('after createWorktree, the work repo\'s working tree, index and branches are unchanged', () => {
    const fx = worktreeFixture();
    const before = snapshotRepo(fx.repo.path);

    createWorktree(fx.options());

    expect(snapshotRepo(fx.repo.path)).toEqual(before);
    // The snapshot is of a dirty repo, so "unchanged" is a real check.
    expect(before.status).toContain('staged.txt');
    expect(before.status).toContain('notes.txt');
    expect(before.refs).toContain('refs/heads/side');
    expect(before.refs).not.toMatch(/refs\/heads\/factory\//);
  });

  test('after removeWorktree, the work repo\'s working tree, index and branches match the snapshot taken before create, and the worktree directory is gone', () => {
    const fx = worktreeFixture();
    const before = snapshotRepo(fx.repo.path);

    const created = createWorktree(fx.options());
    remove(fx, created.path);

    expect(snapshotRepo(fx.repo.path)).toEqual(before);
    expect(existsSync(created.path)).toBe(false);
    expect(listedWorktrees(fx.repo.path)).toEqual([fx.repo.path]);
  });

  test('the work repo contains no factory-owned files after create or after remove', () => {
    const fx = worktreeFixture();
    const filesBefore = listTree(fx.repo.path, true);
    expect(factoryOwnedPaths(fx.repo.path)).toEqual([]);

    const created = createWorktree(fx.options());
    expect(factoryOwnedPaths(fx.repo.path)).toEqual([]);
    expect(listTree(fx.repo.path, true)).toEqual(filesBefore);

    remove(fx, created.path);
    expect(factoryOwnedPaths(fx.repo.path)).toEqual([]);
    expect(listTree(fx.repo.path, true)).toEqual(filesBefore);
  });
});
