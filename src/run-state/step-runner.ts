import { createHash } from 'node:crypto';

import type { StepExitReason, StepRequest, StepResult, WorkerRuntime } from '../worker-runtime/types.js';
import { checkAfter, markBefore, type ScopedAttempt } from '../write-scope/enforce.js';
import type { WriteScopeOptions } from '../write-scope/types.js';
import { isoNow, readRun, type RunStateContext, type RunStatus } from './context.js';
import { transition } from './transition.js';

export interface StepSpec {
  stepId: string;
  role: string;
  model: string;
  prompt: string;
  readOnly?: boolean;
  outputSchema?: unknown;
  /** Defaults to 60 seconds. */
  timeoutMs?: number;
}

export interface RunStepsOptions extends RunStateContext {
  runtime: WorkerRuntime;
  runId: string;
  /** The phase the steps belong to; the run is moved into it first. */
  phase: RunStatus;
  /** The run's worktree. */
  cwd: string;
  steps: readonly StepSpec[];
  /** When present, each step is snapshotted before it starts and checked after it returns. */
  writeScope?: WriteScopeOptions;
}

export interface RunStepsOutcome {
  /** The run status when the call returns. */
  status: RunStatus;
  /** Ids of the steps that were started, in order. */
  ran: readonly string[];
  /** Ids of the steps that were already checkpointed as done and were not started again. */
  skipped: readonly string[];
}

const DEFAULT_TIMEOUT_MS = 60_000;

/** The run status for a step that ended with this exit reason. Anything else needs a human. */
const STOP_FOR_EXIT_REASON: Readonly<Record<string, RunStatus>> = {
  timeout: 'timeout',
  budget: 'budget',
  killed: 'killed',
  breach: 'breach',
};

/** A worker result, or the same result ended as a write-scope breach. */
type AttemptResult = Omit<StepResult, 'exitReason'> & { exitReason: StepExitReason | 'breach' };

function inputHash(spec: StepSpec, prompt: string): string {
  const input = JSON.stringify([spec.role, spec.model, prompt, spec.readOnly ?? false, spec.outputSchema ?? null]);
  return createHash('sha256').update(input).digest('hex');
}

function isStepDone({ reader }: RunStateContext, runId: string, stepId: string): boolean {
  return reader.query("SELECT 1 FROM steps WHERE run_id = ? AND step = ? AND status = 'done' LIMIT 1", runId, stepId).length > 0;
}

function lastAttempt({ reader }: RunStateContext, runId: string, stepId: string): number {
  return Number(reader.query('SELECT MAX(attempt) AS n FROM steps WHERE run_id = ? AND step = ?', runId, stepId)[0]?.n ?? 0);
}

function retryPrompt(spec: StepSpec, parseError: string | undefined): string {
  return `${spec.prompt}\n\nYour previous reply could not be parsed: ${parseError ?? 'invalid structured output'}\nReply again with valid JSON only.`;
}

/** Writes a `running` checkpoint, starts the step, and returns its result. A thrown start marks the step failed. */
async function startAttempt(
  options: RunStepsOptions,
  spec: StepSpec,
  attempt: number,
  prompt: string,
  resumeSessionId: string | undefined,
): Promise<AttemptResult> {
  const { log, runId, runtime, cwd } = options;
  const base = { run_id: runId, step: spec.stepId, attempt };
  log.upsertStep({
    ...base,
    role: spec.role,
    model: spec.model,
    status: 'running',
    input_hash: inputHash(spec, prompt),
    started_at: isoNow(options),
  });
  const request: StepRequest = {
    runId,
    stepId: spec.stepId,
    attempt,
    role: spec.role,
    model: spec.model,
    prompt,
    cwd,
    readOnly: spec.readOnly ?? false,
    ...(resumeSessionId === undefined ? {} : { resumeSessionId }),
    ...(spec.outputSchema === undefined ? {} : { outputSchema: spec.outputSchema }),
    timeoutMs: spec.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    env: {},
  };
  const scoped: ScopedAttempt | undefined =
    options.writeScope === undefined
      ? undefined
      : { context: options, runId, writeScope: options.writeScope, cwd, role: spec.role, stepId: spec.stepId, attempt };
  try {
    const mark = scoped === undefined ? undefined : markBefore(scoped);
    const result = await runtime.start(request).result;
    // A breach outranks every other exit reason: the step is recorded as failed and the run stops.
    return scoped !== undefined && mark !== undefined && checkAfter(scoped, mark) ? { ...result, exitReason: 'breach' } : result;
  } catch (error) {
    log.upsertStep({ ...base, status: 'failed', exit_reason: 'error', ended_at: isoNow(options) });
    throw error;
  }
}

/** The finished step is written before anything else happens. */
function checkpoint(options: RunStepsOptions, stepId: string, attempt: number, result: AttemptResult, exitReason: string): void {
  options.log.upsertStep({
    run_id: options.runId,
    step: stepId,
    attempt,
    status: exitReason === 'ok' ? 'done' : 'failed',
    exit_reason: exitReason,
    ...(result.sessionId === undefined ? {} : { cli_session_id: result.sessionId }),
    ended_at: isoNow(options),
  });
}

/** Writes the checkpoint of a finished attempt. Returns the stop status, or undefined when the step is done. */
function conclude(options: RunStepsOptions, stepId: string, attempt: number, result: AttemptResult): RunStatus | undefined {
  checkpoint(options, stepId, attempt, result, result.exitReason);
  return result.exitReason === 'ok' ? undefined : (STOP_FOR_EXIT_REASON[result.exitReason] ?? 'needs_human');
}

/** Runs one step, with exactly one retry on malformed output. Returns the stop status, or undefined when the step is done. */
async function runStep(options: RunStepsOptions, spec: StepSpec): Promise<RunStatus | undefined> {
  const first = lastAttempt(options, options.runId, spec.stepId) + 1;
  const firstResult = await startAttempt(options, spec, first, spec.prompt, undefined);
  if (firstResult.exitReason !== 'malformed') {
    return conclude(options, spec.stepId, first, firstResult);
  }
  checkpoint(options, spec.stepId, first, firstResult, 'malformed');

  const second = first + 1;
  const retry = await startAttempt(options, spec, second, retryPrompt(spec, firstResult.parseError), firstResult.sessionId);
  if (retry.exitReason === 'malformed') {
    checkpoint(options, spec.stepId, second, retry, 'schema_invalid');
    return 'needs_human';
  }
  return conclude(options, spec.stepId, second, retry);
}

/**
 * Moves the run into `phase`, then runs the steps in order through `WorkerRuntime.start`. A step that is
 * already checkpointed as done is skipped (continue). Each finished step is written to `steps` before the
 * next one starts. Malformed structured output is retried once with the parse error attached and the
 * session resumed; a second failure ends the step as `schema_invalid`. A step that does not finish moves
 * the run to a stop status (`timeout`, `budget` and `breach` map to their own, anything else to `needs_human`).
 *
 * With `writeScope`, every started attempt is snapshotted before the worker and checked after it returns. A
 * path the step's role may not change is restored, and the step ends as `breach` (see `src/write-scope`).
 */
export async function runSteps(options: RunStepsOptions): Promise<RunStepsOutcome> {
  const { runId, phase, steps } = options;
  transition(options, runId, phase);
  const ran: string[] = [];
  const skipped: string[] = [];
  for (const spec of steps) {
    if (isStepDone(options, runId, spec.stepId)) {
      skipped.push(spec.stepId);
      continue;
    }
    ran.push(spec.stepId);
    let stop: RunStatus | undefined;
    try {
      stop = await runStep(options, spec);
    } catch (error) {
      transition(options, runId, 'needs_human');
      throw error;
    }
    if (stop !== undefined) {
      transition(options, runId, stop);
      break;
    }
  }
  return { status: readRun(options, runId).status, ran, skipped };
}
