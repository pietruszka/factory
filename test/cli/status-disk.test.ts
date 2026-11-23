import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { parseEnvelope } from '../support/cli-harness.js';
import { cleanupStatusTest, HOUR, seedThreeRuns, statusCli, statusFixture } from '../support/status.js';

afterEach(cleanupStatusTest);

interface Disk {
  worktrees: number;
  runs: number;
  db: number;
  total: number;
  warning?: string;
}
const diskOf = (stdout: string): Disk | undefined => (parseEnvelope({ exitCode: 0, stdout, stderr: '' }).data as { disk?: Disk }).disk;

describe('factory status: disk use per area', () => {
  test('factory status shows disk use for worktrees, runs and the db without writing anything', async () => {
    const fx = statusFixture();
    seedThreeRuns(fx);
    writeFileSync(join(fx.sb.home, 'runs', 'example-frontend', 'FE-101', 'report.md'), 'x'.repeat(250));
    const worktree = join(fx.sb.home, 'cache', 'worktrees', 'example-frontend', 'FE-123');
    mkdirSync(worktree, { recursive: true });
    writeFileSync(join(worktree, 'blob.bin'), Buffer.alloc(4000));
    fx.freeze();
    const before = fx.snapshot();

    const json = await statusCli(fx, ['--json']);
    const text = await statusCli(fx, []);

    expect(json.exitCode, json.stderr).toBe(0);
    expect(text.exitCode, text.stderr).toBe(0);
    const disk = diskOf(json.stdout);
    expect(disk).toBeDefined();
    expect(disk?.runs).toBe(250);
    expect(disk?.worktrees).toBe(4000);
    expect(disk?.db).toBeGreaterThan(0);
    expect(disk?.warning).toBeUndefined();
    expect(text.stdout).toMatch(/worktrees/i);
    expect(text.stdout).toMatch(/runs/i);
    expect(text.stdout).toMatch(/\bdb\b/i);
    // Nothing was written: files, modes, mtimes and every table are as they were.
    expect(fx.snapshot()).toEqual(before);
  });

  test('a ticket filter does not change the disk totals, which cover the whole home', async () => {
    const fx = statusFixture();
    fx.addRun({ runId: 'run-a', ticket: 'FE-123', status: 'passed', lastEventAgoMs: HOUR });
    fx.addRun({ runId: 'run-b', ticket: 'FE-124', status: 'passed', lastEventAgoMs: HOUR });
    writeFileSync(join(fx.sb.home, 'runs', 'example-frontend', 'FE-124', 'report.md'), 'x'.repeat(300));

    const filtered = await statusCli(fx, ['FE-123', '--json']);

    expect(filtered.exitCode, filtered.stderr).toBe(0);
    expect(diskOf(filtered.stdout)?.runs).toBe(300);
  });
});
