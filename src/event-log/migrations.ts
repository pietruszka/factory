import type { DatabaseSync } from 'node:sqlite';

import { SCHEMA_VERSION } from './schema.js';
import { inTransaction } from './sql.js';

export interface Migration {
  /** The schema version the database has after this batch. Versions are consecutive from 1. */
  version: number;
  sql: string;
}

// Tables that are append-only (P-4): a raw UPDATE or DELETE is refused by a trigger.
const APPEND_ONLY_TABLES = ['events', 'check_rows', 'approvals', 'shadow_verdicts', 'outcomes'];

const appendOnlyTriggers = APPEND_ONLY_TABLES.flatMap((table) => [
  `CREATE TRIGGER ${table}_no_update BEFORE UPDATE ON ${table}
   BEGIN SELECT RAISE(ABORT, '${table} is append-only: updates are refused'); END;`,
  `CREATE TRIGGER ${table}_no_delete BEFORE DELETE ON ${table}
   BEGIN SELECT RAISE(ABORT, '${table} is append-only: deletes are refused'); END;`,
]).join('\n');

// Shipped batches are never edited: a change is a new entry with the next version number.
export const MIGRATIONS: readonly Migration[] = [
  {
    version: 1,
    sql: `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE runs (
  run_id TEXT PRIMARY KEY,
  repo TEXT NOT NULL,
  ticket TEXT NOT NULL,
  flow TEXT NOT NULL,
  tier TEXT,
  status TEXT NOT NULL CHECK (status IN (
    'preflight', 'routing', 'planning', 'building', 'gating', 'verifying', 'reviewing',
    'opening_pr', 'awaiting_approval', 'passed', 'refused', 'config_drift', 'needs_human',
    'cannot_reproduce', 'budget', 'timeout', 'cost_missing', 'breach', 'killed', 'interrupted'
  )),
  base_commit TEXT NOT NULL,
  config_hash TEXT NOT NULL,
  factory_version TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  cap_usd_effective REAL
);

CREATE UNIQUE INDEX runs_one_active ON runs (repo, ticket)
  WHERE status NOT IN ('passed', 'refused', 'breach');

CREATE TABLE steps (
  run_id TEXT NOT NULL REFERENCES runs (run_id),
  step TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 1,
  role TEXT,
  model TEXT,
  purpose TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'failed')),
  exit_reason TEXT,
  input_hash TEXT,
  cli_session_id TEXT,
  started_at TEXT,
  ended_at TEXT,
  PRIMARY KEY (run_id, step, attempt)
);

CREATE TABLE events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs (run_id),
  step TEXT,
  attempt INTEGER,
  type TEXT NOT NULL CHECK (length(type) > 0),
  role TEXT,
  model TEXT,
  purpose TEXT,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  status TEXT,
  input_tokens REAL,
  output_tokens REAL,
  cache_read_tokens REAL,
  cache_write_tokens REAL,
  reasoning_tokens REAL,
  cost_usd REAL,
  usage_source TEXT CHECK (usage_source IS NULL OR usage_source IN ('reported', 'estimated')),
  context_used INTEGER,
  context_window INTEGER,
  payload_json TEXT
);
CREATE INDEX events_run ON events (run_id, id);

CREATE TABLE check_rows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES events (id),
  gate TEXT NOT NULL,
  item TEXT NOT NULL,
  ok INTEGER NOT NULL CHECK (ok IN (0, 1)),
  note TEXT
);

CREATE TABLE processes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs (run_id),
  step TEXT NOT NULL,
  pid INTEGER NOT NULL,
  command TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT
);

CREATE TABLE approvals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs (run_id),
  plan_hash TEXT NOT NULL,
  hash_algo TEXT NOT NULL,
  approver TEXT NOT NULL,
  client TEXT NOT NULL,
  approved_at TEXT NOT NULL
);

CREATE TABLE shadow_verdicts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs (run_id),
  plan_hash TEXT NOT NULL,
  would_approve INTEGER NOT NULL CHECK (would_approve IN (0, 1)),
  rows_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE outcomes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs (run_id),
  outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'accepted_with_edits', 'rejected', 'abandoned')),
  reason TEXT,
  note TEXT,
  recorded_at TEXT NOT NULL
);

${appendOnlyTriggers}
`,
  },
];

/** The version recorded in `meta`; 0 when there is no `meta` table or no `schema_version` row. */
export function readSchemaVersion(db: DatabaseSync): number {
  const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'").get();
  if (table === undefined) {
    return 0;
  }
  const row = db.prepare("SELECT value FROM meta WHERE key = 'schema_version'").get();
  if (row === undefined) {
    return 0;
  }
  const version = Number(row.value);
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`meta.schema_version is not a non-negative integer: ${String(row.value)}`);
  }
  return version;
}

/**
 * Applies every batch newer than the file's version in one transaction, so a failed batch leaves
 * the file unchanged. Returns the version after the run. The caller has already refused files
 * newer than SCHEMA_VERSION.
 */
export function migrate(db: DatabaseSync, factoryVersion: string): number {
  inTransaction(db, () => {
    // Read again under the write lock: another process may have migrated since the caller looked.
    const current = readSchemaVersion(db);
    for (const migration of MIGRATIONS.filter((candidate) => candidate.version > current)) {
      db.exec(migration.sql);
      db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('schema_version', ?)").run(
        String(migration.version),
      );
    }
    db.prepare("INSERT OR IGNORE INTO meta (key, value) VALUES ('factory_version_created', ?)").run(
      factoryVersion,
    );
  });
  return SCHEMA_VERSION;
}
