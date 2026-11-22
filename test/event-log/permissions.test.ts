import { chmodSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';

import { openEventLog } from '../../src/event-log/open.js';
import { createFakeDeps } from '../support/fake-deps.js';
import { cleanupEventLogTest, eventLogSandbox, openRaw, runInput, track } from '../support/event-log.js';

afterEach(cleanupEventLogTest);

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe('event log file permissions', () => {
  test('a missing factory home is created with mode 0700', () => {
    const sb = eventLogSandbox();
    expect(existsSync(sb.home)).toBe(false);

    track(openEventLog({ env: sb.env, deps: createFakeDeps() }));

    expect(modeOf(sb.home)).toBe(0o700);
  });

  test('factory.db is mode 0600 after a fresh open', () => {
    const sb = eventLogSandbox();

    track(openEventLog({ env: sb.env, deps: createFakeDeps() }));

    expect(modeOf(sb.dbPath)).toBe(0o600);
  });

  test('an existing home at 0755 and an existing db at 0644 are tightened to 0700 and 0600 on open', () => {
    const sb = eventLogSandbox();
    mkdirSync(sb.home, { recursive: true });
    chmodSync(sb.home, 0o755);
    const raw = openRaw(sb.dbPath);
    raw.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    raw.exec("INSERT INTO meta (key, value) VALUES ('schema_version', '0')");
    raw.close();
    chmodSync(sb.dbPath, 0o644);
    expect([modeOf(sb.home), modeOf(sb.dbPath)]).toEqual([0o755, 0o644]);

    track(openEventLog({ env: sb.env, deps: createFakeDeps() }));

    expect(modeOf(sb.home)).toBe(0o700);
    expect(modeOf(sb.dbPath)).toBe(0o600);
  });

  test('after a write that creates WAL sidecars, factory.db-wal and factory.db-shm are mode 0600', () => {
    const sb = eventLogSandbox();
    const log = track(openEventLog({ env: sb.env, deps: createFakeDeps() }));

    log.insertRun(runInput());
    log.appendEvent({ run_id: 'run-1', type: 'run_started' });

    expect(existsSync(`${sb.dbPath}-wal`)).toBe(true);
    expect(existsSync(`${sb.dbPath}-shm`)).toBe(true);
    expect(modeOf(`${sb.dbPath}-wal`)).toBe(0o600);
    expect(modeOf(`${sb.dbPath}-shm`)).toBe(0o600);
  });

  test('a later write retightens WAL sidecars that have become 0644', () => {
    const sb = eventLogSandbox();
    const log = track(openEventLog({ env: sb.env, deps: createFakeDeps() }));
    log.insertRun(runInput());
    chmodSync(`${sb.dbPath}-wal`, 0o644);
    chmodSync(`${sb.dbPath}-shm`, 0o644);
    expect([modeOf(`${sb.dbPath}-wal`), modeOf(`${sb.dbPath}-shm`)]).toEqual([0o644, 0o644]);

    log.appendEvent({ run_id: 'run-1', type: 'run_started' });

    expect(modeOf(`${sb.dbPath}-wal`)).toBe(0o600);
    expect(modeOf(`${sb.dbPath}-shm`)).toBe(0o600);
  });
});
