import { readFileSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';

import type { Deps } from '../../src/platform/deps.js';
import type { ProcessTable } from '../../src/ports/process-table.js';
import type { Spawner } from '../../src/ports/spawner.js';
import { startStep, type StepOutput } from '../../src/worker-runtime/start-step.js';
import type { AdapterRuntimeOptions, StepResult, WorkerRuntime } from '../../src/worker-runtime/types.js';

/** One scripted step, read from a JSON file under test/fixtures/worker-scenarios/. */
export interface WorkerScenario {
  /** Files written under the step's cwd. */
  edits?: ReadonlyArray<{ path: string; content: string }>;
  /** Paths removed under the step's cwd, after the edits. A path that does not exist is ignored. */
  deletes?: readonly string[];
  /** The final JSON the step returns. The first `malformedTimes` starts return text that is not JSON. */
  final?: { json: unknown; malformedTimes?: number };
  /** Usage the step reports. Absent means the step reports none. */
  usage?: { inputTokens: number; outputTokens: number };
  sessionId?: string;
  /** Exit code of the child. */
  exitCode?: number;
  /** The child runs until it is killed. */
  hang?: boolean;
  /** The child starts this many grandchildren. */
  children?: number;
  ignoreSigterm?: boolean;
  /** Relative to cwd. The child creates it once it is set up (handlers installed, children started). */
  readyFile?: string;
  /** Relative to cwd. The child waits until this file exists, then exits. */
  latchFile?: string;
}

export interface FakeWorkerOptions {
  scenario: WorkerScenario;
  spawner: Spawner;
  processTable: ProcessTable;
  deps: Deps;
  /** When given, every spawned process is also written as a `processes` row. */
  eventLog?: AdapterRuntimeOptions['eventLog'];
}

const CHILD_SCRIPT = join(import.meta.dirname, 'fake-worker-child.mjs');

/** Throws when `path` is absolute or leaves the worktree with `..`. */
function assertInsideWorktree(path: string, what: string): void {
  if (isAbsolute(path) || normalize(path).split(/[\\/]/).includes('..')) {
    throw new Error(`scenario ${what} must stay inside the worktree: ${path}`);
  }
}

function validate(scenario: WorkerScenario): WorkerScenario {
  for (const edit of scenario.edits ?? []) assertInsideWorktree(edit.path, 'edit path');
  for (const path of scenario.deletes ?? []) assertInsideWorktree(path, 'delete path');
  if (scenario.readyFile !== undefined) assertInsideWorktree(scenario.readyFile, 'ready file');
  if (scenario.latchFile !== undefined) assertInsideWorktree(scenario.latchFile, 'latch file');
  return scenario;
}

/** Reads a scenario file. Refuses edit paths that are absolute or contain `..`. */
export function loadScenario(path: string): WorkerScenario {
  return validate(JSON.parse(readFileSync(path, 'utf8')) as WorkerScenario);
}

interface Envelope {
  text?: string;
  sessionId?: string;
  usage?: unknown;
}

function readEnvelope(stdout: string): Envelope {
  return stdout.trim() === '' ? {} : (JSON.parse(stdout) as Envelope);
}

/** A WorkerRuntime (id `fake-worker`) that plays a scenario. Its child is never a model CLI. */
export function createFakeWorkerRuntime(options: FakeWorkerOptions): WorkerRuntime {
  const { spawner, deps, eventLog } = options;
  const scenario = validate(options.scenario);
  const malformedTimes = scenario.final?.malformedTimes ?? 0;
  let starts = 0;

  return {
    id: 'fake-worker',
    capabilities: () => ({ resume: true, readOnly: true, structuredOutput: true }),
    detectVersion: async () => 'fake-worker 0.0.0',
    start: (request) => {
      starts += 1;
      const text =
        scenario.final === undefined
          ? undefined
          : starts <= malformedTimes
            ? 'this is not JSON {'
            : JSON.stringify(scenario.final.json);
      const toResult = (output: StepOutput): StepResult => {
        const envelope = readEnvelope(output.stdout);
        const base = {
          rawText: envelope.text ?? '',
          ...(envelope.sessionId === undefined ? {} : { sessionId: envelope.sessionId }),
          ...(envelope.usage === undefined ? {} : { usage: envelope.usage }),
          durationMs: output.durationMs,
          processes: output.processes,
        };
        if (output.timedOut) return { ...base, exitReason: 'timeout' };
        if (output.code !== 0) return { ...base, exitReason: 'exit_nonzero' };
        if (scenario.final === undefined) return { ...base, exitReason: 'ok' };
        try {
          return { ...base, exitReason: 'ok', parsed: JSON.parse(base.rawText) as unknown };
        } catch (error) {
          return { ...base, exitReason: 'malformed', parseError: (error as Error).message };
        }
      };
      return startStep({
        spawner,
        deps,
        eventLog,
        request,
        command: process.execPath,
        args: [CHILD_SCRIPT, JSON.stringify({ ...scenario, text })],
        toResult,
      });
    },
  };
}
