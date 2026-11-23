import { existsSync, mkdirSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import {
  contentsUnder,
  DAY,
  filesUnder,
  KEPT_FILES,
  MINUTE,
  OLD_ARTIFACTS,
  retentionFixture,
} from '../support/retention.js';
import { cleanupStatusTest } from '../support/status.js';
import { makeTempHome } from '../support/temp-home.js';
import { eventsOf } from '../support/worktree-fixture.js';

afterEach(cleanupStatusTest);

describe('artifact retention: large evidence goes after 30 days, kept files never', () => {
  test('every file under evidence/, prompts/ and ticket.json is deleted, and every kept file keeps its content', async () => {
    const fx = retentionFixture();
    const run = fx.seed({ runId: 'run-a', ticket: 'FE-201', worktree: false, endedAgoMs: 30 * DAY + MINUTE });
    const keptBefore = Object.fromEntries(KEPT_FILES.map((name) => [name, contentsUnder(run.runFolder)[name]]));

    const result = await fx.clean();

    for (const name of OLD_ARTIFACTS) expect(existsSync(join(run.runFolder, name)), name).toBe(false);
    expect(filesUnder(join(run.runFolder, 'evidence'))).toEqual([]);
    expect(contentsUnder(run.runFolder)).toEqual(keptBefore);
    expect(result.artifacts_deleted).toHaveLength(1);
    expect(result.artifacts_deleted[0]?.run_id).toBe('run-a');
    expect(result.artifacts_deleted[0]?.paths).toHaveLength(OLD_ARTIFACTS.length);
  });

  test('the run folder, the run row and every earlier event row stay, and one retention event lists what was removed', async () => {
    const fx = retentionFixture();
    const run = fx.seed({ runId: 'run-a', ticket: 'FE-201', worktree: false, endedAgoMs: 31 * DAY });
    const rowsBefore = fx.eventRows();

    await fx.clean();

    expect(existsSync(run.runFolder)).toBe(true);
    expect(fx.eventRows().slice(0, rowsBefore.length)).toEqual(rowsBefore);
    const events = eventsOf(fx.reader, 'run-a', 'retention_cleaned');
    expect(events).toHaveLength(1);
    const paths = (events[0]?.payload as { paths: string[] }).paths;
    expect(paths).toHaveLength(OLD_ARTIFACTS.length);
    expect(paths.some((path) => path.endsWith('diff.patch'))).toBe(true);
    expect(fx.reader.query("SELECT cost_usd FROM events WHERE type = 'retention_cleaned'")).toEqual([{ cost_usd: null }]);
  });

  test('an older run that ended more than 30 days ago loses its artifacts even when a newer run of the same ticket exists', async () => {
    const fx = retentionFixture();
    fx.seed({ runId: 'run-a', ticket: 'FE-201', worktree: false, endedAgoMs: 31 * DAY });
    const newer = fx.seed({ runId: 'run-b', ticket: 'FE-201', worktree: false, endedAgoMs: DAY });
    const keptBefore = Object.fromEntries(KEPT_FILES.map((name) => [name, contentsUnder(newer.runFolder)[name]]));
    const rowsBefore = fx.eventRows();

    const result = await fx.clean();

    expect(existsSync(join(newer.runFolder, 'ticket.json'))).toBe(false);
    expect(filesUnder(join(newer.runFolder, 'prompts'))).toEqual([]);
    expect(filesUnder(join(newer.runFolder, 'evidence'))).toEqual([]);
    expect(contentsUnder(newer.runFolder)).toEqual(keptBefore);
    expect(result.artifacts_deleted.map((entry) => entry.run_id)).toEqual(['run-a']);
    expect(eventsOf(fx.reader, 'run-a', 'retention_cleaned')).toHaveLength(1);
    expect(eventsOf(fx.reader, 'run-b', 'retention_cleaned')).toEqual([]);
    expect(fx.eventRows().slice(0, rowsBefore.length)).toEqual(rowsBefore);
  });

  test('empty prompts/ and evidence/ folders of a run that ended more than 30 days ago are removed and listed in one retention event', async () => {
    const fx = retentionFixture();
    const run = fx.seed({ runId: 'run-a', ticket: 'FE-201', worktree: false, endedAgoMs: 31 * DAY });
    for (const name of ['prompts', 'evidence']) {
      rmSync(join(run.runFolder, name), { recursive: true });
      mkdirSync(join(run.runFolder, name));
    }
    rmSync(join(run.runFolder, 'ticket.json'));
    const keptBefore = Object.fromEntries(KEPT_FILES.map((name) => [name, contentsUnder(run.runFolder)[name]]));
    const rowsBefore = fx.eventRows();

    const result = await fx.clean();

    expect(existsSync(join(run.runFolder, 'prompts'))).toBe(false);
    expect(existsSync(join(run.runFolder, 'evidence'))).toBe(false);
    expect(contentsUnder(run.runFolder)).toEqual(keptBefore);
    expect(existsSync(join(run.runFolder, 'report.md'))).toBe(true);
    expect(existsSync(join(run.runFolder, 'plan.md'))).toBe(true);
    expect(result.artifacts_deleted).toEqual([{ run_id: 'run-a', paths: ['evidence', 'prompts'] }]);
    expect(fx.eventRows().slice(0, rowsBefore.length)).toEqual(rowsBefore);
    const events = eventsOf(fx.reader, 'run-a', 'retention_cleaned');
    expect(events).toHaveLength(1);
    expect((events[0]?.payload as { paths: string[] }).paths).toEqual(['evidence', 'prompts']);

    const rowsAfterFirst = fx.eventRows();
    const second = await fx.clean();
    expect(second.artifacts_deleted).toEqual([]);
    expect(fx.eventRows()).toEqual(rowsAfterFirst);
  });

  test('a second clean finds nothing to do and adds no event', async () => {
    const fx = retentionFixture();
    fx.seed({ runId: 'run-a', ticket: 'FE-201', worktree: false, endedAgoMs: 31 * DAY });
    await fx.clean();
    const rowsAfterFirst = fx.eventRows();

    const second = await fx.clean();

    expect(second.artifacts_deleted).toEqual([]);
    expect(fx.eventRows()).toEqual(rowsAfterFirst);
  });

  test('a run with no ended_at keeps every artifact, however far the clock moves', async () => {
    const fx = retentionFixture();
    const run = fx.seed({ runId: 'run-a', ticket: 'FE-201', worktree: false, status: 'killed' });
    const before = contentsUnder(run.runFolder);
    fx.deps.advance(1000 * DAY);

    const result = await fx.clean();

    expect(result.artifacts_deleted).toEqual([]);
    expect(contentsUnder(run.runFolder)).toEqual(before);
  });

  test('a symlink inside evidence/ is removed as a link and its target outside the run folder is kept', async () => {
    const fx = retentionFixture();
    const run = fx.seed({ runId: 'run-a', ticket: 'FE-201', worktree: false, endedAgoMs: 31 * DAY });
    const outside = join(makeTempHome(), 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'keep.txt'), 'kept\n');
    symlinkSync(outside, join(run.runFolder, 'evidence', 'link-out'));

    await fx.clean();

    expect(existsSync(join(outside, 'keep.txt'))).toBe(true);
    expect(filesUnder(join(run.runFolder, 'evidence'))).toEqual([]);
  });
});

describe('artifact retention: cleaning never leaves the factory runs folder', () => {
  test('a run folder reached through a symlinked folder that points outside the runs folder keeps its outside ticket.json, prompts/ and evidence/', async () => {
    const fx = retentionFixture();
    const run = fx.seed({ runId: 'run-a', ticket: 'FE-201', worktree: false, endedAgoMs: 31 * DAY });
    // The repo folder under the runs root becomes a link to a folder elsewhere; the run's path stays the same.
    const linked = dirname(run.runFolder);
    const outside = join(makeTempHome(), 'outside');
    mkdirSync(outside);
    renameSync(linked, join(outside, 'example-frontend'));
    symlinkSync(join(outside, 'example-frontend'), linked);
    const target = join(outside, 'example-frontend', 'FE-201');
    const before = contentsUnder(target);
    const rowsBefore = fx.eventRows();

    const result = await fx.clean();

    expect(result.artifacts_deleted).toEqual([]);
    expect(contentsUnder(target)).toEqual(before);
    for (const name of OLD_ARTIFACTS) expect(existsSync(join(target, name)), name).toBe(true);
    expect(fx.eventRows()).toEqual(rowsBefore);
  });
});
