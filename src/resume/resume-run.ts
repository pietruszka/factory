import { existsSync } from 'node:fs';

import { spentUsdOf } from '../cost/caps.js';
import { formatUsd } from '../cost/format.js';
import type { CostOptions } from '../cost/types.js';
import { NON_RESUMABLE_RUN_STATUSES } from '../event-log/schema.js';
import { stopRunProcesses } from '../kill/kill-run.js';
import { refused, type FactoryError } from '../platform/errors.js';
import type { ProcessTable } from '../ports/process-table.js';
import type { Spawner } from '../ports/spawner.js';
import { writeProgress } from '../run-folder/progress.js';
import type { RunStateContext, RunStatus } from '../run-state/context.js';
import { findLatestRun } from '../run-state/find-run.js';
import { assertApproved, finishStubRun } from '../run-state/stub-pipeline.js';
import { isStepDone, runSteps, type StepSpec } from '../run-state/step-runner.js';
import { PHASES, phaseToResume, transition } from '../run-state/transition.js';
import { runGit } from '../worktree/git.js';
import { worktreePath } from '../worktree/path.js';
import type { WorkerRuntime } from '../worker-runtime/types.js';

/** The steps of one phase, in order. */
export interface ResumeStage {
  phase: RunStatus;
  steps: readonly StepSpec[];
}

export interface ResumeRunOptions extends RunStateContext {
  runtime: WorkerRuntime;
  spawner: Spawner;
  processTable: ProcessTable;
  repo: string;
  ticket: string;
  /** The phases and steps of the pipeline, in order. */
  stages: readonly ResumeStage[];
  cost: CostOptions;
  /** `--from <step>`: re-run this step and the later ones. */
  from?: string;
  /** `--cap +$N`: dollars added to `runs.cap_usd_effective`. Absent means the cap is not raised. */
  capIncrementUsd?: number;
}

export interface ResumeRunOutcome {
  runId: string;
  /** The status the run had before the resume. */
  previousStatus: RunStatus;
  status: RunStatus;
  /** Ids of the steps that were started, in order. */
  ran: readonly string[];
  /** Ids of the steps that already had a done checkpoint and were not started. */
  skipped: readonly string[];
}

/** Short names for `--from`, besides step ids and phase names. */
const SHORT_NAMES: Readonly<Record<string, RunStatus>> = {
  plan: 'planning',
  build: 'building',
  gate: 'gating',
  verify: 'verifying',
  review: 'reviewing',
};

export const runNotFound = (repo: string, ticket: string): FactoryError =>
  refused({
    code: 'run_not_found',
    message: `There is no running or stopped run for ${ticket} in ${repo}. Nothing was started.`,
    where: ticket,
    next: 'Check the ticket and run the command from the checkout of the repo the run belongs to.',
  });

const phaseIndex = (phase: RunStatus): number => (PHASES as readonly RunStatus[]).indexOf(phase);

interface Flat {
  stage: ResumeStage;
  spec: StepSpec;
}

/** Where `--from` points: the phase to start the re-run in and the ids of the steps to run again. */
interface FromTarget {
  phase: RunStatus;
  /** The step named, when `--from` is a step id. */
  stepId: string | undefined;
  redo: readonly string[];
}

/**
 * Resolves `--from`: a step id (that step and every later one), else a phase by its name or a short name (every
 * step of that phase and later ones; a phase with no work of its own is still a valid place to restart from).
 */
function findFrom(stages: readonly ResumeStage[], flat: readonly Flat[], from: string): FromTarget | undefined {
  const entry = flat.find((each) => each.spec.stepId === from);
  if (entry !== undefined) {
    return { phase: entry.stage.phase, stepId: from, redo: flat.slice(flat.indexOf(entry)).map((each) => each.spec.stepId) };
  }
  const stage = stages.find((each) => each.phase === from || each.phase === SHORT_NAMES[from]);
  if (stage === undefined) return undefined;
  const redo = flat.filter((each) => phaseIndex(each.stage.phase) >= phaseIndex(stage.phase)).map((each) => each.spec.stepId);
  return { phase: stage.phase, stepId: undefined, redo };
}

function unknownFrom(from: string, stages: readonly ResumeStage[], flat: readonly Flat[]): FactoryError {
  return refused({
    code: 'step_unknown',
    message: `There is no step "${from}" in this pipeline.`,
    where: '--from',
    next: `Pass one of the steps (${flat.map((entry) => entry.spec.stepId).join(', ')}) or a phase (${stages.map((stage) => stage.phase).join(', ')}).`,
  });
}

/** The cap after `--cap`, refusing a run whose spend already reaches it. Nothing is written here. */
function capAfter(options: ResumeRunOptions, runId: string): number | undefined {
  const { reader, capIncrementUsd, ticket } = options;
  const stored = reader.query('SELECT cap_usd_effective AS cap FROM runs WHERE run_id = ?', runId)[0]?.cap;
  const current = typeof stored === 'number' ? stored : undefined;
  const raised = capIncrementUsd === undefined ? current : Math.round(((current ?? 0) + capIncrementUsd) * 1e6) / 1e6;
  const spent = spentUsdOf(reader, runId);
  if (raised !== undefined && spent >= raised) {
    throw refused({
      code: 'cap_reached',
      message: `Run ${runId} has spent ${formatUsd(spent)} and its dollar cap is ${formatUsd(raised)}${capIncrementUsd === undefined ? '' : ` after adding ${formatUsd(capIncrementUsd)}`}, so it would stop at once. Nothing was started.`,
      where: 'cap_usd_effective',
      next: `Raise the cap explicitly, for example: factory resume ${ticket} --cap +$${Math.ceil(spent - raised) + 1}.`,
    });
  }
  return capIncrementUsd === undefined ? undefined : raised;
}

/** The HEAD of the existing worktree. Refuses a worktree that is gone: resume never creates one. */
function worktreeHead(env: NodeJS.ProcessEnv, repo: string, ticket: string): { path: string; head: string } {
  const path = worktreePath(env, repo, ticket);
  const head = existsSync(path) ? runGit(env, path, ['rev-parse', 'HEAD'], { profile: 'user' }) : undefined;
  if (!head?.ok || head.stdout === '') {
    throw refused({
      code: 'worktree_missing',
      message: `The worktree ${path} of ${ticket} is missing or is not a git checkout, and resume does not create one.`,
      where: path,
      next: 'Restore the worktree, or start a new run for the ticket.',
    });
  }
  return { path, head: head.stdout };
}

/** Moves the run forward through the phases without work, up to and including `target`. */
function advanceTo(context: RunStateContext, runId: string, target: RunStatus): void {
  const current = String(context.reader.query('SELECT status FROM runs WHERE run_id = ?', runId)[0]?.status) as RunStatus;
  for (const phase of PHASES.slice(phaseIndex(current) + 1, phaseIndex(target) + 1)) {
    transition(context, runId, phase);
  }
}

/**
 * The stored CLI session id to resume: the latest one of this step, else the latest one of any step of the
 * same role (the role's last attempt).
 */
const latestSessionId = ({ reader }: RunStateContext, runId: string, spec: StepSpec): string | undefined => {
  const lookup = (where: string, order: string, param: string): string | undefined => {
    const id = reader.query(
      `SELECT cli_session_id AS id FROM steps WHERE run_id = ? AND ${where} AND cli_session_id IS NOT NULL ORDER BY ${order} LIMIT 1`,
      runId,
      param,
    )[0]?.id;
    return typeof id === 'string' ? id : undefined;
  };
  return lookup('step = ?', 'attempt DESC', spec.stepId) ?? lookup('role = ?', 'rowid DESC', spec.role);
};

/**
 * Continues a stopped run of `repo` and `ticket` from its checkpoints, in its existing worktree.
 *
 * Refused (exit 2) before anything is changed: no such run, a run that is `passed`, `refused` or `breach`,
 * an unknown `from`, a `from` in a phase the run already left, a missing worktree, a missing approval, or a
 * run whose spend already reaches its dollar cap (unless `capIncrementUsd` lifts it).
 *
 * Then, in order: process rows still open for the run are stopped (`termTree`, then `killTree`) and ended; the
 * run goes back to the phase it left through `transition`; `runs.base_commit` becomes the worktree HEAD; the
 * cap is raised by `capIncrementUsd`. Steps with a done checkpoint are skipped, any other step gets a new
 * attempt that resumes the CLI session an earlier attempt stored. `from` and later steps run again. Cost is
 * summed with earlier attempts. The progress section of `plan.md` is updated as steps finish.
 */
export async function resumeRun(options: ResumeRunOptions): Promise<ResumeRunOutcome> {
  const { runtime, spawner, processTable, repo, ticket, stages, cost, from } = options;
  const context: RunStateContext = { env: options.env, deps: options.deps, log: options.log, reader: options.reader };
  const run = findLatestRun(context.reader, repo, ticket);
  if (run === undefined) throw runNotFound(repo, ticket);
  const { runId, status: previousStatus } = run;
  if ((NON_RESUMABLE_RUN_STATUSES as readonly RunStatus[]).includes(previousStatus)) {
    throw refused({
      code: 'run_not_resumable',
      message: `Run ${runId} of ${ticket} is ${previousStatus}, so it cannot be resumed. Nothing was started.`,
      where: `runs.status (${runId})`,
      next: `A ${previousStatus} run is final. Start a new run for the ticket instead.`,
    });
  }

  const flat: Flat[] = stages.flatMap((stage) => stage.steps.map((spec) => ({ stage, spec })));
  const first = from === undefined ? undefined : findFrom(stages, flat, from);
  if (from !== undefined && first === undefined) throw unknownFrom(from, stages, flat);
  const redo = first?.redo ?? [];

  const left = phaseToResume(context, runId);
  const pending = (id: string): boolean => !isStepDone(context, runId, id);
  const startPhase =
    left ?? (flat.find((entry) => pending(entry.spec.stepId) || redo.includes(entry.spec.stepId))?.stage ?? stages[0])?.phase;
  if (startPhase === undefined) throw new Error('resumeRun needs at least one stage.');
  if (first !== undefined && phaseIndex(first.phase) < phaseIndex(startPhase)) {
    throw refused({
      code: 'from_behind',
      message: `${from} belongs to ${first.phase}, but run ${runId} is already past it (${startPhase}). A run only goes forward.`,
      where: '--from',
      next: `Pass a step of ${startPhase} or a later phase.`,
    });
  }
  if (phaseIndex(startPhase) < phaseIndex('building')) assertApproved(context, runId);
  const newCap = capAfter(options, runId);
  const worktree = worktreeHead(context.env, repo, ticket);

  // Everything is checked. First stop what the crashed or killed attempt left running.
  const stopped = await stopRunProcesses({ ...context, runId, spawner, processTable });
  for (const row of stopped.rows) context.log.endProcess(row.id);
  transition(context, runId, startPhase);
  context.log.updateRunBaseCommit(runId, worktree.head);
  if (newCap !== undefined) context.log.updateRunCap(runId, newCap);
  context.log.appendEvent({
    run_id: runId,
    type: 'resumed',
    payload: { from: previousStatus, step: first?.stepId ?? null, base_commit: worktree.head, cap_usd_effective: newCap ?? null, processes: stopped.processes },
  });

  const redoPending = new Set(redo);
  const progress = (lastResult: string): void => {
    const done = flat.map((entry) => entry.spec.stepId).filter((id) => isStepDone(context, runId, id) && !redoPending.has(id));
    const current = flat.find((entry) => !done.includes(entry.spec.stepId))?.spec.stepId ?? 'none';
    writeProgress({ env: context.env, repo, ticket, progress: { currentStep: current, doneSteps: done, lastResult } });
  };
  progress(`resumed from ${previousStatus}`);

  const ran: string[] = [];
  const skipped: string[] = [];
  const outcome = (status: RunStatus): ResumeRunOutcome => ({ runId, previousStatus, status, ran, skipped });
  for (const stage of stages.filter((each) => phaseIndex(each.phase) >= phaseIndex(startPhase))) {
    advanceTo(context, runId, stage.phase);
    for (const spec of stage.steps) {
      const resumeSessionId = latestSessionId(context, runId, spec);
      const stepOutcome = await runSteps({
        ...context,
        runtime,
        runId,
        phase: stage.phase,
        cwd: worktree.path,
        steps: [resumeSessionId === undefined || !runtime.capabilities().resume ? spec : { ...spec, resumeSessionId }],
        cost,
        rerun: redo,
      });
      ran.push(...stepOutcome.ran);
      skipped.push(...stepOutcome.skipped);
      redoPending.delete(spec.stepId);
      progress(`${spec.stepId}: ${stepOutcome.ran.length === 0 ? 'already done' : stepOutcome.status === stage.phase ? 'done' : stepOutcome.status}`);
      if (stepOutcome.status !== stage.phase) return outcome(stepOutcome.status);
    }
  }
  advanceTo(context, runId, 'opening_pr');
  const status = finishStubRun(context, runId, worktree.path);
  progress(`run ${status}`);
  return outcome(status);
}
