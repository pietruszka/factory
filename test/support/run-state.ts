import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { RunInput } from '../../src/event-log/open.js';
import { createPosixProcessTable } from '../../src/ports/process-table.js';
import { createPosixSpawner } from '../../src/ports/spawner.js';
import { createRunFolder } from '../../src/run-folder/create.js';
import { writeReport } from '../../src/run-folder/report.js';
import { runStubBuild, runStubPlan } from '../../src/run-state/stub-pipeline.js';
import { createWorktree } from '../../src/worktree/create.js';
import type { RunStateContext, RunStatus } from '../../src/run-state/context.js';
import type { StepSpec } from '../../src/run-state/step-runner.js';
import type { RunningStep, StepRequest, StepResult, WorkerRuntime } from '../../src/worker-runtime/types.js';
import { cleanupEventLogTest } from './event-log.js';
import { createFakeWorkerRuntime, loadScenario } from './fake-worker.js';
import { waitFor } from './worker-runtime.js';
import { worktreeFixture, type WorktreeFixture } from './worktree-fixture.js';

const SCENARIOS = join(import.meta.dirname, '..', 'fixtures', 'worker-scenarios');

/** The phases of the run state machine, written out as literals (the plan's happy-path order). */
export const PHASE_ORDER = [
  'preflight',
  'routing',
  'planning',
  'awaiting_approval',
  'building',
  'gating',
  'verifying',
  'reviewing',
  'opening_pr',
] as const;

/** Every status that is neither a phase nor `passed`, written out as literals. */
export const STOP_STATUSES = [
  'refused',
  'config_drift',
  'needs_human',
  'cannot_reproduce',
  'budget',
  'timeout',
  'cost_missing',
  'breach',
  'killed',
  'interrupted',
] as const;

const killers: Array<() => Promise<void>> = [];

/** The standard afterEach for run-state tests: no scenario child outlives its test, then the temp homes go. */
export async function cleanupRunStateTest(): Promise<void> {
  for (const kill of killers.splice(0)) {
    await kill().catch(() => undefined);
  }
  cleanupEventLogTest();
}

export interface InstrumentedRuntime {
  runtime: WorkerRuntime;
  /** Every request passed to `start`, in order. */
  requests: StepRequest[];
  /** Every result of a started step, in order. */
  results: StepResult[];
}

/** Wraps a runtime to record each start, and to kill any child that is still running at cleanup. */
export function instrument(inner: WorkerRuntime, onStart: (request: StepRequest) => void = () => undefined): InstrumentedRuntime {
  const requests: StepRequest[] = [];
  const results: StepResult[] = [];
  const runtime: WorkerRuntime = {
    id: inner.id,
    capabilities: () => inner.capabilities(),
    detectVersion: () => inner.detectVersion(),
    start: (request): RunningStep => {
      requests.push(request);
      onStart(request);
      const step = inner.start(request);
      killers.push(() => step.kill());
      void step.result.then(
        (result) => results.push(result),
        () => undefined,
      );
      return step;
    },
  };
  return { runtime, requests, results };
}

export interface RunStateFixture {
  fx: WorktreeFixture;
  context: RunStateContext;
  /** The run folder of `example-frontend` / `FE-123`, created. */
  runFolder: string;
  /** The literal worktree path under the cache root. It is not created. */
  worktree: string;
  /** A fake worker (id `fake-worker`) playing `test/fixtures/worker-scenarios/<name>.json`, started through the real Spawner. */
  scenarioRuntime: (name: string, onStart?: (request: StepRequest) => void) => InstrumentedRuntime;
  /** Rows of one table for run-1, as plain objects, oldest first. */
  rows: (sql: string, ...params: Array<string | number | null>) => Array<Record<string, unknown>>;
  /** Arranges a status directly in storage. Only for setting up a test; the code under test uses `transition`. */
  arrange: (status: string) => void;
  status: () => string;
}

/** Run `run-1` for `example-frontend` / `FE-123` in `preflight`, with a fake clock and a temp factory home. */
export function runStateFixture(opts: { run?: Partial<RunInput> } = {}): RunStateFixture {
  const fx = worktreeFixture(opts);
  const runFolder = createRunFolder({ env: fx.sb.env, repo: 'example-frontend', ticket: 'FE-123' });
  const worktree = fx.expectedPath();
  const context: RunStateContext = { env: fx.sb.env, deps: fx.deps, log: fx.log, reader: fx.reader };
  const processTable = createPosixProcessTable();
  const spawner = createPosixSpawner({ processTable, deps: fx.deps });

  return {
    fx,
    context,
    runFolder,
    worktree,
    scenarioRuntime: (name, onStart) =>
      instrument(
        createFakeWorkerRuntime({
          scenario: loadScenario(join(SCENARIOS, `${name}.json`)),
          spawner,
          processTable,
          deps: fx.deps,
          eventLog: fx.log,
        }),
        onStart,
      ),
    rows: (sql, ...params) => fx.reader.query(sql, ...params),
    arrange: (status) => {
      fx.log.updateRunStatus('run-1', status);
    },
    status: () => String(fx.reader.query("SELECT status FROM runs WHERE run_id = 'run-1'")[0]?.status),
  };
}

/** A step spec with placeholder values. */
export function stepSpec(stepId: string, overrides: Partial<StepSpec> = {}): StepSpec {
  return {
    stepId,
    role: 'implementer',
    model: 'example-model',
    prompt: `Do the ${stepId} step for the example page.`,
    timeoutMs: 60_000,
    ...overrides,
  };
}

export function putFile(folder: string, relative: string, content = 'placeholder\n'): void {
  mkdirSync(dirname(join(folder, relative)), { recursive: true });
  writeFileSync(join(folder, relative), content);
}

/** Writes the required artifacts of flow A and a report that lists them, so `canPassFromReport` is true. */
export function makePassable(state: RunStateFixture): void {
  putFile(state.runFolder, 'plan.md');
  putFile(state.runFolder, 'plan.approved');
  putFile(state.runFolder, 'evidence/diff.patch');
  writeReport({ env: state.fx.sb.env, log: state.fx.reader, runId: 'run-1', worktreePath: state.worktree });
}

/** The approval a test injects in place of `factory approve`. */
export function injectApproval(state: RunStateFixture): void {
  putFile(state.runFolder, 'plan.approved');
  state.fx.log.appendApproval({
    run_id: 'run-1',
    plan_hash: 'a'.repeat(64),
    approver: 'example-approver',
    client: 'test',
  });
}

/** Resolves once the first child of the step has a `processes` row, which is when its timeout timer is set. */
export function childRecorded(state: RunStateFixture): Promise<void> {
  const seen = waitFor(() => state.rows('SELECT id FROM processes').length > 0);
  seen.catch(() => undefined);
  return seen;
}

/**
 * Drives the stub pipeline of `run-1` from preflight: a real worktree (linked, in the temp cache), a stub plan
 * step with the `final-json` fake worker, an injected approval, then stub build steps with the given scenario.
 */
export async function driveStubPipeline(
  state: RunStateFixture,
  buildScenario: string,
): Promise<{ planned: RunStatus; final: RunStatus }> {
  createWorktree(state.fx.options());
  const common = { ...state.context, runId: 'run-1', worktree: state.worktree };
  const planned = await runStubPlan({ ...common, runtime: state.scenarioRuntime('final-json').runtime });
  injectApproval(state);
  const final = await runStubBuild({ ...common, runtime: state.scenarioRuntime(buildScenario).runtime });
  return { planned, final };
}
