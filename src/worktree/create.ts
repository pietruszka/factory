import { existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

import { loadConfig } from '../config/load.js';
import type { WORKTREE_MODES } from '../config/schema.js';
import type { EventLog, EventLogReadOnly } from '../event-log/open.js';
import type { Deps } from '../platform/deps.js';
import { assertNotProtectedFolder } from '../platform/paths.js';
import { refuse } from './errors.js';
import { runGit } from './git.js';
import { worktreePath } from './path.js';
import { assertCanStart } from './start.js';

export type WorktreeMode = (typeof WORKTREE_MODES)[number];

export interface CreateWorktreeOptions {
  env: NodeJS.ProcessEnv;
  deps: Deps;
  /** Write side of the event log, for the `worktree_created` event. */
  log: EventLog;
  /** Read side of the event log, for the concurrency checks. */
  reader: EventLogReadOnly;
  runId: string;
  repo: string;
  ticket: string;
  /** The work-repo checkout the worktree is made from. It is never changed. */
  repoPath: string;
  baseCommit: string;
  allowedPaths?: readonly string[];
  /** Overrides `worktree.mode` from config. */
  mode?: WorktreeMode;
  /** Overrides the computed path under the cache worktrees root. */
  path?: string;
}

export interface CreatedWorktree {
  path: string;
  mode: WorktreeMode;
  baseCommit: string;
}

const COMMIT_ID = /^[0-9a-f]{4,64}$/i;

function createFailed(detail: string, repoPath: string): Error {
  return refuse(
    'worktree_create_failed',
    `git could not create the worktree: ${detail}`,
    repoPath,
    'Check that the base commit is reachable from a branch or tag of the work repo and that git is installed, then try again.',
  );
}

/** The full id of `baseCommit` in the work repo. Refuses a missing `.git` or an unknown commit. */
function resolveBaseCommit(env: NodeJS.ProcessEnv, repoPath: string, baseCommit: string): string {
  if (!existsSync(join(repoPath, '.git'))) {
    throw refuse(
      'worktree_invalid',
      `${repoPath} is not a git checkout: it has no .git.`,
      repoPath,
      'Pass the path of the work-repo checkout.',
    );
  }
  const resolved = COMMIT_ID.test(baseCommit)
    ? runGit(env, repoPath, ['rev-parse', '--verify', '--quiet', `${baseCommit}^{commit}`])
    : undefined;
  if (!resolved?.ok || resolved.stdout === '') {
    throw refuse(
      'worktree_invalid',
      `The base commit "${baseCommit}" does not exist in ${repoPath}.`,
      'baseCommit',
      'Pass the full id of a commit that exists in the work repo.',
    );
  }
  return resolved.stdout;
}

function chooseMode(options: CreateWorktreeOptions): WorktreeMode {
  if (options.mode !== undefined) {
    return options.mode;
  }
  return loadConfig({ env: options.env, repoPath: options.repoPath }).config.worktree?.mode ?? 'linked';
}

/** Runs the git commands for one mode. The destination must not exist yet. */
function addWorktree(env: NodeJS.ProcessEnv, mode: WorktreeMode, repoPath: string, path: string, commit: string): void {
  mkdirSync(dirname(path), { recursive: true });
  // A detached HEAD in linked mode: a branch would add a ref to the work repo (NFR-2).
  const steps =
    mode === 'linked'
      ? [{ cwd: repoPath, args: ['worktree', 'add', '--quiet', '--detach', path, commit] }]
      : [
          { cwd: dirname(path), args: ['clone', '--quiet', '--no-checkout', repoPath, path] },
          { cwd: path, args: ['checkout', '--quiet', '--detach', commit] },
        ];
  for (const step of steps) {
    const result = runGit(env, step.cwd, step.args);
    if (!result.ok) {
      throw createFailed(result.stderr, repoPath);
    }
  }
}

/** Deletes a half-made destination, and any linked-worktree metadata for it. */
function undo(env: NodeJS.ProcessEnv, repoPath: string, path: string): void {
  rmSync(path, { recursive: true, force: true });
  runGit(env, repoPath, ['worktree', 'prune']);
}

/**
 * Creates the worktree for a run at `<worktreesRoot>/<repo>/<ticket>` from the pinned base commit
 * and records a `worktree_created` event. The work-repo checkout keeps its working tree, index and
 * branches (NFR-2). On any failure nothing is left behind.
 */
export function createWorktree(options: CreateWorktreeOptions): CreatedWorktree {
  const { env, repoPath } = options;

  const computed = worktreePath(env, options.repo, options.ticket);
  const path = options.path ?? computed;
  if (!isAbsolute(path)) {
    throw refuse('worktree_invalid', `The worktree path "${path}" is not absolute.`, 'path', 'Pass an absolute path.');
  }
  assertNotProtectedFolder(path, env);

  const baseCommit = resolveBaseCommit(env, repoPath, options.baseCommit);
  if (existsSync(path)) {
    throw refuse(
      'worktree_invalid',
      `The worktree destination ${path} already exists.`,
      path,
      'Remove it with removeWorktree, or pick another ticket. Existing content is never overwritten.',
    );
  }

  const allowedPaths = [...(options.allowedPaths ?? [])];
  assertCanStart({ reader: options.reader, runId: options.runId, allowedPaths });
  const mode = chooseMode(options);

  try {
    addWorktree(env, mode, repoPath, path, baseCommit);
    options.log.appendEvent({
      run_id: options.runId,
      type: 'worktree_created',
      payload: { path, base_commit: baseCommit, mode, allowed_paths: allowedPaths },
    });
  } catch (error) {
    undo(env, repoPath, path);
    throw error;
  }
  return { path, mode, baseCommit };
}
