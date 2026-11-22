import type { EventLog, EventLogReadOnly } from '../event-log/open.js';
import type { RUN_STATUSES } from '../event-log/schema.js';
import type { Deps } from '../platform/deps.js';
import { FactoryError } from '../platform/errors.js';

export type RunStatus = (typeof RUN_STATUSES)[number];

/** What every run-state function needs: the factory paths, the clock, and both event log handles. */
export interface RunStateContext {
  env: NodeJS.ProcessEnv;
  deps: Deps;
  log: EventLog;
  reader: EventLogReadOnly;
}

export interface RunRow {
  status: RunStatus;
  repo: string;
  ticket: string;
}

/** The current clock time as ISO text. */
export function isoNow({ deps }: Pick<RunStateContext, 'deps'>): string {
  return deps.toIso(deps.now());
}

/** The status, repo and ticket of a run. A missing run is `run_not_found`. */
export function readRun({ reader }: Pick<RunStateContext, 'reader'>, runId: string): RunRow {
  const row = reader.query('SELECT status, repo, ticket FROM runs WHERE run_id = ?', runId)[0];
  if (row === undefined) {
    throw new FactoryError({
      code: 'run_not_found',
      message: `There is no run ${runId} in the event log.`,
      where: runId,
      next: 'Pass the run_id of a run that was recorded in the event log.',
      exitCode: 2,
    });
  }
  return { status: row.status as RunStatus, repo: String(row.repo), ticket: String(row.ticket) };
}
