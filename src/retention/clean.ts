import type { EventLog, EventLogReadOnly } from '../event-log/open.js';
import type { Deps } from '../platform/deps.js';
import type { CodeHost } from '../ports/code-host.js';
import { retainArtifacts } from './artifacts.js';
import { retainWorktree, type RetentionRun } from './worktrees.js';

export interface ApplyRetentionOptions {
  env: NodeJS.ProcessEnv;
  deps: Deps;
  /** Write side of the event log, for retention and `worktree_removed` events only. */
  log: EventLog;
  reader: EventLogReadOnly;
  codeHost: CodeHost;
}

interface RetentionWorktree {
  run_id: string;
  path: string;
}

export interface RetentionSkip extends RetentionWorktree {
  reason: string;
  /** What the person can do about it. */
  next: string;
}

export interface RetentionArtifacts {
  run_id: string;
  /** Paths removed from the run folder. */
  paths: string[];
}

export interface RetentionResult {
  worktrees_removed: RetentionWorktree[];
  worktrees_skipped: RetentionSkip[];
  artifacts_deleted: RetentionArtifacts[];
}

/**
 * Applies the retention policy to every run in the event log: worktrees more than 7 days after a merge or an
 * abandon (ADR-014), and ticket.json, prompts and evidence more than 30 days after the run ended. Ages come
 * from `deps.now()` against db and code-host timestamps only. Event rows are never deleted.
 *
 * Each run is judged on its own `ended_at`, latest outcome and latest `draft_pr`. Runs of one ticket can share
 * a worktree path and a run folder: whatever an earlier run already removed is simply gone for the next one.
 */
export async function applyRetention(options: ApplyRetentionOptions): Promise<RetentionResult> {
  const runs = options.reader
    .query('SELECT run_id, repo, ticket, ended_at FROM runs ORDER BY started_at, rowid')
    .map((row): RetentionRun => ({
      run_id: String(row.run_id),
      repo: String(row.repo),
      ticket: String(row.ticket),
      ended_at:
        typeof row.ended_at === 'string'
          ? row.ended_at
          : typeof row.ended_at === 'number'
            ? String(row.ended_at)
            : null,
    }));

  const result: RetentionResult = { worktrees_removed: [], worktrees_skipped: [], artifacts_deleted: [] };
  for (const run of runs) {
    const worktree = await retainWorktree(options, run);
    result.worktrees_removed.push(...worktree.worktrees_removed);
    result.worktrees_skipped.push(...worktree.worktrees_skipped);
    const artifacts = retainArtifacts(options, run);
    if (artifacts !== undefined) result.artifacts_deleted.push(artifacts);
  }
  return result;
}
