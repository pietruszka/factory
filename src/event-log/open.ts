import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import { createRequire } from 'node:module';
import type { DatabaseSync as Database } from 'node:sqlite';

import type { Deps } from '../platform/deps.js';
import { FactoryError } from '../platform/errors.js';
import { resolveFactoryPaths } from '../platform/paths.js';
import { collectSecretValues } from '../redaction/redact.js';
import { migrate, readSchemaVersion } from './migrations.js';
import { SCHEMA_VERSION } from './schema.js';
import { createWriters, type EventLogWriters } from './writers.js';

export type { EventInput, RunInput } from './schema.js';

// node:sqlite is loaded with createRequire because the vite-node runner that runs the tests strips
// the node: prefix from a static import of it and then fails to resolve `sqlite`. This is still
// the built-in driver; there is no other SQLite dependency.
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');

const BUSY_TIMEOUT_MS = 5000;
const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const SQLITE_BUSY = 5;
const SQLITE_LOCKED = 6;

export interface OpenEventLogOptions {
  env: NodeJS.ProcessEnv;
  deps: Deps;
  /** Extra exact values to redact besides the secret-named environment values. */
  extraSecrets?: readonly string[];
  /** Stored once as `meta.factory_version_created` when the file is created. Defaults to `unknown`. */
  factoryVersion?: string;
}

export interface OpenReadOnlyOptions {
  env: NodeJS.ProcessEnv;
}

/** Values of the four durability settings on the writable connection, as SQLite reports them. */
interface EventLogPragmas {
  journal_mode: string;
  /** 1 is NORMAL. */
  synchronous: number;
  /** 1 is on. */
  foreign_keys: number;
  busy_timeout: number;
}

export interface EventLog extends EventLogWriters {
  /**
   * Diagnostic: reads the four connection settings back from SQLite. It is the only way to check
   * them without opening a second connection; the connection itself is not exposed.
   */
  pragmas(): EventLogPragmas;
  /** Closes the database. Closing twice is fine. */
  close(): void;
}

export interface EventLogReadOnly {
  /**
   * Diagnostic and inspector read: runs one SQL statement on the read-only connection and returns
   * its rows. A statement that writes throws.
   */
  query(sql: string, ...params: Array<string | number | null>): Array<Record<string, unknown>>;
  /** Closes the database. Closing twice is fine. */
  close(): void;
}

function dbFailure(code: string, message: string, where: string, next: string, exitCode = 4): FactoryError {
  return new FactoryError({ code, message, where, next, exitCode });
}

function schemaNewer(path: string, version: number): FactoryError {
  return dbFailure(
    'db_schema_newer',
    `${path} has schema version ${version}, but this factory supports up to ${SCHEMA_VERSION}.`,
    path,
    `The file is at schema version ${version}. Install a factory release that supports it, or restore a backup of the database from before the upgrade.`,
  );
}

/** Turns a SQLite error into a FactoryError. FactoryErrors pass through. */
function asFactoryError(error: unknown, path: string): unknown {
  if (error instanceof FactoryError) {
    return error;
  }
  const detail = error instanceof Error ? error.message : String(error);
  const errcode = (error as { errcode?: unknown } | null)?.errcode;
  const primary = typeof errcode === 'number' ? errcode & 0xff : undefined;
  if (primary === SQLITE_BUSY || primary === SQLITE_LOCKED) {
    return dbFailure(
      'db_busy',
      `${path} is locked by another process: ${detail}`,
      path,
      'Wait for the other factory process to finish, then run the command again.',
    );
  }
  return dbFailure(
    'db_unreadable',
    `${path} cannot be used as the factory database: ${detail}`,
    path,
    'Restore a backup of the file, or move it aside so a new database can be created, then run the command again.',
  );
}

function closeQuietly(db: Database | undefined): void {
  try {
    db?.close();
  } catch {
    // Already closed, or never opened.
  }
}

/** Closes at most once, so a second close() call is a no-op. */
function closeOnce(db: Database): () => void {
  let closed = false;
  return () => {
    if (!closed) {
      closed = true;
      db.close();
    }
  };
}

/** Creates the file as 0600 if it is missing, and tightens it, with its WAL sidecars, if it exists. */
function secureFiles(dbPath: string): void {
  if (!existsSync(dbPath)) {
    closeSync(openSync(dbPath, 'a', FILE_MODE));
  }
  for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    if (existsSync(path)) {
      chmodSync(path, FILE_MODE);
    }
  }
}

/** Re-applies 0600 after a write, because a WAL/SHM sidecar can appear only then. */
function withSecuredWrites(writers: EventLogWriters, dbPath: string): EventLogWriters {
  const after = (): void => {
    secureFiles(dbPath);
  };
  return {
    insertRun: (input) => {
      try {
        return writers.insertRun(input);
      } finally {
        after();
      }
    },
    updateRunStatus: (run_id, status, ended_at) => {
      try {
        writers.updateRunStatus(run_id, status, ended_at);
      } finally {
        after();
      }
    },
    updateRunBaseCommit: (run_id, base_commit) => {
      try {
        writers.updateRunBaseCommit(run_id, base_commit);
      } finally {
        after();
      }
    },
    updateRunCap: (run_id, cap_usd_effective) => {
      try {
        writers.updateRunCap(run_id, cap_usd_effective);
      } finally {
        after();
      }
    },
    upsertStep: (input) => {
      try {
        writers.upsertStep(input);
      } finally {
        after();
      }
    },
    appendEvent: (input) => {
      try {
        return writers.appendEvent(input);
      } finally {
        after();
      }
    },
    appendCheckRows: (event_id, rows) => {
      try {
        writers.appendCheckRows(event_id, rows);
      } finally {
        after();
      }
    },
    appendProcess: (input) => {
      try {
        return writers.appendProcess(input);
      } finally {
        after();
      }
    },
    endProcess: (id) => {
      try {
        writers.endProcess(id);
      } finally {
        after();
      }
    },
    appendApproval: (input) => {
      try {
        return writers.appendApproval(input);
      } finally {
        after();
      }
    },
    appendShadowVerdict: (input) => {
      try {
        return writers.appendShadowVerdict(input);
      } finally {
        after();
      }
    },
    appendOutcome: (input) => {
      try {
        return writers.appendOutcome(input);
      } finally {
        after();
      }
    },
  };
}


function readPragma(db: Database, name: string, column = name): unknown {
  return db.prepare(`PRAGMA ${name}`).get()?.[column];
}

/** Opens (and creates or migrates) the event log under the factory home. The only writer. */
export function openEventLog(options: OpenEventLogOptions): EventLog {
  const { home, dbPath } = resolveFactoryPaths(options.env);
  mkdirSync(home, { recursive: true, mode: DIR_MODE });
  chmodSync(home, DIR_MODE);
  secureFiles(dbPath);

  let db: Database | undefined;
  try {
    db = new DatabaseSync(dbPath);
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    // Read the version before changing anything, so a newer file is left untouched.
    const version = readSchemaVersion(db);
    if (version > SCHEMA_VERSION) {
      throw schemaNewer(dbPath, version);
    }
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    db.exec('PRAGMA foreign_keys = ON');
    if (version < SCHEMA_VERSION) {
      migrate(db, options.factoryVersion ?? 'unknown');
    }
    secureFiles(dbPath);
  } catch (error) {
    closeQuietly(db);
    throw asFactoryError(error, dbPath);
  }

  const open = db;
  const secrets = collectSecretValues(options.env, options.extraSecrets);
  const close = closeOnce(open);
  return {
    ...withSecuredWrites(createWriters({ db: open, deps: options.deps, secrets }), dbPath),
    pragmas: () => ({
      journal_mode: String(readPragma(open, 'journal_mode')),
      synchronous: Number(readPragma(open, 'synchronous')),
      foreign_keys: Number(readPragma(open, 'foreign_keys')),
      busy_timeout: Number(readPragma(open, 'busy_timeout', 'timeout')),
    }),
    close: () => {
      close();
      secureFiles(dbPath);
    },
  };
}

/**
 * Opens the existing event log read-only. Creates nothing, loosens no modes, and refuses a file
 * that is missing, older than this build (it must be opened writably once to migrate) or newer.
 */
export function openEventLogReadOnly(options: OpenReadOnlyOptions): EventLogReadOnly {
  const { dbPath } = resolveFactoryPaths(options.env);
  if (!existsSync(dbPath)) {
    throw dbFailure(
      'db_not_found',
      `There is no event log at ${dbPath}.`,
      dbPath,
      'Run a factory command that records a run first; it creates the event log.',
      2,
    );
  }

  let db: Database | undefined;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    const version = readSchemaVersion(db);
    if (version > SCHEMA_VERSION) {
      throw schemaNewer(dbPath, version);
    }
    if (version < SCHEMA_VERSION) {
      throw dbFailure(
        'db_schema_older',
        `${dbPath} has schema version ${version}, older than the ${SCHEMA_VERSION} this factory reads. A read-only open does not migrate.`,
        dbPath,
        'Run a factory command that writes to the event log once; it migrates the file. Then open it read-only again.',
      );
    }
  } catch (error) {
    closeQuietly(db);
    throw asFactoryError(error, dbPath);
  }

  const open = db;
  return {
    query: (sql, ...params) => open.prepare(sql).all(...params),
    close: closeOnce(open),
  };
}
