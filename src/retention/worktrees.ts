import { existsSync, readFileSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import type { EventLogReadOnly } from '../event-log/open.js';
import { readPayload, type EventPayload } from '../event-log/payloads.js';
import { FactoryError } from '../platform/errors.js';
import { resolveComparablePath } from '../platform/path-helpers.js';
import { resolveFactoryPaths } from '../platform/paths.js';
import { removeWorktree } from '../worktree/remove.js';
import { runGit } from '../worktree/git.js';
import { realPathInside } from './confine.js';
import type { ApplyRetentionOptions, RetentionResult, RetentionSkip } from './clean.js';

/** A worktree goes more than this long after the merge or the abandon (ADR-014). */
const WORKTREE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

/** The run fields retention reads. */
export interface RetentionRun {
  run_id: string;
  repo: string;
  ticket: string;
  ended_at: string | null;
}

type Outcome = Pick<RetentionResult, 'worktrees_removed' | 'worktrees_skipped'>;

const none = (): Outcome => ({ worktrees_removed: [], worktrees_skipped: [] });

/** True when `time` (ISO-8601) is strictly more than `limitMs` before `now`. Unparseable text is never old. */
export const isOlderThan = (time: string, now: number, limitMs: number): boolean => now - Date.parse(time) > limitMs;

/** True when `recorded` (from an event payload) names the same folder as `path`, links followed. */
const samePath = (recorded: string, path: string): boolean =>
  resolveComparablePath(recorded) === resolveComparablePath(path);

/** The path of the run's worktree, when it has one that was not removed since. */
function recordedWorktree(reader: EventLogReadOnly, runId: string): string | undefined {
  const latest = <T extends 'worktree_created' | 'worktree_removed'>(
    type: T,
  ): { id: number; payload: EventPayload<T> } | undefined => {
    const row = reader.query('SELECT id, payload_json FROM events WHERE run_id = ? AND type = ? ORDER BY id DESC LIMIT 1', runId, type)[0];
    if (row === undefined || typeof row.payload_json !== 'string') return undefined;
    return { id: Number(row.id), payload: readPayload(row, type) };
  };
  const created = latest('worktree_created');
  const removed = latest('worktree_removed');
  if (created === undefined) return undefined;
  const path = created.payload.path;
  return removed !== undefined && removed.id > created.id && samePath(removed.payload.path, path) ? undefined : path;
}

/** `recorded_at` of the run's latest outcome when it is `abandoned`; else undefined. Only the latest outcome counts. */
function abandonedAt(reader: EventLogReadOnly, runId: string): string | undefined {
  const row = reader.query('SELECT outcome, recorded_at FROM outcomes WHERE run_id = ? ORDER BY id DESC LIMIT 1', runId)[0];
  return row?.outcome === 'abandoned' ? String(row.recorded_at) : undefined;
}

/** The number of the run's latest `draft_pr` event, when it has a valid one. */
function pullRequestNumber(reader: EventLogReadOnly, runId: string): number | undefined {
  const row = reader.query("SELECT payload_json FROM events WHERE run_id = ? AND type = 'draft_pr' ORDER BY id DESC LIMIT 1", runId)[0];
  if (typeof row?.payload_json !== 'string') return undefined;
  return readPayload(row, 'draft_pr').number;
}

type Verdict = { due: true } | { due: false; skip?: { reason: string; next: string } };

/**
 * Whether the run's worktree is past its limit: the latest outcome is `abandoned` more than 7 days ago, or the
 * pull request merged more than 7 days ago. Only db and code-host timestamps count; no file time is read.
 */
async function worktreeDue(options: ApplyRetentionOptions, run: RetentionRun): Promise<Verdict> {
  const { reader, deps, codeHost } = options;
  const now = deps.now();
  const abandoned = abandonedAt(reader, run.run_id);
  if (abandoned !== undefined && isOlderThan(abandoned, now, WORKTREE_AGE_MS)) return { due: true };

  const number = pullRequestNumber(reader, run.run_id);
  if (number === undefined) return { due: false };
  try {
    const { mergedAt } = await codeHost.fetchPullRequest(run.repo, number);
    return typeof mergedAt === 'string' && isOlderThan(mergedAt, now, WORKTREE_AGE_MS) ? { due: true } : { due: false };
  } catch (error) {
    return {
      due: false,
      skip: {
        reason: `The merge time of pull request #${number} could not be read: ${error instanceof Error ? error.message : String(error)}`,
        next: 'Check access to the code host, then run `factory clean` again. The worktree was left in place.',
      },
    };
  }
}

/** The work-repo checkout a worktree was made from, or a reason it cannot be found. */
function checkoutOf(env: NodeJS.ProcessEnv, path: string): { repoPath: string } | { missing: string } {
  const dotGit = join(path, '.git');
  if (statSync(dotGit).isDirectory()) {
    // A standalone clone: its origin is the work repo. `removeWorktree` checks that before it deletes anything.
    const origin = runGit(env, path, ['config', '--get', 'remote.origin.url']);
    return origin.ok && origin.stdout !== '' ? { repoPath: origin.stdout } : { missing: `${path} has no origin to tell which work repo it came from.` };
  }
  // A linked worktree: `.git` holds `gitdir: <checkout>/.git/worktrees/<name>`.
  const gitdir = /^gitdir:\s*(.+)$/m.exec(readFileSync(dotGit, 'utf8'))?.[1]?.trim();
  if (gitdir === undefined || basename(dirname(gitdir)) !== 'worktrees') return { missing: `${dotGit} does not point at a work-repo checkout.` };
  const repoPath = dirname(dirname(dirname(gitdir)));
  return existsSync(join(repoPath, '.git')) ? { repoPath } : { missing: `The work-repo checkout ${repoPath} is not there.` };
}

/**
 * Removes the run's worktree when it is past its limit, through `removeWorktree`. Never deletes by hand: a
 * worktree that cannot be removed that way is reported as skipped, with what to do next.
 */
export async function retainWorktree(options: ApplyRetentionOptions, run: RetentionRun): Promise<Outcome> {
  const { env, deps, log, reader } = options;
  const path = recordedWorktree(reader, run.run_id);
  if (path === undefined || !existsSync(join(path, '.git'))) return none();

  const skip = (reason: string, next: string): Outcome => ({
    worktrees_removed: [],
    worktrees_skipped: [{ run_id: run.run_id, path, reason, next } satisfies RetentionSkip],
  });

  const verdict = await worktreeDue(options, run);
  if (!verdict.due) return verdict.skip === undefined ? none() : skip(verdict.skip.reason, verdict.skip.next);

  // Only folders the factory made under the cache worktrees root are ever removed.
  // The check follows every symlink, ancestors included, and the real path is what gets removed.
  const realPath = realPathInside(resolveFactoryPaths(env).worktreesRoot, path);
  if (realPath === undefined) {
    return skip(`${path} is outside the factory worktrees folder.`, 'Remove it by hand if it is yours, or leave it.');
  }

  const checkout = checkoutOf(env, realPath);
  if ('missing' in checkout) {
    return skip(checkout.missing, 'Restore the work-repo checkout, or run `git worktree prune` there, then run `factory clean` again.');
  }
  try {
    removeWorktree({ env, deps, log, runId: run.run_id, repoPath: checkout.repoPath, path: realPath });
  } catch (error) {
    if (!(error instanceof FactoryError)) throw error;
    return skip(error.message, error.next);
  }
  return { worktrees_removed: [{ run_id: run.run_id, path }], worktrees_skipped: [] };
}
