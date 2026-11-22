import { createRequire } from 'node:module';
import { join } from 'node:path';

import type { EventLog, EventLogReadOnly, RunInput } from '../../src/event-log/open.js';
import { FactoryError } from '../../src/platform/errors.js';
import { cleanupTempHomes, makeTempHome } from './temp-home.js';

// @types/node 20 has no typings for node:sqlite, so the driver is loaded with createRequire
// and typed here with the few members the tests use.
export interface RawStatement {
  all(...params: Array<string | number | null>): Array<Record<string, unknown>>;
  get(...params: Array<string | number | null>): Record<string, unknown> | undefined;
  run(...params: Array<string | number | null>): unknown;
}

export interface RawDb {
  exec(sql: string): void;
  prepare(sql: string): RawStatement;
  close(): void;
}

interface SqliteModule {
  DatabaseSync: new (path: string, options?: { readOnly?: boolean }) => RawDb;
}

const sqlite = createRequire(import.meta.url)('node:sqlite') as SqliteModule;

const openRawDbs: RawDb[] = [];
const openLogs: Array<EventLog | EventLogReadOnly> = [];

/** Opens its own node:sqlite connection on a file. Closed by closeAllDatabases. */
export function openRaw(path: string, options: { readOnly?: boolean } = {}): RawDb {
  const db = new sqlite.DatabaseSync(path, options);
  openRawDbs.push(db);
  return db;
}

/** Registers an event log handle so closeAllDatabases closes it. */
export function track<T extends EventLog | EventLogReadOnly>(log: T): T {
  openLogs.push(log);
  return log;
}

/** Closes every database opened through this module. Call from afterEach, before cleanupTempHomes. */
export function closeAllDatabases(): void {
  for (const log of openLogs.splice(0)) {
    try {
      log.close();
    } catch {
      // A test may already have closed it.
    }
  }
  for (const db of openRawDbs.splice(0)) {
    try {
      db.close();
    } catch {
      // A test may already have closed it.
    }
  }
}

/** The standard afterEach for event-log tests. */
export function cleanupEventLogTest(): void {
  closeAllDatabases();
  cleanupTempHomes();
}

export interface EventLogSandbox {
  tmp: string;
  /** Factory home inside the temp folder. It does not exist yet. */
  home: string;
  dbPath: string;
  env: NodeJS.ProcessEnv;
}

/** A fresh temp HOME with FACTORY_HOME pointing at a not yet created folder inside it. */
export function eventLogSandbox(extraEnv: NodeJS.ProcessEnv = {}): EventLogSandbox {
  const tmp = makeTempHome();
  const home = join(tmp, 'factory-home');
  return {
    tmp,
    home,
    dbPath: join(home, 'factory.db'),
    env: { HOME: tmp, FACTORY_HOME: home, ...extraEnv },
  };
}

/** Returns what `fn` throws, or fails the calling test if it does not throw. */
export function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw, but it returned');
}

/** Plain-object view of a FactoryError, so a failing test shows every field. */
export function errorFields(error: unknown): {
  isFactoryError: boolean;
  code?: string;
  message?: string;
  where?: string;
  next?: string;
  exitCode?: number;
} {
  if (!(error instanceof FactoryError)) {
    return { isFactoryError: false, message: error instanceof Error ? error.message : String(error) };
  }
  return {
    isFactoryError: true,
    code: error.code,
    message: error.message,
    where: error.where,
    next: error.next,
    exitCode: error.exitCode,
  };
}

/** A run with placeholder values for every required column; override what a test cares about. */
export function runInput(overrides: Partial<RunInput> = {}): RunInput {
  return {
    run_id: 'run-1',
    repo: 'example-frontend',
    ticket: 'FE-123',
    flow: 'A',
    status: 'preflight',
    base_commit: 'abc1234',
    config_hash: '0123456789abcdef'.repeat(4),
    factory_version: '0.0.0-test',
    ...overrides,
  };
}
