import type { EventLogReadOnly } from '../event-log/open.js';
import { NON_RESUMABLE_RUN_STATUSES } from '../event-log/schema.js';
import type { RunStatus } from './context.js';

export interface FoundRun {
  runId: string;
  status: RunStatus;
  flow: string;
}

const FINALS_SQL = NON_RESUMABLE_RUN_STATUSES.map((status) => `'${status}'`).join(', ');

const toFound = (row: Record<string, unknown> | undefined): FoundRun | undefined =>
  row === undefined ? undefined : { runId: String(row.run_id), status: row.status as RunStatus, flow: String(row.flow) };

/** The unique run of `repo` and `ticket` that is not final. An already `killed` run counts. */
export function findOpenRun(reader: EventLogReadOnly, repo: string, ticket: string): FoundRun | undefined {
  return toFound(
    reader.query(
      `SELECT run_id, status, flow FROM runs WHERE repo = ? AND ticket = ? AND status NOT IN (${FINALS_SQL}) ORDER BY started_at DESC LIMIT 1`,
      repo,
      ticket,
    )[0],
  );
}

/** The open run of `repo` and `ticket`, or else the most recent final one, so a refusal can name its status. */
export function findLatestRun(reader: EventLogReadOnly, repo: string, ticket: string): FoundRun | undefined {
  return toFound(
    reader.query(
      `SELECT run_id, status, flow FROM runs WHERE repo = ? AND ticket = ?
       ORDER BY (status IN (${FINALS_SQL})) ASC, started_at DESC LIMIT 1`,
      repo,
      ticket,
    )[0],
  );
}
