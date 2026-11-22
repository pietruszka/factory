import { existsSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createWorktree, type WorktreeMode } from '../../src/worktree/create.js';
import { removeWorktree } from '../../src/worktree/remove.js';
import { cleanupEventLogTest } from '../support/event-log.js';
import { git, gitSucceeds, snapshotRepo } from '../support/work-repo.js';
import { listedWorktrees, worktreeFixture, type WorktreeFixture } from '../support/worktree-fixture.js';

afterEach(cleanupEventLogTest);

function remove(fx: WorktreeFixture, path: string): void {
  removeWorktree({ env: fx.sb.env, deps: fx.deps, log: fx.log, runId: 'run-1', repoPath: fx.repo.path, path });
}

/** A linked worktree has a `.git` file that points at the work repo; a standalone clone has a `.git` folder. */
function modeOnDisk(path: string): WorktreeMode {
  return statSync(join(path, '.git')).isFile() ? 'linked' : 'standalone';
}

describe('linked and standalone modes', () => {
  test('a linked worktree is created and removed without changing the work repo\'s working tree, index or branches', () => {
    const fx = worktreeFixture();
    const before = snapshotRepo(fx.repo.path);

    const created = createWorktree(fx.options({ mode: 'linked' }));

    expect(created.mode).toBe('linked');
    expect(modeOnDisk(created.path)).toBe('linked');
    expect(git(created.path, 'rev-parse', 'HEAD')).toBe(fx.repo.baseCommit);
    // Detached HEAD: no branch, so the work repo gets no new ref.
    expect(gitSucceeds(created.path, 'symbolic-ref', '-q', 'HEAD')).toBe(false);
    expect(listedWorktrees(fx.repo.path)).toEqual([fx.repo.path, created.path]);
    expect(snapshotRepo(fx.repo.path)).toEqual(before);

    remove(fx, created.path);

    expect(existsSync(created.path)).toBe(false);
    expect(listedWorktrees(fx.repo.path)).toEqual([fx.repo.path]);
    expect(snapshotRepo(fx.repo.path)).toEqual(before);
  });

  test('a standalone clone is created under the cache worktrees root at the pinned commit, and removeWorktree deletes it without changing the work repo', () => {
    const fx = worktreeFixture();
    const before = snapshotRepo(fx.repo.path);

    const created = createWorktree(fx.options({ mode: 'standalone' }));

    expect(created.mode).toBe('standalone');
    expect(created.path).toBe(fx.expectedPath());
    expect(created.path.startsWith(fx.worktreesRoot + sep)).toBe(true);
    expect(modeOnDisk(created.path)).toBe('standalone');
    expect(git(created.path, 'rev-parse', 'HEAD')).toBe(fx.repo.baseCommit);
    expect(git(created.path, 'config', 'remote.origin.url')).toBe(fx.repo.path);
    expect(listedWorktrees(fx.repo.path)).toEqual([fx.repo.path]);
    expect(snapshotRepo(fx.repo.path)).toEqual(before);

    remove(fx, created.path);

    expect(existsSync(created.path)).toBe(false);
    expect(snapshotRepo(fx.repo.path)).toEqual(before);
  });

  test('createWorktree honors an explicit mode argument, and honors worktree.mode from config when no argument is passed', () => {
    const cases: Array<{ configMode: WorktreeMode | undefined; argument: WorktreeMode | undefined; expected: WorktreeMode }> = [
      { configMode: undefined, argument: undefined, expected: 'linked' },
      { configMode: 'standalone', argument: undefined, expected: 'standalone' },
      { configMode: 'standalone', argument: 'linked', expected: 'linked' },
      { configMode: 'linked', argument: 'standalone', expected: 'standalone' },
    ];

    for (const { configMode, argument, expected } of cases) {
      const fx = worktreeFixture(configMode === undefined ? {} : { configMode });

      const created = createWorktree(fx.options(argument === undefined ? {} : { mode: argument }));

      expect(created.mode).toBe(expected);
      expect(modeOnDisk(created.path)).toBe(expected);
    }
  });
});
