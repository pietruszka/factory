import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { takeSnapshot } from '../../src/write-scope/snapshot.js';
import { cleanupRunStateTest } from '../support/run-state.js';
import { git, snapshotRepo } from '../support/work-repo.js';
import { writeScopeFixture } from '../support/write-scope.js';

afterEach(cleanupRunStateTest);

const lines = (text: string): string[] => (text === '' ? [] : text.split('\n'));

describe('a pre-step snapshot', () => {
  test('a snapshot is a git tree built through a temporary index and includes an untracked file', async () => {
    const scope = writeScopeFixture();
    await scope.play('edits');

    const tree = takeSnapshot({ env: scope.env, cwd: scope.worktree, snapshotIgnore: [], tempDir: scope.scratch });

    expect(git(scope.worktree, 'cat-file', '-t', tree)).toBe('tree');
    expect(lines(git(scope.worktree, 'ls-tree', '-r', '--name-only', tree))).toEqual([
      'README.md',
      'docs/notes.md',
      'src/app.ts',
      'src/example.txt',
    ]);
    // The untracked files are in the tree but never entered the worktree's real index.
    expect(lines(git(scope.worktree, 'ls-files'))).toEqual(['README.md', 'src/app.ts']);
    // The temporary index file is gone once the tree is written.
    expect(readdirSync(scope.scratch)).toEqual([]);
  });

  test('a path matching snapshot_ignore is left out of the snapshot', async () => {
    const scope = writeScopeFixture();
    await scope.play('scope-ignored');

    const tree = takeSnapshot({ env: scope.env, cwd: scope.worktree, snapshotIgnore: ['dist/**'], tempDir: scope.scratch });

    expect(lines(git(scope.worktree, 'ls-tree', '-r', '--name-only', tree))).toEqual([
      'README.md',
      'src/app.ts',
      'src/kept.txt',
    ]);
  });

  test('taking a snapshot does not change the worktree HEAD or its real index', async () => {
    const scope = writeScopeFixture();
    await scope.play('edits');
    writeFileSync(join(scope.worktree, 'src/app.ts'), 'export const app = 2; // edited, not staged\n');
    git(scope.worktree, 'add', 'README.md');
    const indexFile = join(git(scope.worktree, 'rev-parse', '--absolute-git-dir'), 'index');
    const before = snapshotRepo(scope.worktree);
    const indexBefore = readFileSync(indexFile);

    takeSnapshot({ env: scope.env, cwd: scope.worktree, snapshotIgnore: [], tempDir: scope.scratch });

    const indexAfter = readFileSync(indexFile);
    expect(indexAfter.equals(indexBefore)).toBe(true);
    const after = snapshotRepo(scope.worktree);
    expect(after.head).toBe(scope.baseCommit);
    expect(after).toEqual(before);
  });
});
