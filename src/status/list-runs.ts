import { z } from 'zod';

import type { EventLogReadOnly } from '../event-log/open.js';
import type { Deps } from '../platform/deps.js';
import type { ProcessTable } from '../ports/process-table.js';
import { PHASES } from '../run-state/transition.js';

/** One run as `factory status` shows it. */
export interface StatusRow {
  run_id: string;
  ticket: string;
  repo: string;
  flow: string;
  status: string;
  current_step: string | null;
  cost_usd?: number;
  cost_source?: 'reported' | 'estimated';
  last_event_at: string;
  elapsed_ms: number;
  stale: boolean;
}

const StatusRowSchema = z.strictObject({
  run_id: z.string().min(1),
  ticket: z.string().min(1),
  repo: z.string().min(1),
  flow: z.string().min(1),
  status: z.string().min(1),
  current_step: z.string().min(1).nullable(),
  cost_usd: z.number().finite().optional(),
  cost_source: z.enum(['reported', 'estimated']).optional(),
  last_event_at: z.iso.datetime({ offset: true }),
  elapsed_ms: z.number().finite(),
  stale: z.boolean(),
});

/** The `data` of `factory status --json`. */
export const StatusDocumentSchema = z.strictObject({
  schema_version: z.literal(1),
  rows: z.array(StatusRowSchema),
});

/** How many finished runs are listed besides the active ones. */
export const RECENT_RUNS = 10;

export interface ListRunsOptions {
  reader: EventLogReadOnly;
  deps: Deps;
  processTable: ProcessTable;
  /** Only the runs of this ticket (any repo). Absent means every run. */
  ticket?: string;
}

type Row = Record<string, unknown>;

const sqlList = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(', ');
const PHASES_SQL = sqlList(PHASES);

const groupBy = (rows: readonly Row[]): Map<string, Row[]> => {
  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const key = String(row.run_id);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return groups;
};

/**
 * The step whose latest attempt is not done (the first one, in the order the steps were first
 * recorded), else the last step whose latest attempt is done, else null. Same rule as `isStepDone`.
 */
function currentStep(stepRows: readonly Row[]): string | null {
  const latest = new Map<string, { attempt: number; status: string }>();
  for (const row of stepRows) {
    const step = String(row.step);
    const attempt = Number(row.attempt);
    const seen = latest.get(step);
    if (seen === undefined || attempt > seen.attempt) latest.set(step, { attempt, status: String(row.status) });
  }
  const steps = [...latest];
  return (steps.find(([, { status }]) => status !== 'done') ?? steps.at(-1))?.[0] ?? null;
}

/** The summed cost of a run's events, or nothing when no event carries one. Anything not reported counts as estimated. */
function cost(row: Row | undefined): Pick<StatusRow, 'cost_usd' | 'cost_source'> {
  if (row === undefined || Number(row.n) === 0) return {};
  return { cost_usd: Number(row.usd), cost_source: Number(row.reported) === Number(row.n) ? 'reported' : 'estimated' };
}

/** True when some un-ended process row of the run still runs the command it was recorded with. */
async function hasLiveProcess(processTable: ProcessTable, rows: readonly Row[]): Promise<boolean> {
  for (const row of rows) {
    if (await processTable.stillMatches(Number(row.pid), String(row.command))) return true;
  }
  return false;
}

/**
 * Active runs (stored status is a phase) first, newest last event first, then the 10 most recent
 * finished runs. Reads only: a run whose process is gone is marked `stale` in the result, and its
 * stored status is left alone. With `ticket`, only that ticket's runs, in every repo.
 */
export async function listRuns(options: ListRunsOptions): Promise<StatusRow[]> {
  const { reader, deps, processTable, ticket } = options;
  const runs = reader.query(
    `SELECT r.run_id, r.ticket, r.repo, r.flow, r.status,
            COALESCE((SELECT MAX(e.started_at) FROM events e WHERE e.run_id = r.run_id), r.started_at) AS last_event_at
       FROM runs r
      WHERE (? IS NULL OR r.ticket = ?)
      ORDER BY (r.status IN (${PHASES_SQL})) DESC, last_event_at DESC, r.started_at DESC, r.rowid DESC`,
    ticket ?? null,
    ticket ?? null,
  );
  const active = runs.filter((run) => PHASES.includes(run.status as (typeof PHASES)[number]));
  const finished = runs.filter((run) => !active.includes(run)).slice(0, RECENT_RUNS);
  const shown = [...active, ...finished];

  const costs = new Map(
    reader
      .query(
        `SELECT run_id, SUM(cost_usd) AS usd, COUNT(cost_usd) AS n, SUM(usage_source = 'reported') AS reported
           FROM events WHERE cost_usd IS NOT NULL GROUP BY run_id`,
      )
      .map((row) => [String(row.run_id), row]),
  );
  const steps = groupBy(reader.query('SELECT run_id, step, attempt, status FROM steps ORDER BY rowid'));
  const processes = groupBy(
    reader.query(`SELECT run_id, pid, command FROM processes WHERE ended_at IS NULL ORDER BY id`),
  );

  const now = deps.now();
  const rows: StatusRow[] = [];
  for (const run of shown) {
    const runId = String(run.run_id);
    const lastEventAt = String(run.last_event_at);
    const isActive = active.includes(run);
    rows.push({
      run_id: runId,
      ticket: String(run.ticket),
      repo: String(run.repo),
      flow: String(run.flow),
      status: String(run.status),
      current_step: currentStep(steps.get(runId) ?? []),
      ...cost(costs.get(runId)),
      last_event_at: lastEventAt,
      elapsed_ms: now - Date.parse(lastEventAt),
      stale: isActive && !(await hasLiveProcess(processTable, processes.get(runId) ?? [])),
    });
  }
  return rows;
}
