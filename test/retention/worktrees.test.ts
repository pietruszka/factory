import { existsSync, mkdirSync, renameSync, symlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { DAY, retentionFixture } from '../support/retention.js';
import { cleanupStatusTest } from '../support/status.js';
import { makeTempHome } from '../support/temp-home.js';
import { eventsOf } from '../support/worktree-fixture.js';

afterEach(cleanupStatusTest);

describe('worktree retention: only a merge or an abandoned outcome starts the 7 days', () => {
  test('a killed or budget run without an abandoned outcome keeps its worktree, however old', async () => {
    const fx = retentionFixture();
    const killed = fx.seed({ runId: 'run-a', ticket: 'FE-201', status: 'killed', endedAgoMs: 40 * DAY });
    const budget = fx.seed({ runId: 'run-b', ticket: 'FE-202', status: 'budget', endedAgoMs: 40 * DAY });
    fx.deps.advance(100 * DAY);

    const result = await fx.clean();

    expect(result.worktrees_removed).toEqual([]);
    expect(existsSync(killed.worktree)).toBe(true);
    expect(existsSync(budget.worktree)).toBe(true);
    expect(fx.codeHost.calls).toEqual([]);
  });

  test('a failed pull request fetch keeps the worktree and does not fall back to file times', async () => {
    const fx = retentionFixture();
    const run = fx.seed({ runId: 'run-a', ticket: 'FE-201', pr: { number: 42, fetchFails: true } });
    // The worktree files were written a moment ago; a year later they look a year old by mtime.
    fx.deps.advance(365 * DAY);

    const result = await fx.clean();

    expect(fx.codeHost.calls.map((call) => call.method)).toEqual(['fetchPullRequest']);
    expect(result.worktrees_removed).toEqual([]);
    expect(existsSync(run.worktree)).toBe(true);
    expect(eventsOf(fx.reader, 'run-a', 'worktree_removed')).toEqual([]);
  });

  test('a pull request that is not merged keeps the worktree', async () => {
    const fx = retentionFixture();
    const open = fx.seed({ runId: 'run-a', ticket: 'FE-201', pr: { number: 42, mergedAgoMs: null } });
    const absent = fx.seed({ runId: 'run-b', ticket: 'FE-202', pr: { number: 43 } });
    fx.deps.advance(100 * DAY);

    const result = await fx.clean();

    expect(result.worktrees_removed).toEqual([]);
    expect(existsSync(open.worktree)).toBe(true);
    expect(existsSync(absent.worktree)).toBe(true);
  });

  test('a merged run with no draft_pr event is never fetched and keeps its worktree', async () => {
    const fx = retentionFixture();
    const run = fx.seed({ runId: 'run-a', ticket: 'FE-201', status: 'passed' });
    fx.deps.advance(100 * DAY);

    const result = await fx.clean();

    expect(fx.codeHost.calls).toEqual([]);
    expect(result.worktrees_removed).toEqual([]);
    expect(existsSync(run.worktree)).toBe(true);
  });

  test('only the latest outcome counts: abandoned and then accepted keeps the worktree, accepted and then abandoned removes it', async () => {
    const fx = retentionFixture();
    const reopened = fx.seed({
      runId: 'run-a',
      ticket: 'FE-201',
      status: 'killed',
      outcomes: [
        { outcome: 'abandoned', agoMs: 20 * DAY },
        { outcome: 'accepted', agoMs: 19 * DAY },
      ],
    });
    const abandonedLast = fx.seed({
      runId: 'run-b',
      ticket: 'FE-202',
      status: 'killed',
      outcomes: [
        { outcome: 'accepted', agoMs: 20 * DAY },
        { outcome: 'abandoned', agoMs: 19 * DAY },
      ],
    });

    const result = await fx.clean();

    expect(result.worktrees_removed.map((entry) => entry.run_id)).toEqual(['run-b']);
    expect(existsSync(reopened.worktree)).toBe(true);
    expect(existsSync(abandonedLast.worktree)).toBe(false);
  });
});

describe('worktree retention: every run is judged on its own', () => {
  test('an older run whose pull request merged more than 7 days ago loses its worktree even when a newer run of the same ticket exists', async () => {
    const fx = retentionFixture();
    const older = fx.seed({ runId: 'run-a', ticket: 'FE-201', pr: { number: 42, mergedAgoMs: 8 * DAY } });
    fx.seed({ runId: 'run-b', ticket: 'FE-201', worktree: false, endedAgoMs: DAY });

    const result = await fx.clean();

    expect(result.worktrees_removed).toEqual([{ run_id: 'run-a', path: older.worktree }]);
    expect(existsSync(older.worktree)).toBe(false);
    expect(eventsOf(fx.reader, 'run-a', 'worktree_removed')).toHaveLength(1);
  });

  test('an older run abandoned more than 7 days ago loses its worktree even when a newer run of the same ticket exists', async () => {
    const fx = retentionFixture();
    const older = fx.seed({ runId: 'run-a', ticket: 'FE-201', status: 'killed', outcomes: [{ outcome: 'abandoned', agoMs: 8 * DAY }] });
    fx.seed({ runId: 'run-b', ticket: 'FE-201', worktree: false });

    const result = await fx.clean();

    expect(result.worktrees_removed).toEqual([{ run_id: 'run-a', path: older.worktree }]);
    expect(existsSync(older.worktree)).toBe(false);
  });

  test('two runs that record the same worktree path remove it once and the second finds it already gone', async () => {
    const fx = retentionFixture();
    const older = fx.seed({ runId: 'run-a', ticket: 'FE-201', outcomes: [{ outcome: 'abandoned', agoMs: 9 * DAY }] });
    fx.seed({ runId: 'run-b', ticket: 'FE-201', worktree: false, outcomes: [{ outcome: 'abandoned', agoMs: 8 * DAY }] });
    fx.log.appendEvent({
      run_id: 'run-b',
      type: 'worktree_created',
      payload: { path: older.worktree, base_commit: fx.repo.baseCommit, mode: 'linked' },
    });

    const result = await fx.clean();

    expect(result.worktrees_removed).toEqual([{ run_id: 'run-a', path: older.worktree }]);
    expect(result.worktrees_skipped).toEqual([]);
    expect(existsSync(older.worktree)).toBe(false);
    expect(eventsOf(fx.reader, 'run-a', 'worktree_removed')).toHaveLength(1);
    expect(eventsOf(fx.reader, 'run-b', 'worktree_removed')).toEqual([]);
  });
});

describe('worktree retention: removal goes through removeWorktree', () => {
  test('a standalone clone of a run merged more than 7 days ago is removed and recorded', async () => {
    const fx = retentionFixture();
    const run = fx.seed({ runId: 'run-a', ticket: 'FE-201', mode: 'standalone', pr: { number: 42, mergedAgoMs: 8 * DAY } });

    const result = await fx.clean();

    expect(result.worktrees_removed).toEqual([{ run_id: 'run-a', path: run.worktree }]);
    expect(existsSync(run.worktree)).toBe(false);
    expect(eventsOf(fx.reader, 'run-a', 'worktree_removed').map((event) => event.payload)).toEqual([
      { path: run.worktree, mode: 'standalone' },
    ]);
  });

  test('a linked worktree whose work-repo checkout is missing is skipped with a next action and never deleted by hand', async () => {
    const fx = retentionFixture();
    const run = fx.seed({ runId: 'run-a', ticket: 'FE-201', pr: { number: 42, mergedAgoMs: 8 * DAY } });
    renameSync(fx.repo.path, `${fx.repo.path}-moved`);

    const result = await fx.clean();

    expect(result.worktrees_removed).toEqual([]);
    expect(result.worktrees_skipped).toHaveLength(1);
    expect(result.worktrees_skipped[0]).toMatchObject({ run_id: 'run-a', path: run.worktree });
    expect(result.worktrees_skipped[0]?.reason).toMatch(/\S/);
    expect(result.worktrees_skipped[0]?.next).toMatch(/\S/);
    expect(existsSync(run.worktree)).toBe(true);
    expect(eventsOf(fx.reader, 'run-a', 'worktree_removed')).toEqual([]);
  });
});

describe('worktree retention: removal never leaves the factory worktrees folder', () => {
  test.each(['linked', 'standalone'] as const)(
    'a %s worktree reached through a symlinked folder that points outside the worktrees folder is not removed, and the outside target is untouched',
    async (mode) => {
      const fx = retentionFixture();
      const run = fx.seed({ runId: 'run-a', ticket: 'FE-201', mode, pr: { number: 42, mergedAgoMs: 8 * DAY } });
      // The repo folder under the worktrees root becomes a link to a folder elsewhere; the recorded path stays the same.
      const linked = dirname(run.worktree);
      const outside = join(makeTempHome(), 'outside');
      mkdirSync(outside);
      renameSync(linked, join(outside, 'example-frontend'));
      symlinkSync(join(outside, 'example-frontend'), linked);
      const target = join(outside, 'example-frontend', 'FE-201');

      const result = await fx.clean();

      expect(result.worktrees_removed).toEqual([]);
      expect(result.worktrees_skipped).toHaveLength(1);
      expect(result.worktrees_skipped[0]).toMatchObject({ run_id: 'run-a', path: run.worktree });
      expect(result.worktrees_skipped[0]?.next).toMatch(/\S/);
      expect(existsSync(join(target, 'blob.bin'))).toBe(true);
      expect(existsSync(join(target, '.git'))).toBe(true);
      expect(eventsOf(fx.reader, 'run-a', 'worktree_removed')).toEqual([]);
    },
  );
});
