import { existsSync } from 'node:fs';
import { basename } from 'node:path';

import { loadConfig } from '../config/load.js';
import { FactoryError } from '../platform/errors.js';
import { runGit } from '../worktree/git.js';
import { EXIT_CODES } from './exit-codes.js';

export const refuse = (code: string, message: string, where: string, next: string): FactoryError =>
  new FactoryError({ code, message, where, next, exitCode: EXIT_CODES.refused });

/** The top folder of the git checkout that contains `cwd`. Refuses a folder that is not in a git checkout. */
export function checkoutRoot(env: NodeJS.ProcessEnv, cwd: string, command: string): string {
  const top = existsSync(cwd) ? runGit(env, cwd, ['rev-parse', '--show-toplevel']) : undefined;
  if (!top?.ok || top.stdout === '') {
    throw refuse(
      'checkout_invalid',
      `${cwd} is not inside a git checkout, so factory cannot tell which repo to ${command} a run in.`,
      cwd,
      `Run \`factory ${command} <ticket>\` from inside the work-repo checkout the run was started from.`,
    );
  }
  return top.stdout;
}

/** The repo name of a checkout: the basename of the repo config file that matches it (the `runs.repo` value). */
export const repoNameOf = (env: NodeJS.ProcessEnv, checkout: string): string =>
  basename(loadConfig({ env, repoPath: checkout }).files.repo, '.yaml');
