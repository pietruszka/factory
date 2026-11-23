import { existsSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { DISK_WARNING_BYTES, diskWarning, measureDiskUse } from '../../src/retention/disk-usage.js';
import { eventLogSandbox } from '../support/event-log.js';
import { FILE_BYTES, GIB, RUN_FOLDER_BYTES, retentionFixture } from '../support/retention.js';
import { cleanupStatusTest } from '../support/status.js';
import { makeTempHome } from '../support/temp-home.js';

afterEach(cleanupStatusTest);

describe('disk warning threshold', () => {
  test('the threshold is 10 GiB', () => {
    expect(DISK_WARNING_BYTES).toBe(10_737_418_240);
  });

  test('a total of exactly 10 GiB or less has no warning; one byte more has one that names 10 GiB', () => {
    expect(diskWarning(0)).toBeUndefined();
    expect(diskWarning(10 * GIB)).toBeUndefined();
    expect(diskWarning(10 * GIB + 1)).toMatch(/10 GiB/);
    expect(diskWarning(50 * GIB)).toMatch(/10 GiB/);
  });
});

describe('measureDiskUse', () => {
  test('counts the bytes of the worktrees, the run folders and the db, each in its own area', () => {
    const fx = retentionFixture();
    fx.seed({ runId: 'run-a', ticket: 'FE-201', worktree: false });
    mkdirSync(join(fx.worktreesRoot, 'example-frontend', 'FE-202'), { recursive: true });
    writeFileSync(join(fx.worktreesRoot, 'example-frontend', 'FE-202', 'blob.bin'), Buffer.alloc(4000));

    const use = measureDiskUse(fx.sb.env);

    expect(use.runs).toBe(RUN_FOLDER_BYTES);
    expect(use.worktrees).toBe(4000);
    expect(use.db).toBeGreaterThan(0);
    expect(use.total).toBeGreaterThanOrEqual(4000 + RUN_FOLDER_BYTES + use.db);
  });

  test('does not follow a symlink out of the factory roots', () => {
    const fx = retentionFixture();
    const outside = join(makeTempHome(), 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'big.bin'), Buffer.alloc(50_000));
    mkdirSync(fx.worktreesRoot, { recursive: true });
    writeFileSync(join(fx.worktreesRoot, 'own.bin'), Buffer.alloc(FILE_BYTES));
    symlinkSync(outside, join(fx.worktreesRoot, 'link-out'));

    const use = measureDiskUse(fx.sb.env);

    expect(use.worktrees).toBeLessThan(50_000);
  });

  test('with no factory home it returns zeros and creates nothing', () => {
    const sb = eventLogSandbox();

    expect(measureDiskUse(sb.env)).toEqual({ worktrees: 0, runs: 0, db: 0, total: 0 });
    expect(existsSync(sb.home)).toBe(false);
  });
});
