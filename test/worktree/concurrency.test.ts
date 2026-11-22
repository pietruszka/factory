import { existsSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';

import { createWorktree } from '../../src/worktree/create.js';
import { assertCanStart } from '../../src/worktree/start.js';
import { cleanupEventLogTest } from '../support/event-log.js';
import { expectRefusal, listedWorktrees, worktreeFixture, type WorktreeFixture } from '../support/worktree-fixture.js';

afterEach(cleanupEventLogTest);

/** Run `run-1` is active and recorded with `first`; run `run-2` is the one about to start. */
function twoRuns(first: readonly string[] | undefined): WorktreeFixture {
  const fx = worktreeFixture();
  fx.recordCreated('run-1', first);
  fx.addRun({ run_id: 'run-2', ticket: 'FE-2' });
  return fx;
}

function startOptions(fx: WorktreeFixture, runId: string, ticket: string, allowedPaths?: readonly string[]) {
  return fx.options({ runId, ticket, ...(allowedPaths === undefined ? {} : { allowedPaths }) });
}

describe('how many runs may be active', () => {
  test('a second active run with disjoint allowed paths is allowed', () => {
    const fx = twoRuns(['src/a/**']);

    expect(() => assertCanStart({ reader: fx.reader, runId: 'run-2', allowedPaths: ['src/b/**'] })).not.toThrow();

    const created = createWorktree(startOptions(fx, 'run-2', 'FE-2', ['src/b/**']));
    expect(existsSync(created.path)).toBe(true);
  });

  test('a third active run is refused as worktree_busy, exit code 2, and no worktree is created', () => {
    const fx = twoRuns(['src/a/**']);
    fx.recordCreated('run-2', ['src/b/**']);
    fx.addRun({ run_id: 'run-3', ticket: 'FE-3' });

    expectRefusal(
      () => assertCanStart({ reader: fx.reader, runId: 'run-3', allowedPaths: ['src/c/**'] }),
      ['worktree_busy'],
    );
    expectRefusal(
      () => createWorktree(startOptions(fx, 'run-3', 'FE-3', ['src/c/**'])),
      ['worktree_busy'],
    );

    expect(existsSync(fx.expectedPath('FE-3'))).toBe(false);
    expect(listedWorktrees(fx.repo.path)).toEqual([fx.repo.path]);
  });

  test('runs that are passed, refused or breach do not count as active', () => {
    const fx = worktreeFixture();
    for (const [n, status] of [
      [1, 'passed'],
      [2, 'refused'],
      [3, 'breach'],
    ] as const) {
      if (n > 1) {
        fx.addRun({ run_id: `run-${n}`, ticket: `FE-${n}` });
      }
      fx.recordCreated(`run-${n}`, ['src/b/**']);
      fx.log.updateRunStatus(`run-${n}`, status);
    }
    fx.addRun({ run_id: 'run-4', ticket: 'FE-4', status: 'building' });
    fx.recordCreated('run-4', ['src/a/**']);
    fx.addRun({ run_id: 'run-5', ticket: 'FE-5' });

    expect(() => assertCanStart({ reader: fx.reader, runId: 'run-5', allowedPaths: ['src/b/**'] })).not.toThrow();
  });
});

describe('overlapping allowed paths', () => {
  test('a second active run whose allowed paths overlap the first is refused as worktree_overlap, exit code 2', () => {
    const fx = twoRuns(['src/**']);

    expectRefusal(
      () => createWorktree(startOptions(fx, 'run-2', 'FE-2', ['src/a/**'])),
      ['worktree_overlap'],
    );

    expect(existsSync(fx.expectedPath('FE-2'))).toBe(false);
    expect(listedWorktrees(fx.repo.path)).toEqual([fx.repo.path]);
  });

  test('globs overlap unless their literal prefixes cannot share a path', () => {
    const fx = twoRuns(['src/a/**']);
    const overlapping = [['src/**'], ['src/a/b/*.ts'], ['src/a*/x'], ['**/*.ts'], ['*.md'], ['docs/**', 'src/a/c.ts']];
    const disjoint = [['src/b/**'], ['src/ab/**'], ['docs/**'], ['docs/**', 'lib/*.ts']];

    for (const allowedPaths of overlapping) {
      expectRefusal(() => assertCanStart({ reader: fx.reader, runId: 'run-2', allowedPaths }), ['worktree_overlap']);
    }
    for (const allowedPaths of disjoint) {
      expect(() => assertCanStart({ reader: fx.reader, runId: 'run-2', allowedPaths })).not.toThrow();
    }
  });

  test('a missing allowed_paths list is treated as overlapping everything', () => {
    const newRunHasNone = twoRuns(['src/a/**']);
    expectRefusal(() => assertCanStart({ reader: newRunHasNone.reader, runId: 'run-2' }), ['worktree_overlap']);
    expectRefusal(
      () => assertCanStart({ reader: newRunHasNone.reader, runId: 'run-2', allowedPaths: [] }),
      ['worktree_overlap'],
    );

    const activeRunHasNone = twoRuns(undefined);
    expectRefusal(
      () => assertCanStart({ reader: activeRunHasNone.reader, runId: 'run-2', allowedPaths: ['src/b/**'] }),
      ['worktree_overlap'],
    );
  });
});
