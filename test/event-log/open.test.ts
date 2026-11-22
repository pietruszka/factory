import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';

import { openEventLog, openEventLogReadOnly } from '../../src/event-log/open.js';
import { SCHEMA_VERSION } from '../../src/event-log/schema.js';
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

const V1_TABLES = [
  'approvals',
  'check_rows',
  'events',
  'meta',
  'outcomes',
  'processes',
  'runs',
  'shadow_verdicts',
  'steps',
] as const;

function openWritable(sb: EventLogSandbox) {
  return track(openEventLog({ env: sb.env, deps: createFakeDeps() }));
}

function openReadOnly(sb: EventLogSandbox) {
  return track(openEventLogReadOnly({ env: sb.env }));
}

function schemaVersionOf(dbPath: string): string | undefined {
  const raw = openRaw(dbPath, { readOnly: true });
  const row = raw.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  return row === undefined ? undefined : String(row.value);
}

function tableNamesOf(dbPath: string): string[] {
  const raw = openRaw(dbPath, { readOnly: true });
  return raw
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => String(row.name));
}

/** A handmade SQLite file with only a meta table, written into the temp factory home. */
function writeMetaOnlyDb(sb: EventLogSandbox, schemaVersion: number): void {
  mkdirSync(sb.home, { recursive: true });
  const raw = openRaw(sb.dbPath);
  raw.exec('CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  raw.prepare("INSERT INTO meta (key, value) VALUES ('schema_version', ?)").run(String(schemaVersion));
  raw.close();
}

describe('opening the event log on a fresh home', () => {
  test('opening the event log on a fresh home creates factory.db under that home', () => {
    const sb = eventLogSandbox();

    openWritable(sb);

    expect(existsSync(sb.dbPath)).toBe(true);
    expect(sb.dbPath).toBe(`${sb.home}/factory.db`);
  });

  test('the database journal_mode is wal', () => {
    const sb = eventLogSandbox();
    const log = openWritable(sb);

    const raw = openRaw(sb.dbPath, { readOnly: true });
    expect(raw.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
    expect(log.pragmas().journal_mode).toBe('wal');
  });

  test('synchronous is NORMAL, foreign_keys are on and busy_timeout is 5000', () => {
    const sb = eventLogSandbox();
    const log = openWritable(sb);

    // SQLite reports synchronous NORMAL as 1 and foreign_keys ON as 1.
    expect(log.pragmas()).toMatchObject({ synchronous: 1, foreign_keys: 1, busy_timeout: 5000 });
  });

  test('SCHEMA_VERSION is 1', () => {
    expect(SCHEMA_VERSION).toBe(1);
  });

  test('meta.schema_version is 1 after a fresh open', () => {
    const sb = eventLogSandbox();
    openWritable(sb);

    expect(schemaVersionOf(sb.dbPath)).toBe('1');
  });

  test('a fresh database has the runs, steps, events, check_rows, processes, approvals, shadow_verdicts and outcomes tables', () => {
    const sb = eventLogSandbox();
    openWritable(sb);

    expect(tableNamesOf(sb.dbPath)).toEqual([...V1_TABLES]);
  });

  test('the driver import is node:sqlite', () => {
    const sb = eventLogSandbox();
    openWritable(sb);

    // The file is a real SQLite database that node:sqlite can open and write to.
    expect(readFileSync(sb.dbPath).subarray(0, 15).toString('latin1')).toBe('SQLite format 3');
    const raw = openRaw(sb.dbPath);
    raw.exec("INSERT INTO meta (key, value) VALUES ('smoke', 'ok')");
    expect(raw.prepare("SELECT value FROM meta WHERE key = 'smoke'").get()).toEqual({ value: 'ok' });
  });
});

describe('the read-only handle', () => {
  test('openEventLogReadOnly on a missing file is refused', () => {
    const sb = eventLogSandbox();

    const error = errorFields(thrownBy(() => openEventLogReadOnly({ env: sb.env })));

    expect(error.isFactoryError).toBe(true);
    expect(error.where).toBe(sb.dbPath);
    expect(error.next).toBeTruthy();
    expect(existsSync(sb.dbPath)).toBe(false);
  });

  test('a read-only handle can read rows and cannot insert', () => {
    const sb = eventLogSandbox();
    const log = openWritable(sb);
    log.insertRun(runInput());

    const readOnly = openReadOnly(sb);

    expect(readOnly.query('SELECT run_id, repo, ticket FROM runs')).toEqual([
      { run_id: 'run-1', repo: 'example-frontend', ticket: 'FE-123' },
    ]);
    expect(() =>
      readOnly.query(
        `INSERT INTO runs (run_id, repo, ticket, flow, status, base_commit, config_hash, factory_version, started_at)
         VALUES ('run-2', 'example-frontend', 'FE-124', 'A', 'preflight', 'abc1234', '${'0'.repeat(64)}', '0.0.0-test', '2026-01-02T03:04:05.000Z')`,
      ),
    ).toThrow();
    expect(readOnly.query('SELECT run_id FROM runs')).toEqual([{ run_id: 'run-1' }]);
  });
});

describe('migrating and refusing existing files', () => {
  test('a valid SQLite file with schema_version 0 is migrated to 1 and has the v1 tables', () => {
    const sb = eventLogSandbox();
    writeMetaOnlyDb(sb, 0);

    const log = openWritable(sb);
    log.close();

    expect(schemaVersionOf(sb.dbPath)).toBe('1');
    expect(tableNamesOf(sb.dbPath)).toEqual([...V1_TABLES]);
  });

  test('opening the same migrated file again stays at version 1 and does not drop rows', () => {
    const sb = eventLogSandbox();
    writeMetaOnlyDb(sb, 0);
    const first = openWritable(sb);
    first.insertRun(runInput());
    first.close();

    const second = openWritable(sb);
    second.close();

    expect(schemaVersionOf(sb.dbPath)).toBe('1');
    const raw = openRaw(sb.dbPath, { readOnly: true });
    expect(raw.prepare('SELECT run_id FROM runs').all()).toEqual([{ run_id: 'run-1' }]);
  });

  test('a database with schema_version 2 is refused as db_schema_newer, exit code 4, naming the path, the file version and the next action', () => {
    const sb = eventLogSandbox();
    writeMetaOnlyDb(sb, 2);

    const error = errorFields(thrownBy(() => openEventLog({ env: sb.env, deps: createFakeDeps() })));

    expect(error.code).toBe('db_schema_newer');
    expect(error.exitCode).toBe(4);
    expect(error.where).toBe(sb.dbPath);
    expect(error.next).toContain('2');
    expect(error.next).toMatch(/install|restore/i);
    expect(schemaVersionOf(sb.dbPath)).toBe('2');
  });

  test('a non-SQLite file at the db path is refused as db_unreadable, exit code 4, with a next action', () => {
    const sb = eventLogSandbox();
    mkdirSync(sb.home, { recursive: true });
    writeFileSync(sb.dbPath, 'this is plain text, not a SQLite database. '.repeat(10), 'utf8');

    const error = errorFields(thrownBy(() => openEventLog({ env: sb.env, deps: createFakeDeps() })));

    expect(error.code).toBe('db_unreadable');
    expect(error.exitCode).toBe(4);
    expect(error.where).toBe(sb.dbPath);
    expect(error.next).toBeTruthy();
  });

  test('openEventLogReadOnly on a version-0 file is refused and does not migrate', () => {
    const sb = eventLogSandbox();
    writeMetaOnlyDb(sb, 0);

    const error = errorFields(thrownBy(() => openEventLogReadOnly({ env: sb.env })));

    expect(error.isFactoryError).toBe(true);
    expect(error.where).toBe(sb.dbPath);
    expect(error.next).toBeTruthy();
    expect(schemaVersionOf(sb.dbPath)).toBe('0');
    expect(tableNamesOf(sb.dbPath)).toEqual(['meta']);
  });
});
