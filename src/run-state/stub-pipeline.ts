import { join } from 'node:path';

import { FactoryError } from '../platform/errors.js';
import { runFolderPath } from '../run-folder/path.js';
import { writeEvidenceDiff } from '../run-folder/evidence.js';
import { writeSecureFile } from '../run-folder/files.js';
import { writeReport } from '../run-folder/report.js';
import type { WorkerRuntime } from '../worker-runtime/types.js';
import { readRun, type RunStateContext, type RunStatus } from './context.js';
import { runSteps, type StepSpec } from './step-runner.js';
import { transition } from './transition.js';

export interface StubPipelineOptions extends RunStateContext {
  runtime: WorkerRuntime;
  runId: string;
  /** The run's worktree under the cache root. */
  worktree: string;
}

const STUB_MODEL = 'stub-model';

const PLAN_STEP: StepSpec = {
  stepId: 'plan',
  role: 'planner',
  model: STUB_MODEL,
  prompt: 'Write a short stub plan as JSON.',
  readOnly: true,
  outputSchema: { type: 'object' },
};

const BUILD_STEP: StepSpec = {
  stepId: 'implement',
  role: 'implementer',
  model: STUB_MODEL,
  prompt: 'Make the stub change.',
};

/** Phases after `building` that this stub has no work for yet; each one is only entered. */
const PHASES_AFTER_BUILD = ['gating', 'verifying', 'reviewing', 'opening_pr'] as const;

/**
 * Preflight, routing and planning with one stub plan step, then `awaiting_approval`. The run must be in
 * `preflight`. Returns the run status: a stop status when the plan step did not finish.
 */
export async function runStubPlan(options: StubPipelineOptions): Promise<RunStatus> {
  const { runId, worktree, runtime, ...context } = options;
  transition(context, runId, 'routing');
  const outcome = await runSteps({ ...context, runtime, runId, phase: 'planning', cwd: worktree, steps: [PLAN_STEP] });
  if (outcome.status !== 'planning') {
    return outcome.status;
  }
  const run = readRun(context, runId);
  writeSecureFile(join(runFolderPath(context.env, run.repo, run.ticket), 'plan.md'), '# Plan\n\nA stub plan.\n');
  transition(context, runId, 'awaiting_approval');
  return 'awaiting_approval';
}

function assertApproved(context: RunStateContext, runId: string): void {
  if (context.reader.query('SELECT id FROM approvals WHERE run_id = ? LIMIT 1', runId).length === 0) {
    throw new FactoryError({
      code: 'approval_missing',
      message: `Run ${runId} has no recorded approval, so it cannot start building.`,
      where: `approvals (${runId})`,
      next: 'Record an approval for the run, then build again.',
      exitCode: 2,
    });
  }
}

/**
 * After an approval was injected: one stub build step, the later phases entered without work, the stub
 * evidence and the report, then `passed` when `canPassFromReport` allows it. A build step that does not
 * finish, or required artifacts that are missing, end the run in a stop status. A run is never left in a phase.
 */
export async function runStubBuild(options: StubPipelineOptions): Promise<RunStatus> {
  const { runId, worktree, runtime, ...context } = options;
  assertApproved(context, runId);
  const outcome = await runSteps({ ...context, runtime, runId, phase: 'building', cwd: worktree, steps: [BUILD_STEP] });
  if (outcome.status !== 'building') {
    return outcome.status;
  }
  for (const phase of PHASES_AFTER_BUILD) {
    transition(context, runId, phase);
  }
  const run = readRun(context, runId);
  writeEvidenceDiff({ env: context.env, repo: run.repo, ticket: run.ticket, diff: '# stub diff\n' });
  writeReport({ env: context.env, log: context.reader, runId, worktreePath: worktree });
  try {
    transition(context, runId, 'passed');
    return 'passed';
  } catch (error) {
    if (!(error instanceof FactoryError) || error.code !== 'passed_refused') {
      throw error;
    }
    transition(context, runId, 'needs_human');
    return 'needs_human';
  }
}
