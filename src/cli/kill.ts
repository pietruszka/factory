import { existsSync } from 'node:fs';

import { openEventLog, openEventLogReadOnly } from '../event-log/open.js';
import { killRun } from '../kill/kill-run.js';
import { createSystemDeps } from '../platform/deps.js';
import type { FactoryError } from '../platform/errors.js';
import { resolveFactoryPaths } from '../platform/paths.js';
import { createPosixProcessTable } from '../ports/process-table.js';
import { createPosixSpawner } from '../ports/spawner.js';
import { runFolderPath, isSlug } from '../run-folder/path.js';
import { findOpenRun } from '../run-state/find-run.js';
import { worktreePath } from '../worktree/path.js';
import { checkoutRoot, refuse, repoNameOf } from './checkout.js';
import type { CommandDef } from './router.js';

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
    const checkout = checkoutRoot(env, cwd, 'kill');
    const repo = repoNameOf(env, checkout);

    const { dbPath } = resolveFactoryPaths(env);
    if (!existsSync(dbPath)) throw runNotFound(repo, ticket);
    const deps = createSystemDeps();
    const reader = openEventLogReadOnly({ env });
    const log = openEventLog({ env, deps, factoryVersion: packageVersion });
    try {
      const runId = findOpenRun(reader, repo, ticket)?.runId;
      if (runId === undefined) throw runNotFound(repo, ticket);
      const processTable = createPosixProcessTable();
      const spawner = createPosixSpawner({ processTable, deps });
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
