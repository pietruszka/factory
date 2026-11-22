import { existsSync, rmSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import type { EventLog } from '../event-log/open.js';
import type { Deps } from '../platform/deps.js';
import { assertNotProtectedFolder } from '../platform/paths.js';
import { isWithinOrSamePath, resolveComparablePath } from '../platform/path-helpers.js';
import type { WorktreeMode } from './create.js';
import { refuse } from './errors.js';
import { runGit } from './git.js';

export interface RemoveWorktreeOptions {
  env: NodeJS.ProcessEnv;
  deps: Deps;
  log: EventLog;
  runId: string;
  /** The work-repo checkout the worktree was made from. It is never changed. */
  repoPath: string;
  /** The worktree root to delete. */
  path: string;
}

function removeFailed(detail: string, path: string): Error {
  return refuse(
    'worktree_remove_failed',
    `The worktree could not be removed: ${detail}`,
    path,
    'Check that the path is a worktree or clone made by the factory for this work repo, then try again.',
  );
}

/** A linked worktree has a `.git` file that points at the work repo; a standalone clone has a `.git` folder. */
function modeOnDisk(path: string): WorktreeMode {
  return statSync(join(path, '.git')).isFile() ? 'linked' : 'standalone';
}

/** Standalone only: deletes the clone, after checking it is a clone of this work repo and not the repo itself. */
function removeClone(env: NodeJS.ProcessEnv, repoPath: string, path: string): void {
  const origin = runGit(env, path, ['config', '--get', 'remote.origin.url']);
  const isCloneOfRepo = origin.ok && resolveComparablePath(origin.stdout) === resolveComparablePath(repoPath);
  const comparable = resolveComparablePath(path);
  if (!isCloneOfRepo || isWithinOrSamePath(comparable, resolveComparablePath(repoPath))) {
    throw removeFailed(`${path} is not a clone of ${repoPath}.`, path);
  }
  rmSync(path, { recursive: true, force: true });
}

/**
 * Deletes the worktree and records a `worktree_removed` event. Linked worktrees are removed through
 * git, so the work repo keeps no metadata for them (NFR-2). Refuses anything that is not a worktree
 * or clone of `repoPath`.
 */
export function removeWorktree(options: RemoveWorktreeOptions): void {
  const { env, repoPath, path } = options;

  if (!isAbsolute(path) || !existsSync(join(path, '.git'))) {
    throw refuse(
      'worktree_invalid',
      `${path} is not an existing worktree.`,
      path,
      'Pass the absolute path returned by createWorktree.',
    );
  }
  assertNotProtectedFolder(path, env);

  const mode = modeOnDisk(path);
  if (mode === 'linked') {
    const result = runGit(env, repoPath, ['worktree', 'remove', '--force', path]);
    if (!result.ok) {
      throw removeFailed(result.stderr, path);
    }
  } else {
    removeClone(env, repoPath, path);
  }

  options.log.appendEvent({
    run_id: options.runId,
    type: 'worktree_removed',
    payload: { path, mode },
  });
}
