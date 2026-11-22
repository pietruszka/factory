import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

import { createSystemDeps, type Deps } from '../src/platform/deps.js';

export interface RunLayerOptions {
  deps: Deps;
  /** Runs vitest with the given arguments and resolves with its exit code. */
  runVitest: (args: string[]) => Promise<number>;
  print: (line: string) => void;
  /** Wall-clock budget in seconds; the run fails when it takes longer. */
  budgetSeconds?: number;
}

/** L3 pipeline tests must stay under two minutes (NFR-37). */
export const L3_BUDGET_SECONDS = 120;

/** Runs the tests in the `test/l3/` folder and enforces the time budget. */
export async function runLayer(opts: RunLayerOptions): Promise<{ exitCode: number }> {
  const { deps, runVitest, print, budgetSeconds } = opts;
  const startedAt = deps.now();
  // --passWithNoTests keeps the folder green while it holds no tests.
  const vitestExit = await runVitest(['run', 'test/l3/', '--passWithNoTests']);
  // Round up so a reported time over the budget is always shown as over it.
  const seconds = Math.ceil((deps.now() - startedAt) / 1000);

  if (budgetSeconds !== undefined && seconds > budgetSeconds) {
    print(`L3 took ${seconds} s, budget ${budgetSeconds} s`);
    return { exitCode: 1 };
  }
  print(`L3 took ${seconds} s`);
  return { exitCode: vitestExit === 0 ? 0 : 1 };
}

function runVitestProcess(args: string[]): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['vitest', ...args], { stdio: 'inherit' });
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { exitCode } = await runLayer({
    deps: createSystemDeps(),
    runVitest: runVitestProcess,
    print: console.log,
    budgetSeconds: L3_BUDGET_SECONDS,
  });
  process.exitCode = exitCode;
}
