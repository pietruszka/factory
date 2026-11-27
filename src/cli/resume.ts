import { existsSync } from 'node:fs';

import { loadConfig } from '../config/load.js';
import { createCursorAgentRuntime } from '../adapters/cursor-agent.js';
import { flowCaps } from '../cost/caps.js';
import { openEventLog, openEventLogReadOnly } from '../event-log/open.js';
import { createSystemDeps } from '../platform/deps.js';
import { resolveFactoryPaths } from '../platform/paths.js';
import { createPosixProcessTable } from '../ports/process-table.js';
import { createPosixSpawner } from '../ports/spawner.js';
import { resumeRun, runNotFound, type ResumeRunOptions } from '../resume/resume-run.js';
import { isSlug, runFolderPath } from '../run-folder/path.js';
import { findLatestRun } from '../run-state/find-run.js';
import { STUB_BUILD_STEP } from '../run-state/stub-pipeline.js';
import { worktreePath } from '../worktree/path.js';
import { checkoutRoot, refuse, repoNameOf } from './checkout.js';
import type { CommandDef } from './router.js';

/** What a test (or a later caller) can inject into the command; the rest comes from the real system. */
export type ResumeCommandOptions = Pick<
  ResumeRunOptions,
  'deps' | 'runtime' | 'spawner' | 'processTable' | 'stages' | 'cost'
>;

/**
 * The only pipeline there is until `factory run` exists: the stub build step, then the later stub phases,
 * which are only entered (they have no work yet). Listing them lets `--from verify` name a real phase.
 */
const DEFAULT_STAGES: ResumeRunOptions['stages'] = [
  { phase: 'building', steps: [STUB_BUILD_STEP] },
  { phase: 'gating', steps: [] },
  { phase: 'verifying', steps: [] },
  { phase: 'reviewing', steps: [] },
  { phase: 'opening_pr', steps: [] },
];

/** `--cap` is a plus sign and a dollar amount above zero: `+$2` or `+$0.50`. Returns the dollars. */
function parseCap(value: string): number {
  const amount = /^\+\$(\d+(?:\.\d+)?)$/.exec(value)?.[1];
  if (amount === undefined || Number(amount) <= 0) {
    throw refuse(
      'cap_invalid',
      `The --cap value "${value}" is not a plus sign and a dollar amount.`,
      '--cap',
      'Pass an increment such as --cap "+$2" (quote it, because $ is special in a shell).',
    );
  }
  return Number(amount);
}

/** `factory resume <ticket> [--from <step>] [--cap +$N]`: a thin wrapper around `resumeRun`. */
export function createResumeCommand(options: Partial<ResumeCommandOptions> = {}): CommandDef {
  return {
    description: 'Continue a stopped run of a ticket from its checkpoint.',
    options: {
      from: { type: 'string' },
      cap: { type: 'string' },
    },
    positionals: ['ticket'],
    run: async ({ positionals, values, cwd, packageVersion }) => {
      const ticket = positionals[0] ?? '';
      if (!isSlug(ticket)) {
        throw refuse(
          'ticket_invalid',
          `The ticket "${ticket}" is not a valid ticket key. Use letters, digits, ".", "_" or "-" only.`,
          'ticket',
          'Pass the ticket key, for example `factory resume FE-123`.',
        );
      }
      const from = typeof values.from === 'string' ? values.from : undefined;
      const capIncrementUsd = typeof values.cap === 'string' ? parseCap(values.cap) : undefined;
      const env = process.env;
      const checkout = checkoutRoot(env, cwd, 'resume');
      const repo = repoNameOf(env, checkout);

      if (!existsSync(resolveFactoryPaths(env).dbPath)) throw runNotFound(repo, ticket);
      const deps = options.deps ?? createSystemDeps();
      const reader = openEventLogReadOnly({ env });
      const log = openEventLog({ env, deps, factoryVersion: packageVersion });
      try {
        const run = findLatestRun(reader, repo, ticket);
        if (run === undefined) throw runNotFound(repo, ticket);
        const processTable = options.processTable ?? createPosixProcessTable();
        const spawner = options.spawner ?? createPosixSpawner({ processTable, deps });
        const config = loadConfig({ env, repoPath: checkout }).config;
        const outcome = await resumeRun({
          env,
          deps,
          log,
          reader,
          runtime: options.runtime ?? createCursorAgentRuntime({ spawner, processTable, deps, eventLog: log }),
          spawner,
          processTable,
          repo,
          ticket,
          stages: options.stages ?? DEFAULT_STAGES,
          cost: options.cost ?? {
            rateTable: config.rate_table,
            minutes: flowCaps(config.caps, run.flow).minutes,
            expectedUsage: [],
          },
          ...(from === undefined ? {} : { from }),
          ...(capIncrementUsd === undefined ? {} : { capIncrementUsd }),
        });

        const worktree = worktreePath(env, repo, ticket);
        const runFolder = runFolderPath(env, repo, ticket);
        return {
          message: [
            `Resumed ${ticket} (run ${outcome.runId}) from ${outcome.previousStatus}; it is now ${outcome.status}.`,
            `Started ${outcome.ran.length} step(s) and skipped ${outcome.skipped.length} that were already done.`,
            `Worktree: ${worktree}`,
            `Run folder: ${runFolder}`,
          ].join('\n'),
          data: {
            run_id: outcome.runId,
            ticket,
            repo,
            previous_status: outcome.previousStatus,
            status: outcome.status,
            ran: outcome.ran,
            skipped: outcome.skipped,
            worktree,
            run_folder: runFolder,
          },
          ...(outcome.status === 'passed' ? {} : { nextCommand: `factory resume ${ticket}` }),
        };
      } finally {
        log.close();
        reader.close();
      }
    },
  };
}

export const resumeCommand: CommandDef = createResumeCommand();
