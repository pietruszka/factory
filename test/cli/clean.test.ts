import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createStatusCommand } from '../../src/cli/status.js';
import { createFakeProcessTable } from '../../src/ports/process-table.js';
import { parseEnvelope, runCapture } from '../support/cli-harness.js';
import { eventLogSandbox } from '../support/event-log.js';
import {
  cleanCliWith,
  contentsUnder,
  dataOf,
  DAY,
  filesUnder,
  freshDeps,
  GIB,
  KEPT_FILES,
  MINUTE,
  OLD_ARTIFACTS,
  retentionFixture,
  type RetentionFixture,
  RUN_FOLDER_BYTES,
  scriptedCodeHost,
} from '../support/retention.js';
import { cleanupStatusTest, pointEnvAt } from '../support/status.js';
import { makeTempHome } from '../support/temp-home.js';
import { factoryOwnedPaths, snapshotRepo } from '../support/work-repo.js';
import { eventsOf, listedWorktrees } from '../support/worktree-fixture.js';

afterEach(cleanupStatusTest);

/** Runs `factory clean` and fails the test unless it exits 0. */
const cleanOk = async (fx: RetentionFixture): Promise<void> => {
  const run = await fx.cleanCli();
  expect(run.exitCode, run.stderr).toBe(0);
};

describe('factory clean: a worktree older than 7 days after merge or abandon is removed', () => {
  test("when a run's pull request merged more than 7 days ago, factory clean removes its worktree from the cache folder and leaves the work-repo checkout untouched", async () => {
    const fx = retentionFixture();
    const run = fx.seed({ runId: 'run-a', ticket: 'FE-201', pr: { number: 42, mergedAgoMs: 7 * DAY + MINUTE } });
    const checkoutBefore = snapshotRepo(fx.repo.path);
    expect(existsSync(run.worktree)).toBe(true);

    const result = await fx.cleanCli(['--json']);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(existsSync(run.worktree)).toBe(false);
    expect((dataOf(result).worktrees_removed as Array<{ run_id: string }>).map((entry) => entry.run_id)).toEqual(['run-a']);
    expect(eventsOf(fx.reader, 'run-a', 'worktree_removed').map((event) => event.payload)).toEqual([
      { path: run.worktree, mode: 'linked' },
    ]);
    // The work repo keeps its working tree, index and refs, and no worktree metadata or factory-owned file.
    expect(snapshotRepo(fx.repo.path)).toEqual(checkoutBefore);
    expect(listedWorktrees(fx.repo.path)).toEqual([fx.repo.path]);
    expect(factoryOwnedPaths(fx.repo.path)).toEqual([]);
  });

  test('when a run was abandoned more than 7 days ago, factory clean removes its worktree from the cache folder', async () => {
    const fx = retentionFixture();
    const run = fx.seed({
      runId: 'run-a',
      ticket: 'FE-201',
      status: 'killed',
      outcomes: [{ outcome: 'abandoned', agoMs: 7 * DAY + MINUTE }],
    });

    const result = await fx.cleanCli();

    expect(result.exitCode, result.stderr).toBe(0);
    expect(existsSync(run.worktree)).toBe(false);
    expect(eventsOf(fx.reader, 'run-a', 'worktree_removed')).toHaveLength(1);
  });

  test('when a run merged or was abandoned 7 days ago or less, or has neither a merge time nor an abandoned outcome, factory clean leaves the worktree', async () => {
    const fx = retentionFixture();
    const merged = fx.seed({ runId: 'run-a', ticket: 'FE-201', pr: { number: 42, mergedAgoMs: 7 * DAY } });
    const recentlyMerged = fx.seed({ runId: 'run-b', ticket: 'FE-202', pr: { number: 43, mergedAgoMs: DAY } });
    const abandoned = fx.seed({
      runId: 'run-c',
      ticket: 'FE-203',
      status: 'killed',
      outcomes: [{ outcome: 'abandoned', agoMs: 7 * DAY }],
    });
    const neither = fx.seed({ runId: 'run-d', ticket: 'FE-204', status: 'passed' });

    const result = await fx.cleanCli();

    expect(result.exitCode, result.stderr).toBe(0);
    for (const run of [merged, recentlyMerged, abandoned, neither]) {
      expect(existsSync(run.worktree), run.ticket).toBe(true);
    }
    expect(fx.eventRows().filter((row) => row.type === 'worktree_removed')).toEqual([]);
  });
});

describe('factory clean: artifacts older than 30 days are deleted; the report and events stay', () => {
  test('when a run ended more than 30 days ago, factory clean deletes ticket.json, evidence/diff.patch and prompts/ from the run folder, and leaves report.md, plan.md and the event rows', async () => {
    const fx = retentionFixture();
    const run = fx.seed({ runId: 'run-a', ticket: 'FE-201', worktree: false, endedAgoMs: 30 * DAY + MINUTE });
    const keptBefore = contentsUnder(run.runFolder);
    for (const name of OLD_ARTIFACTS) delete keptBefore[name];
    const rowsBefore = fx.eventRows();

    const result = await fx.cleanCli();

    expect(result.exitCode, result.stderr).toBe(0);
    for (const name of ['ticket.json', 'evidence/diff.patch']) {
      expect(existsSync(join(run.runFolder, name)), name).toBe(false);
    }
    expect(filesUnder(join(run.runFolder, 'prompts'))).toEqual([]);
    expect(Object.keys(contentsUnder(run.runFolder)).sort()).toEqual([...KEPT_FILES].sort());
    expect(contentsUnder(run.runFolder)).toEqual(keptBefore);
    // Every event row that was there is still there, unchanged.
    expect(fx.eventRows().slice(0, rowsBefore.length)).toEqual(rowsBefore);
    // The run itself is not rewritten.
    expect(fx.reader.query("SELECT status, ended_at FROM runs WHERE run_id = 'run-a'")).toEqual([
      { status: 'passed', ended_at: '2025-12-02T09:59:00.000Z' },
    ]);
  });

  test('when a run ended 30 days ago or less, or has no ended_at, factory clean leaves those artifacts', async () => {
    const fx = retentionFixture();
    const atLimit = fx.seed({ runId: 'run-a', ticket: 'FE-201', worktree: false, endedAgoMs: 30 * DAY });
    const recent = fx.seed({ runId: 'run-b', ticket: 'FE-202', worktree: false, endedAgoMs: DAY });
    const unfinished = fx.seed({ runId: 'run-c', ticket: 'FE-203', worktree: false, status: 'killed' });
    const before = [atLimit, recent, unfinished].map((run) => contentsUnder(run.runFolder));

    const result = await fx.cleanCli();

    expect(result.exitCode, result.stderr).toBe(0);
    expect([atLimit, recent, unfinished].map((run) => contentsUnder(run.runFolder))).toEqual(before);
    expect(fx.eventRows().filter((row) => row.type === 'retention_cleaned')).toEqual([]);
  });
});

describe('factory clean: ages come from factory.db or the PR merge time, never from file modification times', () => {
  test('factory clean uses Deps.now() against runs.ended_at, outcomes.recorded_at or CodeHost mergedAt, and does not use file modification times', async () => {
    const fx = retentionFixture();
    // All three runs have files written just now (real mtimes), but old timestamps in the db or on the scripted PR.
    const ended = fx.seed({ runId: 'run-a', ticket: 'FE-201', worktree: false, endedAgoMs: 31 * DAY });
    const abandoned = fx.seed({
      runId: 'run-b',
      ticket: 'FE-202',
      status: 'killed',
      outcomes: [{ outcome: 'abandoned', agoMs: 8 * DAY }],
    });
    const merged = fx.seed({ runId: 'run-c', ticket: 'FE-203', pr: { number: 42, mergedAgoMs: 8 * DAY } });

    const result = await fx.cleanCli();

    expect(result.exitCode, result.stderr).toBe(0);
    expect(filesUnder(join(ended.runFolder, 'evidence'))).toEqual([]);
    expect(existsSync(abandoned.worktree)).toBe(false);
    expect(existsSync(merged.worktree)).toBe(false);
    expect(fx.codeHost.calls.map((call) => call.method)).toEqual(['fetchPullRequest']);
    // The runs that were abandoned or merged have not ended 30 days ago, so their artifacts stay.
    expect(Object.keys(contentsUnder(merged.runFolder))).toHaveLength(OLD_ARTIFACTS.length + KEPT_FILES.length);
  });

  test('a run with no ended_at, no abandoned outcome and no merge time is not cleaned, even if its files look old by mtime', async () => {
    const fx = retentionFixture();
    const run = fx.seed({
      runId: 'run-a',
      ticket: 'FE-201',
      status: 'killed',
      pr: { number: 42 },
      outcomes: [{ outcome: 'rejected', agoMs: 0 }],
    });
    const before = contentsUnder(run.runFolder);
    // The files were written a moment ago; winding the clock a year ahead makes them look a year old by mtime.
    fx.deps.advance(400 * DAY);

    const result = await fx.cleanCli();

    expect(result.exitCode, result.stderr).toBe(0);
    expect(existsSync(run.worktree)).toBe(true);
    expect(contentsUnder(run.runFolder)).toEqual(before);
  });
});

describe('factory clean: the injected clock decides', () => {
  test('winding the injected clock past the 7-day and 30-day limits is enough for clean to apply; tests do not set file mtimes to fake age', async () => {
    const fx = retentionFixture();
    const run = fx.seed({ runId: 'run-a', ticket: 'FE-201', endedAgoMs: 0, pr: { number: 42, mergedAgoMs: 0 } });
    const complete = Object.keys(contentsUnder(run.runFolder)).length;

    await cleanOk(fx);
    expect(existsSync(run.worktree), 'now').toBe(true);
    expect(Object.keys(contentsUnder(run.runFolder))).toHaveLength(complete);

    fx.deps.advance(7 * DAY);
    await cleanOk(fx);
    expect(existsSync(run.worktree), 'exactly 7 days').toBe(true);

    fx.deps.advance(1);
    await cleanOk(fx);
    expect(existsSync(run.worktree), 'past 7 days').toBe(false);
    expect(Object.keys(contentsUnder(run.runFolder)), 'past 7 days').toHaveLength(complete);

    fx.deps.advance(23 * DAY - 1);
    await cleanOk(fx);
    expect(Object.keys(contentsUnder(run.runFolder)), 'exactly 30 days').toHaveLength(complete);

    fx.deps.advance(1);
    await cleanOk(fx);
    expect(Object.keys(contentsUnder(run.runFolder)).sort(), 'past 30 days').toEqual([...KEPT_FILES].sort());
  });
});

describe('factory clean: a missing db, other CLIs and the network', () => {
  test('with no factory.db it exits 0, reports nothing removed and creates nothing', async () => {
    const sb = eventLogSandbox();
    pointEnvAt(sb);

    const result = await cleanCliWith(sb.tmp, { deps: freshDeps(), codeHost: scriptedCodeHost() }, ['--json']);

    expect(result.exitCode, result.stderr).toBe(0);
    expect(dataOf(result)).toMatchObject({ worktrees_removed: [], artifacts_deleted: [] });
    expect(existsSync(sb.home)).toBe(false);
  });

  test('factory clean starts no agent, acli or gh CLI', async () => {
    const fx = retentionFixture();
    fx.seed({ runId: 'run-a', ticket: 'FE-201', pr: { number: 42, mergedAgoMs: 8 * DAY } });
    const bin = join(makeTempHome(), 'bin');
    const marker = join(makeTempHome(), 'started.log');
    mkdirSync(bin);
    for (const name of ['agent', 'cursor-agent', 'opencode', 'copilot', 'acli', 'gh']) {
      writeFileSync(join(bin, name), `#!/bin/sh\necho ${name} >> "${marker}"\nexit 1\n`, { mode: 0o755 });
    }
    process.env.PATH = `${bin}:${process.env.PATH ?? ''}`;

    const result = await fx.cleanCli();

    expect(result.exitCode, result.stderr).toBe(0);
    expect(existsSync(marker)).toBe(false);
  });
});

describe('factory clean: disk use per area', () => {
  test('factory clean shows disk use for worktrees, runs and the db', async () => {
    const fx = retentionFixture();
    // Nothing here is old enough to be removed, so the numbers are those of the seeded files.
    fx.seed({ runId: 'run-a', ticket: 'FE-201' });
    writeFileSync(join(fx.worktreesRoot, 'standalone-blob.bin'), Buffer.alloc(4000));

    const json = await fx.cleanCli(['--json']);
    const text = await fx.cleanCli();

    expect(json.exitCode, json.stderr).toBe(0);
    const disk = dataOf(json).disk as { worktrees: number; runs: number; db: number; total: number; warning?: string };
    expect(disk.runs).toBe(RUN_FOLDER_BYTES);
    expect(disk.worktrees).toBeGreaterThanOrEqual(4000 + 100);
    expect(disk.db).toBeGreaterThan(0);
    expect(disk.total).toBeGreaterThanOrEqual(disk.worktrees + disk.runs + disk.db);
    expect(disk.warning).toBeUndefined();
    expect(text.exitCode, text.stderr).toBe(0);
    expect(text.stdout).toMatch(/worktrees/i);
    expect(text.stdout).toMatch(/runs/i);
    expect(text.stdout).toMatch(/\bdb\b/i);
  });

  test('when the factory-home total is above 10 GiB, status and clean include a soft warning and still exit 0', async () => {
    const fx = retentionFixture();
    const measureDisk = () => ({ worktrees: 6 * GIB, runs: 4 * GIB, db: GIB, total: 11 * GIB });
    const statusCommand = createStatusCommand({
      deps: fx.deps,
      processTable: createFakeProcessTable(),
      measureDisk,
    });

    const clean = await fx.cleanCli(['--json'], { measureDisk });
    const cleanText = await fx.cleanCli([], { measureDisk });
    const status = await runCapture(['status', '--json'], { cwd: fx.sb.tmp, commands: { status: statusCommand } });
    const statusText = await runCapture(['status'], { cwd: fx.sb.tmp, commands: { status: statusCommand } });

    for (const run of [clean, cleanText, status, statusText]) expect(run.exitCode, run.stderr).toBe(0);
    for (const run of [clean, status]) {
      const disk = dataOf(run).disk as { worktrees: number; runs: number; db: number; warning?: string };
      expect([disk.worktrees, disk.runs, disk.db]).toEqual([6 * GIB, 4 * GIB, GIB]);
      expect(disk.warning).toMatch(/10 GiB/);
    }
    expect(parseEnvelope(clean).ok).toBe(true);
    expect(cleanText.stdout).toMatch(/warning/i);
    expect(statusText.stdout).toMatch(/warning/i);
  });

  test('at or below 10 GiB there is no warning', async () => {
    const fx = retentionFixture();
    const measureDisk = () => ({ worktrees: 5 * GIB, runs: 4 * GIB, db: GIB, total: 10 * GIB });

    const clean = await fx.cleanCli(['--json'], { measureDisk });

    expect(clean.exitCode, clean.stderr).toBe(0);
    const disk = dataOf(clean).disk as { total: number; warning?: string };
    expect(disk.total).toBe(10 * GIB);
    expect(disk.warning).toBeUndefined();
  });
});
