---
title: Event log (FAC-15)
description: The SQLite event log at factory.db - location, pragmas, schema version and migrations, tables, append-only triggers, the one-active-run index, redaction, permissions and errors.
---

# Event log (FAC-15)

The event log is the factory's SQLite database. It records runs, steps, events, gate rows, processes, approvals, shadow verdicts and outcomes. The code is `src/event-log/`. Nothing in the factory command line uses it yet; later tickets (run folders, state machine, status) build on it.

The per-run folder that sits next to it under the factory home is described in [Run folder](/reference/run-folder).

The code that writes run statuses, step checkpoints and loop events through it is described in [Run state](/reference/run-state). The `usage` and `run_stop` events, `cost_usd` summing and `cap_usd_effective` are described in [Caps and cost](/reference/caps).

## File and driver

- **Driver.** Node's built-in `node:sqlite` (`DatabaseSync`), needs Node `>=22.13`. There is no SQLite npm dependency. Node 22 prints an `ExperimentalWarning` on stderr the first time the module loads. `@types/node` 20 has no typings for it, so `src/event-log/node-sqlite.d.ts` declares the few members used; delete that file when `@types/node` is upgraded. The module is loaded with `createRequire`, because the vitest runner cannot resolve a static `node:sqlite` import.
- **Location.** `dbPath` from `resolveFactoryPaths` (see [Configuration](/reference/configuration)): `<home>/factory.db`, that is `~/.factory/factory.db` or `$FACTORY_HOME/factory.db`.
- **One writer.** The event log module is the only writer. `openEventLog({ env, deps, extraSecrets?, factoryVersion? })` opens it for writing and creates or migrates it. `openEventLogReadOnly({ env })` opens the same file with `readOnly: true`, for a later inspector.
- **No raw handle.** The `DatabaseSync` object is not part of the API. Two diagnostics exist: `pragmas()` on the writable handle reads the four settings below back, and `query(sql, ...params)` on the read-only handle runs one read statement (a write throws).

## Pragmas

Set on every writable open:

| Pragma | Value | Why |
| --- | --- | --- |
| `journal_mode` | `WAL` | A read-only connection can read while the writer is open. |
| `synchronous` | `NORMAL` | With WAL the file stays consistent after a process crash. The last frames not yet checkpointed can be lost on power loss; that case is not tested in the MVP. |
| `foreign_keys` | `ON` | The references below are enforced. |
| `busy_timeout` | `5000` | Wait up to 5 seconds for a lock. |

## Schema version and migrations

`meta` holds `schema_version` (an integer as text) and `factory_version_created`. The current version is `1`.

Migrations are a numbered list of SQL batches in `src/event-log/migrations.ts`. A shipped batch is never edited; a change is a new batch with the next number.

- A missing file, or a valid SQLite file at version 0 (no `meta` table, no `schema_version` row, or `schema_version` 0), is migrated forward in one transaction on a writable open. A failed batch leaves the file unchanged.
- A file with a newer version is refused with `db_schema_newer` before anything in it is changed.
- A read-only open of an older file is refused with `db_schema_older` and does not migrate. Open it writably once to migrate it.

## Tables (version 1)

Columns named `*_at` are ISO-8601 text. Timestamp columns are ISO-8601 text. Nullable columns are those the Architecture sketch leaves optional, including `tier`, `ended_at`, `cap_usd_effective`, notes and reasons, and the usage, role and checkpoint fields on `events` and `steps`.

| Table | Columns | Notes |
| --- | --- | --- |
| `meta` | `key TEXT PRIMARY KEY`, `value TEXT NOT NULL` | |
| `runs` | `run_id TEXT PRIMARY KEY`, `repo`, `ticket`, `flow`, `tier`, `status`, `base_commit`, `config_hash`, `factory_version`, `started_at`, `ended_at`, `cap_usd_effective REAL` | All text except the last. `status` is checked against the list below. `status` and `ended_at` are mutable. |
| `steps` | `run_id`, `step`, `attempt INTEGER DEFAULT 1`, `role`, `model`, `purpose`, `status`, `exit_reason`, `input_hash`, `cli_session_id`, `started_at`, `ended_at` | Primary key `(run_id, step, attempt)`. `status` is `pending`, `running`, `done` or `failed`. Mutable: this is the checkpoint table. |
| `events` | `id INTEGER PRIMARY KEY AUTOINCREMENT`, `run_id`, `step`, `attempt`, `type`, `role`, `model`, `purpose`, `started_at`, `ended_at`, `status`, `input_tokens`, `output_tokens`, `cache_read_tokens`, `cache_write_tokens`, `reasoning_tokens`, `cost_usd`, `usage_source` (`reported` or `estimated`), `context_used`, `context_window`, `payload_json` | `type` is non-empty. Token and cost columns are optional. Free text goes in `payload_json`. Append-only. Indexed as `events_run (run_id, id)`. |
| `check_rows` | `id`, `event_id`, `gate`, `item`, `ok INTEGER (0 or 1)`, `note` | One row per checked item of a gate event. Append-only. |
| `processes` | `id`, `run_id`, `step`, `pid INTEGER`, `command`, `started_at`, `ended_at` | `ended_at` is set once through `endProcess`. |
| `approvals` | `id`, `run_id`, `plan_hash`, `hash_algo`, `approver`, `client`, `approved_at` | Append-only. `hash_algo` defaults to `sha256`. |
| `shadow_verdicts` | `id`, `run_id`, `plan_hash`, `would_approve INTEGER (0 or 1)`, `rows_json`, `created_at` | Append-only. |
| `outcomes` | `id`, `run_id`, `outcome`, `reason`, `note`, `recorded_at` | Append-only. `outcome` is `accepted`, `accepted_with_edits`, `rejected` or `abandoned`. |

Foreign keys: `steps.run_id`, `events.run_id`, `processes.run_id`, `approvals.run_id`, `shadow_verdicts.run_id` and `outcomes.run_id` reference `runs(run_id)`. `check_rows.event_id` references `events(id)`.

Allowed `runs.status` values: the phases `preflight`, `routing`, `planning`, `building`, `gating`, `verifying`, `reviewing`, `opening_pr`, `awaiting_approval`; the terminal `passed`; and the stop names `refused`, `config_drift`, `needs_human`, `cannot_reproduce`, `budget`, `timeout`, `cost_missing`, `breach`, `killed`, `interrupted`.

## Writers

`insertRun`, `updateRunStatus`, `upsertStep`, `appendEvent`, `appendCheckRows`, `appendProcess`, `endProcess`, `appendApproval`, `appendShadowVerdict`, `appendOutcome` and `close()`. A missing `run_id` is taken from `deps.newId('run')`. A missing timestamp is `deps.toIso(deps.now())`; the event log never reads the clock itself.

Every input is validated with a Zod schema before anything is written. Unknown fields are refused rather than dropped.

## Append-only tables

`events`, `check_rows`, `approvals`, `shadow_verdicts` and `outcomes` have no update or delete method, and `BEFORE UPDATE` and `BEFORE DELETE` triggers abort a raw SQL update or delete too. Event ids increase monotonically, also across reopen. Rows are never deleted by the factory.

## One active run per repo and ticket

```sql
CREATE UNIQUE INDEX runs_one_active ON runs (repo, ticket)
  WHERE status NOT IN ('passed', 'refused', 'breach');
```

`passed`, `refused` and `breach` are the non-resumable statuses. A run in any other status, including `needs_human`, `killed` and `interrupted`, still holds the slot. A second run for the same repo and ticket is refused as `run_already_active`. Two runs for the same ticket in different repos are allowed. This is the database half of the one-run rule; marking dead runs as interrupted and path-overlap checks come later.

## Redaction

Every text column and every JSON payload is redacted before the row is written; nothing is written first and scrubbed later. The code is `src/redaction/redact.ts`. Two layers replace text with `[REDACTED]`:

1. **Exact values.** Values of environment variables whose name contains `KEY`, `TOKEN`, `SECRET`, `PASSWORD`, `PASS`, `AUTH` or `CREDENTIAL`, plus the `extraSecrets` the caller passes. Values shorter than 6 characters are skipped. The environment is read once, at open.
2. **Patterns.** A best-effort scan for the prefixes `ghp_`, `gho_`, `ghu_`, `ghs_`, `github_pat_`, `sk-`, `AKIA`, `xoxb-`, `xoxp-`, `xoxa-` (followed by at least 8 token characters) and for PEM private-key blocks.

The scan is not a guarantee: a secret in an unknown format that is not in the environment is stored as it is. Ticket text is not a column yet. When it is stored later (`ticket.json`), the pattern scan is skipped on that field and exact-value redaction of loaded secrets still applies. The probe has its own redaction (`src/probe/redact.ts`), which this does not replace.

## Permissions

A writable open creates the factory home with mode `0700` if it is missing, and sets the home to `0700` and `factory.db` and any `factory.db-wal` and `factory.db-shm` to `0600`, tightening existing files that are too open. It touches no other folder. A read-only open creates nothing and changes no mode.

## Errors

Each is a `FactoryError` with `where` and `next`.

| Code | Exit | When |
| --- | --- | --- |
| `event_invalid` | 2 | An event is missing a required field, has a bad value or an unknown field, or names a run that does not exist. `where` is `events.<field>`. |
| `row_invalid` | 2 | The same for every other table. `where` is `<table>.<field>`. |
| `run_already_active` | 2 | The one-active-run index refused a write. Names the repo, ticket and the existing `run_id`; `next` points to `factory status` and `factory resume <ticket>`. |
| `db_not_found` | 2 | A read-only open and no file. |
| `db_schema_newer` | 4 | The file's version is above this build's. `next` names the file's version: install a factory that supports it, or restore a backup. |
| `db_schema_older` | 4 | A read-only open of a file below the current version. |
| `db_unreadable` | 4 | The file is not a SQLite database, is corrupt, or cannot be migrated. |
| `db_busy` | 4 | Another process held the lock for longer than the busy timeout. |

## Not in this ticket

A factory command that reads the log, the inspector UI, run folders, worktrees and path overlap, stale-pid marking, retention, reading an older schema without migrating, and storing ticket snapshots.
