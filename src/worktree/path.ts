import { join } from 'node:path';

import { resolveFactoryPaths } from '../platform/paths.js';
import { isSlug } from '../run-folder/path.js';
import { refused } from '../platform/errors.js';

function assertWorktreeSlug(kind: string, value: string): void {
  if (!isSlug(value)) {
    throw refused({
      code: 'worktree_invalid',
      message: `The ${kind} "${value}" is not a valid name. Use letters, digits, ".", "_" or "-" only, and not "." or "..".`,
      where: kind,
      next: 'Pass a slug, not a path: for example example-frontend as the repo and FE-123 as the ticket.',
    });
  }
}

/**
 * Pure: `<worktreesRoot>/<repo>/<ticket>` (D-39). Reads env only; creates nothing. Refuses a
 * repo or ticket that is not a slug as `worktree_invalid`, and a path inside Documents, Desktop
 * or Downloads as `protected_folder`.
 */
export function worktreePath(env: NodeJS.ProcessEnv, repo: string, ticket: string): string {
  assertWorktreeSlug('repo', repo);
  assertWorktreeSlug('ticket', ticket);
  return join(resolveFactoryPaths(env).worktreesRoot, repo, ticket);
}
