import { afterEach, beforeEach } from 'vitest';

import { runCli, type RunCliOptions } from '../../src/cli/main.js';
import type { CliOutput } from '../../src/cli/schemas.js';
import { cleanupTempHomes, makeTempHome } from './temp-home.js';

export interface CliRun {
  exitCode: number;
  stdout: string;
  stderr: string;
}

/** Defaults: Node and git new enough, so only the test's own change decides the outcome. */
const baseOptions = {
  processVersion: 'v24.1.0',
  runGitVersion: async () => 'git version 2.47.1',
  packageVersion: '1.2.3',
};

/**
 * Runs the CLI core in-process with captured writers. No real git is spawned.
 * Call `useTempHome()` in the test file so HOME points at a fresh temp folder.
 */
export async function runCapture(
  argv: string[],
  overrides: Partial<Omit<RunCliOptions, 'argv' | 'stdout' | 'stderr'>> = {},
): Promise<CliRun> {
  let stdout = '';
  let stderr = '';
  const exitCode = await runCli({
    ...baseOptions,
    ...overrides,
    argv,
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
  });
  return { exitCode, stdout, stderr };
}

/** Parses stdout as exactly one JSON document (throws when it is anything else). */
export function parseEnvelope(run: CliRun): CliOutput {
  return JSON.parse(run.stdout) as CliOutput;
}

/** Points HOME at a fresh temp folder for each test and restores it afterwards. */
export function useTempHome(): void {
  let previousHome: string | undefined;
  beforeEach(() => {
    previousHome = process.env.HOME;
    process.env.HOME = makeTempHome();
  });
  afterEach(() => {
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    cleanupTempHomes();
  });
}
