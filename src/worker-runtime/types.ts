import type { Deps } from '../platform/deps.js';
import type { EventLogWriters } from '../event-log/writers.js';
import type { ProcessTable } from '../ports/process-table.js';
import type { Spawner } from '../ports/spawner.js';

/** Runtime ids. `fake-worker` is the scripted test worker; `test-*` ids are for adapters that only tests define. */
export type RuntimeId = 'cursor-agent' | 'opencode' | 'fake-worker' | `test-${string}`;

export interface StepRequest {
  runId: string;
  stepId: string;
  attempt: number;
  role: string;
  model: string;
  prompt: string;
  /** The run's worktree path under the cache worktrees root. */
  cwd: string;
  readOnly: boolean;
  resumeSessionId?: string;
  outputSchema?: unknown;
  timeoutMs: number;
  env: Readonly<Record<string, string>>;
}

export type StepExitReason = 'ok' | 'timeout' | 'exit_nonzero' | 'malformed' | 'killed';

export interface StepProcess {
  pid: number;
  command: string;
}

/** The runtime result. Not the L2 parser result in `src/adapters/step-result.ts`. */
export interface StepResult {
  exitReason: StepExitReason;
  rawText: string;
  parsed?: unknown;
  parseError?: string;
  sessionId?: string;
  usage?: unknown;
  /** A numeric dollar cost the CLI reported itself. Absent when the CLI reported none. */
  costUsd?: number;
  durationMs: number;
  processes: readonly StepProcess[];
}

export type StepEvent =
  | { type: 'started'; pid: number; command: string }
  | { type: 'output'; text: string };

export interface RunningStep {
  events: AsyncIterable<StepEvent>;
  result: Promise<StepResult>;
  /** Kills the child tree with `Spawner.killTree` (SIGKILL). The result then has exit reason `killed`. */
  kill(): Promise<void>;
}

export interface RuntimeCapabilities {
  resume: boolean;
  readOnly: boolean;
  structuredOutput: boolean;
}

export interface WorkerRuntime {
  readonly id: RuntimeId;
  capabilities(): RuntimeCapabilities;
  detectVersion(): Promise<string>;
  start(request: StepRequest): RunningStep;
}

export interface AdapterRuntimeOptions {
  /** The only way an adapter starts a child. */
  spawner: Spawner;
  /** The table the Spawner records into; every child shows up here with its pid and command. */
  processTable: ProcessTable;
  deps: Deps;
  /** When given, every spawned process is also written as a `processes` row. */
  eventLog?: Pick<EventLogWriters, 'appendProcess' | 'endProcess'>;
}

export type WorkerRuntimeRegistry = ReadonlyMap<RuntimeId, WorkerRuntime>;
