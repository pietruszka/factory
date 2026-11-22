import { statSync } from 'node:fs';

import { loadConfig } from '../config/load.js';
import type { EventLog, EventLogReadOnly } from '../event-log/open.js';
import type { Deps } from '../platform/deps.js';
import { refuse } from './errors.js';

export interface CommandResult {
  exitCode: number;
}

/** Runs one shell command line with the given working directory. Injected so tests never run a real install. */
export type CommandRunner = (command: string, options: { cwd: string }) => Promise<CommandResult>;

export interface InstallWorktreeOptions {
  env: NodeJS.ProcessEnv;
  deps: Deps;
  log: EventLog;
  reader: EventLogReadOnly;
  runId: string;
  /** The work-repo checkout, used to find the repo's config and its `install` command. */
  repoPath: string;
  /** The worktree root; the install command runs here. */
  path: string;
  run: CommandRunner;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function alreadyInstalled(reader: EventLogReadOnly, runId: string, path: string): boolean {
  return (
    reader.query(
      `SELECT 1 FROM events
        WHERE run_id = ? AND type = 'worktree_install' AND status = 'ok'
          AND json_extract(payload_json, '$.path') = ?
        LIMIT 1`,
      runId,
      path,
    ).length > 0
  );
}

/**
 * Runs the repo's configured `install` command once, with cwd at the worktree root, and records a
 * `worktree_install` event with `started_at` and `ended_at` from `deps` (NFR-46), so the time can
 * count toward the run's wall-clock cap. A second install after a successful one is refused as
 * `worktree_already_installed`; a failed install may be retried.
 */
export async function installWorktree(options: InstallWorktreeOptions): Promise<void> {
  const { deps, path, runId } = options;

  if (!isDirectory(path)) {
    throw refuse('worktree_invalid', `${path} is not an existing worktree.`, path, 'Create the worktree first.');
  }
  if (alreadyInstalled(options.reader, runId, path)) {
    throw refuse(
      'worktree_already_installed',
      `The install command already ran in ${path} for run ${runId}.`,
      path,
      'Continue with the run. To install again, remove the worktree and create it again.',
    );
  }

  const command = loadConfig({ env: options.env, repoPath: options.repoPath }).config.install;
  const startedAt = deps.now();
  let exitCode: number | null = null;
  try {
    exitCode = (await options.run(command, { cwd: path })).exitCode;
  } finally {
    options.log.appendEvent({
      run_id: runId,
      type: 'worktree_install',
      started_at: deps.toIso(startedAt),
      ended_at: deps.toIso(deps.now()),
      status: exitCode === 0 ? 'ok' : 'failed',
      payload: { path, exit_code: exitCode },
    });
  }

  if (exitCode !== 0) {
    throw refuse(
      'worktree_install_failed',
      `The install command exited with code ${exitCode}.`,
      path,
      'Read the install output, fix the cause, then run the install again.',
    );
  }
}
