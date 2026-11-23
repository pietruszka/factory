import type { DatabaseSync, SQLInputValue } from 'node:sqlite';
import type { z } from 'zod';

import type { Deps } from '../platform/deps.js';
import { FactoryError } from '../platform/errors.js';
import { redactValue } from '../redaction/redact.js';
import {
  approvalSchema,
  checkRowSchema,
  eventSchema,
  NON_RESUMABLE_RUN_STATUSES,
  outcomeSchema,
  processSchema,
  runSchema,
  shadowVerdictSchema,
  stepSchema,
  type ApprovalInput,
  type CheckRowInput,
  type EventInput,
  type OutcomeInput,
  type ProcessInput,
  type RunInput,
  type ShadowVerdictInput,
  type StepInput,
} from './schema.js';
import { inTransaction } from './sql.js';

/** The write side of the event log. There is no update or delete for the append-only tables. */
export interface EventLogWriters {
  /** Adds a run. Refused as `run_already_active` while another run of the repo and ticket is active. */
  insertRun(input: RunInput): { run_id: string };
  /** Moves a run to another status. `ended_at` is kept as it is unless given. */
  updateRunStatus(run_id: string, status: string, ended_at?: string): void;
  /** Sets `runs.base_commit` in place, for example to the HEAD of the worktree on resume. */
  updateRunBaseCommit(run_id: string, base_commit: string): void;
  /** Sets `runs.cap_usd_effective` in place, for example when `factory resume --cap` raises it. */
  updateRunCap(run_id: string, cap_usd_effective: number): void;
  /** Adds a step attempt or changes the status and times of an existing one (a checkpoint). */
  upsertStep(input: StepInput): void;
  appendEvent(input: EventInput): { id: number };
  /** Adds the rows of one gate result to an event, all or none. */
  appendCheckRows(event_id: number, rows: readonly CheckRowInput[]): void;
  appendProcess(input: ProcessInput): { id: number };
  /** Sets `ended_at` of a process to the clock time. Ending an ended process changes nothing. */
  endProcess(id: number): void;
  appendApproval(input: ApprovalInput): { id: number };
  appendShadowVerdict(input: ShadowVerdictInput): { id: number };
  appendOutcome(input: OutcomeInput): { id: number };
}

export interface WriterContext {
  db: DatabaseSync;
  deps: Deps;
  /** Exact values to redact; see collectSecretValues. */
  secrets: readonly string[];
}

type Row = Record<string, unknown>;

const NON_RESUMABLE_SQL = NON_RESUMABLE_RUN_STATUSES.map((status) => `'${status}'`).join(', ');

function invalid(code: string, table: string, field: string, message: string): FactoryError {
  return new FactoryError({
    code,
    message: `Cannot write to ${table}: ${field} ${message}. Nothing was written.`,
    where: `${table}.${field}`,
    next: `Fix ${field} in the ${table} input and write it again.`,
    exitCode: 2,
  });
}

/** Parses `input` with `schema` or throws `code` naming the first bad field. */
function parseRow<S extends z.ZodType>(schema: S, input: unknown, table: string, code: string): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) {
    return result.data;
  }
  const issue = result.error.issues[0];
  if (issue === undefined) {
    throw invalid(code, table, '(row)', 'is invalid');
  }
  const field = issue.code === 'unrecognized_keys' ? issue.keys.join(', ') : issue.path.join('.') || '(row)';
  throw invalid(code, table, field, `is invalid: ${issue.message}`);
}

/** Sets the fields that are `undefined` in `input` from `defaults`, which are computed only when needed. */
function withDefaults(input: unknown, defaults: Record<string, () => string>): unknown {
  const filled: Row = { ...(input as Row | null) };
  for (const [field, make] of Object.entries(defaults)) {
    if (filled[field] === undefined) {
      filled[field] = make();
    }
  }
  return filled;
}

function toNumber(value: number | bigint): number {
  return Number(value);
}

export function createWriters({ db, deps, secrets }: WriterContext): EventLogWriters {
  const now = (): string => deps.toIso(deps.now());

  /** Every string in the row, and in a JSON column's value, is redacted before it reaches SQL. */
  const redactRow = <T extends Row>(row: T): T => redactValue(row, secrets) as T;

  /** JSON text of `value` after redaction. Normalises through JSON first, so toJSON and Date behave. */
  const redactedJson = (value: unknown, code: string, table: string, field: string): string => {
    let json: string | undefined;
    try {
      json = JSON.stringify(value);
    } catch {
      json = undefined;
    }
    if (json === undefined) {
      throw invalid(code, table, field, 'is not JSON-serialisable');
    }
    return JSON.stringify(redactValue(JSON.parse(json), secrets));
  };

  /** Maps a constraint failure to a FactoryError; anything else is rethrown. */
  const mapWriteError = (error: unknown, code: string, table: string, parentField: string): never => {
    const message = error instanceof Error ? error.message : '';
    if (/FOREIGN KEY constraint failed/.test(message)) {
      throw invalid(code, table, parentField, 'refers to a row that does not exist');
    }
    throw error;
  };

  const activeRunConflict = (repo: string, ticket: string, ownRunId: string): FactoryError | undefined => {
    const existing = db
      .prepare(
        `SELECT run_id, status FROM runs
         WHERE repo = ? AND ticket = ? AND run_id != ? AND status NOT IN (${NON_RESUMABLE_SQL})`,
      )
      .get(repo, ticket, ownRunId);
    if (existing === undefined) {
      return undefined;
    }
    return new FactoryError({
      code: 'run_already_active',
      message: `Ticket ${ticket} in ${repo} already has an active run: ${String(existing.run_id)} (status ${String(existing.status)}).`,
      where: `runs (${repo}, ${ticket})`,
      next: `Run \`factory status\` to see it, or \`factory resume ${ticket}\` to continue it.`,
      nextCommand: 'factory status',
      exitCode: 2,
    });
  };

  /** The run_already_active error when `error` is the one-active-run index refusing a write; else `error`. */
  const activeRunConflictOr = (error: unknown, repo: string, ticket: string, ownRunId: string): unknown => {
    const message = error instanceof Error ? error.message : '';
    return /UNIQUE constraint failed: runs\.repo/.test(message)
      ? (activeRunConflict(repo, ticket, ownRunId) ?? error)
      : error;
  };

  const insertRow = (sql: string, params: SQLInputValue[]): number =>
    toNumber(db.prepare(sql).run(...params).lastInsertRowid);

  return {
    insertRun(input) {
      const row = redactRow(
        parseRow(
          runSchema,
          withDefaults(input, { run_id: () => deps.newId('run'), started_at: now }),
          'runs',
          'row_invalid',
        ),
      );
      try {
        db.prepare(
          `INSERT INTO runs (run_id, repo, ticket, flow, tier, status, base_commit, config_hash,
                             factory_version, started_at, ended_at, cap_usd_effective)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          row.run_id,
          row.repo,
          row.ticket,
          row.flow,
          row.tier ?? null,
          row.status,
          row.base_commit,
          row.config_hash,
          row.factory_version,
          row.started_at,
          row.ended_at ?? null,
          row.cap_usd_effective ?? null,
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        if (/UNIQUE constraint failed: runs\.run_id/.test(message)) {
          throw invalid('row_invalid', 'runs', 'run_id', `${row.run_id} already exists`);
        }
        throw activeRunConflictOr(error, row.repo, row.ticket, row.run_id);
      }
      return { run_id: row.run_id };
    },

    updateRunStatus(run_id, status, ended_at) {
      const row = redactRow(
        parseRow(
          runSchema.pick({ run_id: true, status: true, ended_at: true }),
          { run_id, status, ended_at },
          'runs',
          'row_invalid',
        ),
      );
      const target = db.prepare('SELECT repo, ticket FROM runs WHERE run_id = ?').get(row.run_id);
      if (target === undefined) {
        throw invalid('row_invalid', 'runs', 'run_id', `${row.run_id} does not exist`);
      }
      try {
        db.prepare('UPDATE runs SET status = ?, ended_at = COALESCE(?, ended_at) WHERE run_id = ?').run(
          row.status,
          row.ended_at ?? null,
          row.run_id,
        );
      } catch (error) {
        throw activeRunConflictOr(error, String(target.repo), String(target.ticket), row.run_id);
      }
    },

    updateRunBaseCommit(run_id, base_commit) {
      const row = redactRow(parseRow(runSchema.pick({ run_id: true, base_commit: true }), { run_id, base_commit }, 'runs', 'row_invalid'));
      const result = db.prepare('UPDATE runs SET base_commit = ? WHERE run_id = ?').run(row.base_commit, row.run_id);
      if (toNumber(result.changes) === 0) {
        throw invalid('row_invalid', 'runs', 'run_id', `${row.run_id} does not exist`);
      }
    },

    updateRunCap(run_id, cap_usd_effective) {
      const row = parseRow(runSchema.pick({ run_id: true, cap_usd_effective: true }), { run_id, cap_usd_effective }, 'runs', 'row_invalid');
      const result = db.prepare('UPDATE runs SET cap_usd_effective = ? WHERE run_id = ?').run(row.cap_usd_effective ?? null, row.run_id);
      if (toNumber(result.changes) === 0) {
        throw invalid('row_invalid', 'runs', 'run_id', `${row.run_id} does not exist`);
      }
    },

    upsertStep(input) {
      const row = redactRow(parseRow(stepSchema, input, 'steps', 'row_invalid'));
      try {
        db.prepare(
          `INSERT INTO steps (run_id, step, attempt, role, model, purpose, status, exit_reason, input_hash, cli_session_id, started_at, ended_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT (run_id, step, attempt) DO UPDATE SET
             role = COALESCE(excluded.role, role),
             model = COALESCE(excluded.model, model),
             purpose = COALESCE(excluded.purpose, purpose),
             status = excluded.status,
             exit_reason = COALESCE(excluded.exit_reason, exit_reason),
             input_hash = COALESCE(excluded.input_hash, input_hash),
             cli_session_id = COALESCE(excluded.cli_session_id, cli_session_id),
             started_at = COALESCE(excluded.started_at, started_at),
             ended_at = COALESCE(excluded.ended_at, ended_at)`,
        ).run(
          row.run_id,
          row.step,
          row.attempt,
          row.role ?? null,
          row.model ?? null,
          row.purpose ?? null,
          row.status,
          row.exit_reason ?? null,
          row.input_hash ?? null,
          row.cli_session_id ?? null,
          row.started_at ?? null,
          row.ended_at ?? null,
        );
      } catch (error) {
        mapWriteError(error, 'row_invalid', 'steps', 'run_id');
      }
    },

    appendEvent(input) {
      const { payload, ...columns } = parseRow(
        eventSchema,
        withDefaults(input, { started_at: now }),
        'events',
        'event_invalid',
      );
      const row = redactRow(columns);
      const payloadJson =
        payload === undefined ? null : redactedJson(payload, 'event_invalid', 'events', 'payload');
      try {
        return {
          id: insertRow(
            `INSERT INTO events (
               run_id, step, attempt, type, role, model, purpose, started_at, ended_at, status,
               input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
               cost_usd, usage_source, context_used, context_window, payload_json
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              row.run_id,
              row.step ?? null,
              row.attempt ?? null,
              row.type,
              row.role ?? null,
              row.model ?? null,
              row.purpose ?? null,
              row.started_at,
              row.ended_at ?? null,
              row.status ?? null,
              row.input_tokens ?? null,
              row.output_tokens ?? null,
              row.cache_read_tokens ?? null,
              row.cache_write_tokens ?? null,
              row.reasoning_tokens ?? null,
              row.cost_usd ?? null,
              row.usage_source ?? null,
              row.context_used ?? null,
              row.context_window ?? null,
              payloadJson,
            ],
          ),
        };
      } catch (error) {
        return mapWriteError(error, 'event_invalid', 'events', 'run_id');
      }
    },

    appendCheckRows(event_id, rows) {
      const parsed = rows.map((input) =>
        redactRow(parseRow(checkRowSchema, { ...input, event_id }, 'check_rows', 'row_invalid')),
      );
      try {
        inTransaction(db, () => {
          for (const row of parsed) {
            db.prepare(
              'INSERT INTO check_rows (event_id, gate, item, ok, note) VALUES (?, ?, ?, ?, ?)',
            ).run(row.event_id, row.gate, row.item, row.ok ? 1 : 0, row.note ?? null);
          }
        });
      } catch (error) {
        mapWriteError(error, 'row_invalid', 'check_rows', 'event_id');
      }
    },

    appendProcess(input) {
      const row = redactRow(
        parseRow(processSchema, withDefaults(input, { started_at: now }), 'processes', 'row_invalid'),
      );
      try {
        return {
          id: insertRow('INSERT INTO processes (run_id, step, pid, command, started_at) VALUES (?, ?, ?, ?, ?)', [
            row.run_id,
            row.step,
            row.pid,
            row.command,
            row.started_at,
          ]),
        };
      } catch (error) {
        return mapWriteError(error, 'row_invalid', 'processes', 'run_id');
      }
    },

    endProcess(id) {
      const result = db.prepare('UPDATE processes SET ended_at = ? WHERE id = ? AND ended_at IS NULL').run(now(), id);
      if (toNumber(result.changes) === 0 && db.prepare('SELECT 1 FROM processes WHERE id = ?').get(id) === undefined) {
        throw invalid('row_invalid', 'processes', 'id', `${id} does not exist`);
      }
    },

    appendApproval(input) {
      const row = redactRow(
        parseRow(
          approvalSchema,
          withDefaults(input, { hash_algo: () => 'sha256', approved_at: now }),
          'approvals',
          'row_invalid',
        ),
      );
      try {
        return {
          id: insertRow(
            `INSERT INTO approvals (run_id, plan_hash, hash_algo, approver, client, approved_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [row.run_id, row.plan_hash, row.hash_algo, row.approver, row.client, row.approved_at],
          ),
        };
      } catch (error) {
        return mapWriteError(error, 'row_invalid', 'approvals', 'run_id');
      }
    },

    appendShadowVerdict(input) {
      const { rows, ...columns } = parseRow(
        shadowVerdictSchema,
        withDefaults(input, { created_at: now }),
        'shadow_verdicts',
        'row_invalid',
      );
      const row = redactRow(columns);
      const rowsJson = redactedJson(rows, 'row_invalid', 'shadow_verdicts', 'rows');
      try {
        return {
          id: insertRow(
            `INSERT INTO shadow_verdicts (run_id, plan_hash, would_approve, rows_json, created_at)
             VALUES (?, ?, ?, ?, ?)`,
            [row.run_id, row.plan_hash, row.would_approve ? 1 : 0, rowsJson, row.created_at],
          ),
        };
      } catch (error) {
        return mapWriteError(error, 'row_invalid', 'shadow_verdicts', 'run_id');
      }
    },

    appendOutcome(input) {
      const row = redactRow(
        parseRow(outcomeSchema, withDefaults(input, { recorded_at: now }), 'outcomes', 'row_invalid'),
      );
      try {
        return {
          id: insertRow(
            'INSERT INTO outcomes (run_id, outcome, reason, note, recorded_at) VALUES (?, ?, ?, ?, ?)',
            [row.run_id, row.outcome, row.reason ?? null, row.note ?? null, row.recorded_at],
          ),
        };
      } catch (error) {
        return mapWriteError(error, 'row_invalid', 'outcomes', 'run_id');
      }
    },
  };
}
