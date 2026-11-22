import { afterEach, describe, expect, test } from 'vitest';

import { openEventLog, type EventLog } from '../../src/event-log/open.js';
import { RUN_STATUSES, type RunStatus } from '../../src/event-log/schema.js';
import { createFakeDeps } from '../support/fake-deps.js';
import {
  cleanupEventLogTest,
  errorFields,
  eventLogSandbox,
  openRaw,
  runInput,
  thrownBy,
  track,
  type EventLogSandbox,
} from '../support/event-log.js';

afterEach(cleanupEventLogTest);

function setup(): { sb: EventLogSandbox; log: EventLog } {
  const sb = eventLogSandbox();
  const log = track(openEventLog({ env: sb.env, deps: createFakeDeps() }));
  return { sb, log };
}

function insertFirst(log: EventLog, status: RunStatus): void {
  log.insertRun(runInput({ run_id: 'run-first', status }));
}

function insertSecond(log: EventLog, overrides: { repo?: string } = {}): { run_id: string } {
  return log.insertRun(runInput({ run_id: 'run-second', repo: overrides.repo ?? 'example-frontend' }));
}

describe('one active run per ticket and repo', () => {
  test('inserting a second run with the same repo and ticket while the first is preflight is refused as run_already_active, exit code 2, naming the existing run_id and a next action', () => {
    const { sb, log } = setup();
    insertFirst(log, 'preflight');

    const error = errorFields(thrownBy(() => insertSecond(log)));

    expect(error.code).toBe('run_already_active');
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain('run-first');
    expect(error.message).toContain('example-frontend');
    expect(error.message).toContain('FE-123');
    expect(error.next).toContain('factory status');
    expect(error.next).toContain('factory resume FE-123');
    const raw = openRaw(sb.dbPath, { readOnly: true });
    expect(raw.prepare('SELECT run_id FROM runs').all()).toEqual([{ run_id: 'run-first' }]);
  });

  test('the same refusal holds for a first run in needs_human', () => {
    const { log } = setup();
    insertFirst(log, 'needs_human');

    const error = errorFields(thrownBy(() => insertSecond(log)));

    expect(error.code).toBe('run_already_active');
    expect(error.message).toContain('run-first');
  });

  test.each(['killed', 'interrupted'] as const)('the same refusal holds for a first run in %s', (status) => {
    const { log } = setup();
    insertFirst(log, status);

    const error = errorFields(thrownBy(() => insertSecond(log)));

    expect(error.code).toBe('run_already_active');
  });

  test('after the first run is updated to passed, a second run for that ticket is allowed', () => {
    const { sb, log } = setup();
    insertFirst(log, 'preflight');

    log.updateRunStatus('run-first', 'passed');
    insertSecond(log);

    const raw = openRaw(sb.dbPath, { readOnly: true });
    expect(raw.prepare('SELECT run_id, status FROM runs ORDER BY run_id').all()).toEqual([
      { run_id: 'run-first', status: 'passed' },
      { run_id: 'run-second', status: 'preflight' },
    ]);
  });

  test.each(['refused', 'breach'])('the same allowance holds after %s', (status) => {
    const { sb, log } = setup();
    insertFirst(log, 'preflight');

    log.updateRunStatus('run-first', status);
    insertSecond(log);

    const raw = openRaw(sb.dbPath, { readOnly: true });
    expect(raw.prepare('SELECT run_id, status FROM runs ORDER BY run_id').all()).toEqual([
      { run_id: 'run-first', status },
      { run_id: 'run-second', status: 'preflight' },
    ]);
  });

  test('two runs for the same ticket in different repos are allowed', () => {
    const { sb, log } = setup();
    insertFirst(log, 'preflight');

    insertSecond(log, { repo: 'example-backend' });

    const raw = openRaw(sb.dbPath, { readOnly: true });
    expect(raw.prepare('SELECT run_id, repo FROM runs ORDER BY run_id').all()).toEqual([
      { run_id: 'run-first', repo: 'example-frontend' },
      { run_id: 'run-second', repo: 'example-backend' },
    ]);
  });

  test('a raw SQL INSERT of a second active row is also refused', () => {
    const { sb, log } = setup();
    insertFirst(log, 'preflight');
    const raw = openRaw(sb.dbPath);

    expect(() =>
      raw
        .prepare(
          `INSERT INTO runs (run_id, repo, ticket, flow, status, base_commit, config_hash, factory_version, started_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run('run-raw', 'example-frontend', 'FE-123', 'A', 'building', 'abc1234', '0'.repeat(64), '0.0.0-test', '2026-01-02T03:04:05.000Z'),
    ).toThrow();

    expect(raw.prepare('SELECT run_id FROM runs').all()).toEqual([{ run_id: 'run-first' }]);
  });
});

describe('run statuses', () => {
  test('updateRunStatus accepts every status of the state machine', () => {
    const { sb, log } = setup();
    insertFirst(log, 'preflight');
    const raw = openRaw(sb.dbPath, { readOnly: true });

    for (const status of RUN_STATUSES) {
      log.updateRunStatus('run-first', status);
      expect(raw.prepare('SELECT status FROM runs').get(), status).toEqual({ status });
    }
  });

  test('an unknown status is refused as row_invalid and the run keeps its status', () => {
    const { sb, log } = setup();
    insertFirst(log, 'preflight');

    const error = errorFields(thrownBy(() => log.updateRunStatus('run-first', 'merged')));

    expect(error.code).toBe('row_invalid');
    expect(error.exitCode).toBe(2);
    const raw = openRaw(sb.dbPath, { readOnly: true });
    expect(raw.prepare('SELECT status FROM runs').get()).toEqual({ status: 'preflight' });
  });

  test('moving a finished run back to an active status is refused while another run is active', () => {
    const { log } = setup();
    insertFirst(log, 'preflight');
    log.updateRunStatus('run-first', 'passed');
    insertSecond(log);

    const error = errorFields(thrownBy(() => log.updateRunStatus('run-first', 'building')));

    expect(error.code).toBe('run_already_active');
    expect(error.message).toContain('run-second');
  });
});
