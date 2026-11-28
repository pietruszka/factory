import { join } from 'node:path';

import { refused, type FactoryError } from '../platform/errors.js';
import { resolveFactoryPaths } from '../platform/paths.js';

const SLUG = /^[A-Za-z0-9._-]+$/;

/** Every refusal of this module: wrong use, exit code 2. */
export function runFolderInvalid(message: string, where: string, next: string): FactoryError {
  return refused({ code: 'run_folder_invalid', message, where, next });
}

/** Whether `value` is a single slug segment: letters, digits, ".", "_" or "-", and not "." or "..". */
export function isSlug(value: string): boolean {
  return SLUG.test(value) && value !== '.' && value !== '..';
}

/**
 * Refuses a value that is not a single slug segment: empty, with a slash, a leading `~`, a space,
 * or `.` / `..`. `kind` names the field in the message, for example `repo`, `ticket` or `step`.
 */
export function assertSlug(kind: string, value: string): void {
  if (!isSlug(value)) {
    throw runFolderInvalid(
      `The ${kind} "${value}" is not a valid name. Use letters, digits, ".", "_" or "-" only, and not "." or "..".`,
      kind,
      'Pass a slug, not a path: for example example-frontend as the repo, FE-123 as the ticket and builder as the step.',
    );
  }
}

/** Pure: `<runsRoot>/<repo>/<ticket>`. Reads env only; creates nothing. */
export function runFolderPath(env: NodeJS.ProcessEnv, repo: string, ticket: string): string {
  assertSlug('repo', repo);
  assertSlug('ticket', ticket);
  return join(resolveFactoryPaths(env).runsRoot, repo, ticket);
}
