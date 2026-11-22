import { NON_RESUMABLE_RUN_STATUSES } from '../event-log/schema.js';
import type { EventLogReadOnly } from '../event-log/open.js';
import { refuse } from './errors.js';
import { allowedPathsOverlap } from './overlap.js';

/** At most this many runs may be active at once (ADR-007). */
export const MAX_ACTIVE_RUNS = 2;

export interface AssertCanStartOptions {
  reader: EventLogReadOnly;
  /** The run that wants to start. It is not counted as one of the active runs. */
  runId?: string;
  /** Globs of the paths the run may write. Missing or empty means everything. */
  allowedPaths?: readonly string[];
}

const NON_ACTIVE_SQL = NON_RESUMABLE_RUN_STATUSES.map((status) => `'${status}'`).join(', ');

interface ActiveRun {
  runId: string;
  /** From the run's latest `worktree_created` event; undefined when it has none or none were set. */
  allowedPaths: string[] | undefined;
}

function activeRuns(reader: EventLogReadOnly, runId: string): ActiveRun[] {
  const rows = reader.query(
    `SELECT r.run_id AS run_id,
            (SELECT e.payload_json FROM events e
              WHERE e.run_id = r.run_id AND e.type = 'worktree_created'
              ORDER BY e.id DESC LIMIT 1) AS payload_json
       FROM runs r
      WHERE r.status NOT IN (${NON_ACTIVE_SQL}) AND r.run_id <> ?
      ORDER BY r.started_at, r.run_id`,
    runId,
  );
  return rows.map((row) => {
    const payload = typeof row.payload_json === 'string' ? (JSON.parse(row.payload_json) as { allowed_paths?: unknown }) : {};
    const allowed = Array.isArray(payload.allowed_paths) ? payload.allowed_paths.map(String) : undefined;
    return { runId: String(row.run_id), allowedPaths: allowed };
  });
}

/**
 * Refuses a third active run as `worktree_busy`, and a second one whose allowed paths may overlap
 * the first as `worktree_overlap`. There is no queue (P-5, NFR-21). Reads the event log only.
 */
export function assertCanStart(options: AssertCanStartOptions): void {
  const active = activeRuns(options.reader, options.runId ?? '');

  if (active.length >= MAX_ACTIVE_RUNS) {
    throw refuse(
      'worktree_busy',
      `${active.length} runs are already active (${active.map((run) => run.runId).join(', ')}). At most ${MAX_ACTIVE_RUNS} may run at once.`,
      'runs',
      'Wait for an active run to finish, or stop one, then start the run again. Runs are not queued.',
    );
  }

  const clash = active.find((run) => allowedPathsOverlap(run.allowedPaths, options.allowedPaths));
  if (clash) {
    throw refuse(
      'worktree_overlap',
      `The allowed paths of this run may overlap those of the active run ${clash.runId}. Two runs may be active at once only when their paths are disjoint.`,
      clash.runId,
      `Narrow the allowed paths so they are disjoint from ${clash.runId}, or wait for it to finish. A run without allowed paths overlaps everything.`,
    );
  }
}
