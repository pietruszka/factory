import type { Deps } from '../platform/deps.js';
import type { EventLogWriters } from '../event-log/writers.js';
import type { Spawner } from '../ports/spawner.js';
import type { RunningStep, StepEvent, StepProcess, StepRequest, StepResult } from './types.js';

/** What a finished child left behind, for an adapter to turn into a StepResult. */
export interface StepOutput {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: string | null;
  timedOut: boolean;
  durationMs: number;
  processes: readonly StepProcess[];
}

export interface StartStepOptions {
  spawner: Spawner;
  deps: Deps;
  /** When given, the child is also written as a `processes` row. */
  eventLog?: Pick<EventLogWriters, 'appendProcess' | 'endProcess'>;
  request: StepRequest;
  command: string;
  args: readonly string[];
  toResult: (output: StepOutput) => StepResult;
}

/**
 * Starts one child through the Spawner in `request.cwd` (also set as `PWD`, D-39), and returns the running step.
 * The Spawner records the process table row. `kill` is `Spawner.killTree` (SIGKILL). Time comes from `Deps`.
 */
export function startStep(options: StartStepOptions): RunningStep {
  const { spawner, deps, eventLog, request, command, args, toResult } = options;
  const commandLine = [command, ...args].join(' ');
  const startedAt = deps.now();
  let stopped: 'killed' | 'timeout' | undefined;

  const spawned = spawner.spawn({ command, args, cwd: request.cwd, env: { ...request.env, PWD: request.cwd } });

  let killing: Promise<void> | undefined;
  const kill = (): Promise<void> =>
    (killing ??= spawned.then(
      async (child) => {
        if ((await spawner.killTree(child.pid, commandLine)) === 'killed') stopped ??= 'killed';
      },
      () => undefined, // The child never started: nothing to kill.
    ));

  const result = spawned.then(async (child): Promise<StepResult> => {
    let row: { id: number } | undefined;
    try {
      row = eventLog?.appendProcess({ run_id: request.runId, step: request.stepId, pid: child.pid, command: commandLine });
    } catch (error) {
      await spawner.killTree(child.pid, commandLine);
      throw error;
    }
    const timer = deps.setTimer(() => {
      stopped ??= 'timeout';
      void kill();
    }, request.timeoutMs);
    try {
      const exit = await child.exit;
      const output = (await child.output) ?? { stdout: '', stderr: '' };
      await killing;
      const mapped = toResult({
        ...output,
        code: exit.code,
        signal: exit.signal,
        timedOut: stopped === 'timeout',
        durationMs: deps.now() - startedAt,
        processes: [{ pid: child.pid, command: commandLine }],
      });
      return stopped === 'killed' ? { ...mapped, exitReason: 'killed' } : mapped;
    } finally {
      deps.clearTimer(timer);
      if (row !== undefined) eventLog?.endProcess(row.id);
    }
  });

  async function* events(): AsyncGenerator<StepEvent> {
    const child = await spawned;
    yield { type: 'started', pid: child.pid, command: commandLine };
    yield { type: 'output', text: (await result).rawText };
  }

  return { events: events(), result, kill };
}
