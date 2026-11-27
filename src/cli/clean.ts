import { existsSync } from 'node:fs';

import { openEventLog, openEventLogReadOnly } from '../event-log/open.js';
import { createSystemDeps, type Deps } from '../platform/deps.js';
import { FactoryError } from '../platform/errors.js';
import { resolveFactoryPaths } from '../platform/paths.js';
import type { CodeHost } from '../ports/code-host.js';
import { applyRetention, type RetentionResult } from '../retention/clean.js';
import { diskReport, measureDiskUse, renderDisk, type MeasureDisk } from '../retention/disk-usage.js';
import { EXIT_CODES } from './exit-codes.js';
import type { CommandDef } from './router.js';

/** What a test can inject into the command; the rest comes from the real system. */
export interface CleanCommandOptions {
  deps: Deps;
  codeHost: CodeHost;
  measureDisk: MeasureDisk;
}

/** There is no code host adapter yet, so a pull request cannot be read; any read fails and its worktree is kept. */
const unavailable = (): Promise<never> =>
  Promise.reject(
    new FactoryError({
      code: 'code_host_unavailable',
      message: 'No code host is connected, so a pull request cannot be read yet.',
      where: 'CodeHost',
      next: 'Wait for the code host adapter; until then only abandoned runs are cleaned.',
      exitCode: EXIT_CODES.refused,
    }),
  );
const noCodeHost: CodeHost = {
  fetchPullRequest: () => unavailable(),
  push: () => unavailable(),
  openDraftPr: () => unavailable(),
};

const EMPTY: RetentionResult = { worktrees_removed: [], worktrees_skipped: [], artifacts_deleted: [] };

const section = (title: string, lines: string[]): string[] => (lines.length === 0 ? [] : [title, ...lines.map((line) => `  ${line}`)]);

function render(result: RetentionResult, disk: string): string {
  const { worktrees_removed, worktrees_skipped, artifacts_deleted } = result;
  const lines = [
    ...section('Removed worktrees:', worktrees_removed.map((entry) => `${entry.run_id}  ${entry.path}`)),
    ...section(
      'Skipped worktrees:',
      worktrees_skipped.flatMap((entry) => [`${entry.run_id}  ${entry.path}`, `  ${entry.reason}`, `  Next: ${entry.next}`]),
    ),
    ...section('Deleted artifacts:', artifacts_deleted.map((entry) => `${entry.run_id}  ${entry.paths.length} file(s): ${entry.paths.join(', ')}`)),
  ];
  return [...(worktrees_removed.length + artifacts_deleted.length === 0 ? ['Nothing to clean.'] : []), ...lines, disk].join('\n');
}

/**
 * `factory clean`: applies the retention policy to every run in the event log (worktrees 7 days after a merge or
 * an abandon, artifacts 30 days after the run ended), then prints what it removed and the disk use per area.
 * Starts no agent and deletes no event row. A home with no event log has nothing to clean and is not created.
 */
export function createCleanCommand(options: Partial<CleanCommandOptions> = {}): CommandDef {
  return {
    description: 'Delete old worktrees and run artifacts by the retention policy.',
    skipGitCheck: true,
    run: async ({ packageVersion }) => {
      const env = process.env;
      let result = EMPTY;
      if (existsSync(resolveFactoryPaths(env).dbPath)) {
        const deps = options.deps ?? createSystemDeps();
        const reader = openEventLogReadOnly({ env });
        const log = openEventLog({ env, deps, factoryVersion: packageVersion });
        try {
          result = await applyRetention({ env, deps, log, reader, codeHost: options.codeHost ?? noCodeHost });
        } finally {
          log.close();
          reader.close();
        }
      }
      const disk = diskReport((options.measureDisk ?? measureDiskUse)(env));
      return { message: render(result, renderDisk(disk)), data: { schema_version: 1, ...result, disk } };
    },
  };
}

export const cleanCommand: CommandDef = createCleanCommand();
