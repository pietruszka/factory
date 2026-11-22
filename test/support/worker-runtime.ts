import { join } from 'node:path';

import { createFakeSpawner, type FakeSpawner, type Spawner } from '../../src/ports/spawner.js';
import type { ProcessTable } from '../../src/ports/process-table.js';
import { runCommand } from '../../src/ports/run-command.js';
import type { Deps } from '../../src/platform/deps.js';
import type { StepRequest } from '../../src/worker-runtime/types.js';
import { makeTempHome } from './temp-home.js';

export interface RuntimeSandbox {
  tmp: string;
  /** Environment for resolving factory paths: HOME and FACTORY_HOME inside the temp folder. */
  env: NodeJS.ProcessEnv;
  /** Literal D-39 worktree path for example-frontend / FE-123 under the temp folder. */
  worktree: string;
}

/** A fresh temp HOME. The worktree path is written out literally, not computed by src. */
export function runtimeSandbox(): RuntimeSandbox {
  const tmp = makeTempHome();
  const home = join(tmp, 'factory-home');
  return {
    tmp,
    env: { HOME: tmp, FACTORY_HOME: home },
    worktree: join(home, 'cache', 'worktrees', 'example-frontend', 'FE-123'),
  };
}

/** A write-role step request with placeholder values. */
export function stepRequest(cwd: string, overrides: Partial<StepRequest> = {}): StepRequest {
  return {
    runId: 'run-1',
    stepId: 'implement',
    attempt: 1,
    role: 'implementer',
    model: 'example-model',
    prompt: 'Add a heading to the example page.',
    cwd,
    readOnly: false,
    timeoutMs: 60_000,
    env: { EXAMPLE_FLAG: '1' },
    ...overrides,
  };
}

/** Like createFakeSpawner, but records each child in the process table as the macOS Spawner does. */
export function createRecordingSpawner(processTable: ProcessTable, deps: Deps): FakeSpawner {
  const inner = createFakeSpawner();
  return {
    requests: inner.requests,
    kills: inner.kills,
    terms: inner.terms,
    killTree: inner.killTree,
    termTree: inner.termTree,
    spawn: async (request) => {
      const child = await inner.spawn(request);
      processTable.record({
        pid: child.pid,
        command: [request.command, ...request.args].join(' '),
        startedAt: deps.now(),
      });
      return child;
    },
  };
}

/** Wraps a Spawner so each child's exit moves the fake clock forward by `ms`. */
export function withExitAfter(spawner: Spawner, advance: (ms: number) => void, ms: number): Spawner {
  return {
    killTree: spawner.killTree,
    termTree: spawner.termTree,
    spawn: async (request) => {
      const child = await spawner.spawn(request);
      return {
        pid: child.pid,
        exit: child.exit.then((result) => {
          advance(ms);
          return result;
        }),
      };
    },
  };
}

/** Polls until `check` is true. Real time: the processes under test are real. */
export async function waitFor(check: () => boolean | Promise<boolean>, timeoutMs = 4000): Promise<void> {
  const deadline = performance.now() + timeoutMs;
  while (!(await check())) {
    if (performance.now() > deadline) {
      throw new Error(`condition not met within ${timeoutMs} ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Pids of every descendant of `root`, from `ps`. */
export async function descendantsOf(root: number): Promise<number[]> {
  const { stdout } = await runCommand('ps', ['-A', '-o', 'pid=,ppid=']);
  const childrenOf = new Map<number, number[]>();
  for (const line of stdout.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid === undefined || ppid === undefined || Number.isNaN(pid) || Number.isNaN(ppid)) continue;
    childrenOf.set(ppid, [...(childrenOf.get(ppid) ?? []), pid]);
  }
  const visit = (pid: number): number[] => (childrenOf.get(pid) ?? []).flatMap((c) => [c, ...visit(c)]);
  return visit(root);
}
