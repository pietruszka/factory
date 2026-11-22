import { existsSync } from 'node:fs';
import { basename } from 'node:path';

import { loadConfig } from '../config/load.js';
import { openEventLog, openEventLogReadOnly, type EventLogReadOnly } from '../event-log/open.js';
import { NON_RESUMABLE_RUN_STATUSES } from '../event-log/schema.js';
import { killRun } from '../kill/kill-run.js';
import { createSystemDeps } from '../platform/deps.js';
import { FactoryError } from '../platform/errors.js';
import { resolveFactoryPaths } from '../platform/paths.js';
import { createMacosProcessTable } from '../ports/process-table.js';
import { createMacosSpawner } from '../ports/spawner.js';
import { runFolderPath, isSlug } from '../run-folder/path.js';
import { runGit } from '../worktree/git.js';
import { worktreePath } from '../worktree/path.js';
import { EXIT_CODES } from './exit-codes.js';
import type { CommandDef } from './router.js';

const refuse = (code: string, message: string, where: string, next: string): FactoryError =>
  new FactoryError({ code, message, where, next, exitCode: EXIT_CODES.refused });

/** The top folder of the git checkout that contains `cwd`. Refuses a folder that is not in a git checkout. */
function checkoutRoot(env: NodeJS.ProcessEnv, cwd: string): string {
  const top = existsSync(cwd) ? runGit(env, cwd, ['rev-parse', '--show-toplevel']) : undefined;
  if (!top?.ok || top.stdout === '') {
    throw refuse(
      'checkout_invalid',
      `${cwd} is not inside a git checkout, so factory cannot tell which repo to kill a run in.`,
      cwd,
      'Run `factory kill <ticket>` from inside the work-repo checkout the run was started from.',
    );
  }
  return top.stdout;
}

/** The unique run of `repo` and `ticket` that is not final. An already `killed` run counts. */
function findRun(reader: EventLogReadOnly, repo: string, ticket: string): string | undefined {
  const finals = NON_RESUMABLE_RUN_STATUSES.map((status) => `'${status}'`).join(', ');
  const row = reader.query(
    `SELECT run_id FROM runs WHERE repo = ? AND ticket = ? AND status NOT IN (${finals}) ORDER BY started_at DESC LIMIT 1`,
    repo,
    ticket,
  )[0];
  return row === undefined ? undefined : String(row.run_id);
}

const runNotFound = (repo: string, ticket: string): FactoryError =>
  refuse(
    'run_not_found',
    `There is no running or stopped run for ${ticket} in ${repo}. Nothing was signalled.`,
    ticket,
    'Check the ticket and run the command from the checkout of the repo the run belongs to.',
  );

export const killCommand: CommandDef = {
  description: 'Stop the run of a ticket in this checkout and keep its worktree.',
  positionals: ['ticket'],
  run: async ({ positionals, cwd, packageVersion }) => {
    const ticket = positionals[0] ?? '';
    if (!isSlug(ticket)) {
      throw refuse(
        'ticket_invalid',
        `The ticket "${ticket}" is not a valid ticket key. Use letters, digits, ".", "_" or "-" only.`,
        'ticket',
        'Pass the ticket key, for example `factory kill FE-123`.',
      );
    }
    const env = process.env;
    const checkout = checkoutRoot(env, cwd);
    const repo = basename(loadConfig({ env, repoPath: checkout }).files.repo, '.yaml');

    const { dbPath } = resolveFactoryPaths(env);
    if (!existsSync(dbPath)) throw runNotFound(repo, ticket);
    const deps = createSystemDeps();
    const reader = openEventLogReadOnly({ env });
    const log = openEventLog({ env, deps, factoryVersion: packageVersion });
    try {
      const runId = findRun(reader, repo, ticket);
      if (runId === undefined) throw runNotFound(repo, ticket);
      const processTable = createMacosProcessTable();
      const spawner = createMacosSpawner({ processTable, deps });
      const result = await killRun({ env, deps, log, reader, runId, spawner, processTable });

      const worktree = worktreePath(env, repo, ticket);
      const runFolder = runFolderPath(env, repo, ticket);
      return {
        message: [
          `Killed ${ticket} (run ${runId}); it was ${result.previousStatus}. Stopped ${result.processes.length} recorded process(es).`,
          `The worktree was kept at ${worktree}.`,
          `Run folder: ${runFolder}`,
        ].join('\n'),
        data: { run_id: runId, ticket, repo, worktree, run_folder: runFolder, processes: result.processes },
        nextCommand: `factory resume ${ticket}`,
      };
    } finally {
      log.close();
      reader.close();
    }
  },
};
