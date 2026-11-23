import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { openEventLog, openEventLogReadOnly } from '../event-log/open.js';
import { createSystemDeps } from '../platform/deps.js';
import { resolveComparablePath } from '../platform/path-helpers.js';
import { resolveFactoryPaths } from '../platform/paths.js';
import { writeSecureFile } from '../run-folder/files.js';
import { approvalHash } from '../run-folder/progress.js';
import { isSlug, runFolderPath } from '../run-folder/path.js';
import { findOpenRun } from '../run-state/find-run.js';
import { checkoutRoot, refuse, repoNameOf } from './checkout.js';
import { throwawayHome } from './dev-init.js';
import type { CommandDef } from './router.js';

const SANDBOX_REPO = 'todo-app';
/** The script the fake worker runs; it is part of every command line the fake worker records. */
const FAKE_WORKER_SCRIPT = 'fake-worker-child';

const APPROVER = 'agent-debug';
const CLIENT = 'dev-harness';

/**
 * `factory dev-approve <ticket>`: dev only. Records an approval for a fake-worker run of the sandbox repo in a
 * throwaway factory home (D-18). It is not `factory approve`. Every guard runs before anything is written.
 */
export const devApproveCommand: CommandDef = {
  description: 'Dev only: approve the plan of a sandbox run in a throwaway factory home.',
  skipGitCheck: true,
  positionals: ['ticket'],
  run: ({ positionals, cwd, packageVersion }) => {
    const ticket = positionals[0] ?? '';
    if (!isSlug(ticket)) {
      throw refuse(
        'ticket_invalid',
        `The ticket "${ticket}" is not a valid ticket key. Use letters, digits, ".", "_" or "-" only.`,
        'ticket',
        'Pass the ticket key, for example `factory dev-approve FE-123`.',
      );
    }
    const env = process.env;
    throwawayHome(env, 'dev-approve');
    const { sandboxRoot, dbPath } = resolveFactoryPaths(env);

    const checkout = checkoutRoot(env, cwd, 'dev-approve');
    if (resolveComparablePath(checkout) !== resolveComparablePath(join(sandboxRoot, SANDBOX_REPO))) {
      throw refuse(
        'dev_repo_not_sandbox',
        `${checkout} is not the sandbox repo, so dev-approve will not approve a run of it.`,
        checkout,
        `Run \`factory dev-approve ${ticket}\` from ${join(sandboxRoot, SANDBOX_REPO)}, the sample unpacked by \`factory dev-init --sample\`.`,
      );
    }
    const repo = repoNameOf(env, checkout);

    const notFound = refuse(
      'run_not_found',
      `There is no running or stopped run for ${ticket} in ${repo}. Nothing was approved.`,
      ticket,
      'Check the ticket and run the command from the sandbox checkout the run belongs to.',
    );
    if (!existsSync(dbPath)) throw notFound;
    const reader = openEventLogReadOnly({ env });
    try {
      const runId = findOpenRun(reader, repo, ticket)?.runId;
      if (runId === undefined) throw notFound;

      const commands = reader.query('SELECT command FROM processes WHERE run_id = ?', runId).map((row) => String(row.command));
      if (commands.some((command) => !command.includes(FAKE_WORKER_SCRIPT))) {
        throw refuse(
          'dev_worker_not_fake',
          `Run ${runId} has a process that is not the fake worker, so dev-approve will not approve it.`,
          `processes (${runId})`,
          'dev-approve only works for runs whose worker is the fake worker.',
        );
      }

      const planPath = join(runFolderPath(env, repo, ticket), 'plan.md');
      if (!existsSync(planPath)) {
        throw refuse(
          'plan_missing',
          `Run ${runId} has no plan.md, so there is nothing to approve.`,
          planPath,
          'Plan the run first, then run dev-approve again.',
        );
      }
      const planHash = approvalHash(readFileSync(planPath, 'utf8'));

      const deps = createSystemDeps();
      const approvedAt = deps.toIso(deps.now());
      const log = openEventLog({ env, deps, factoryVersion: packageVersion });
      try {
        log.appendApproval({
          run_id: runId,
          plan_hash: planHash,
          hash_algo: 'sha256',
          approver: APPROVER,
          client: CLIENT,
          approved_at: approvedAt,
        });
      } finally {
        log.close();
      }
      // The run folder's record of the approval, which a flow-A run needs before it can pass.
      writeSecureFile(
        join(dirname(planPath), 'plan.approved'),
        `hash: ${planHash}\napprover: ${APPROVER}\nclient: ${CLIENT}\napproved_at: ${approvedAt}\n`,
      );
      return {
        message: `Approved ${ticket} (run ${runId}) with plan hash ${planHash}. Approver ${APPROVER}, client ${CLIENT}.`,
        data: { run_id: runId, ticket, repo, plan_hash: planHash, hash_algo: 'sha256', approver: APPROVER, client: CLIENT },
      };
    } finally {
      reader.close();
    }
  },
};
