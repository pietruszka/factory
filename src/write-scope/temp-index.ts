import { mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { FactoryError } from '../platform/errors.js';
import { runGit } from '../worktree/git.js';

/** A git failure of this module. The worktree or the temp folder is in a state the factory cannot handle. */
function gitFailure(what: string, cwd: string, stderr: string): FactoryError {
  return new FactoryError({
    code: 'write_scope_git_failed',
    message: `Git could not ${what}: ${stderr || 'no error text'}`,
    where: cwd,
    next: 'Check that the worktree is a healthy git worktree and that the temp folder is writable, then run the step again.',
    exitCode: 4,
  });
}

/** The stdout of a git command. A git failure throws `write_scope_git_failed`. */
export function git(env: NodeJS.ProcessEnv, cwd: string, what: string, args: readonly string[], index?: string): string {
  const result = runGit(env, cwd, args, {
    profile: 'user',
    extraEnv: index === undefined ? undefined : { GIT_INDEX_FILE: index },
  });
  if (!result.ok) {
    throw gitFailure(what, cwd, result.stderr);
  }
  return result.stdout;
}

/**
 * Runs `body` with the path of a temporary git index file inside `tempDir`. The file and its private
 * folder are removed afterwards, also when `body` throws. The worktree's real index is never touched.
 */
export function withTempIndex<T>(tempDir: string, body: (index: string) => T): T {
  const folder = mkdtempSync(join(resolve(tempDir), 'index-'));
  try {
    return body(join(folder, 'index'));
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
