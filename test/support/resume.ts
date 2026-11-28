import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createResumeCommand } from '../../src/cli/resume.js';
import { createPosixProcessTable } from '../../src/ports/process-table.js';
import { createPosixSpawner } from '../../src/ports/spawner.js';
import type { ResumeRunOptions } from '../../src/resume/resume-run.js';
import { transition } from '../../src/run-state/transition.js';
import { createWorktree } from '../../src/worktree/create.js';
import { runCapture, type CliRun } from './cli-harness.js';
import {
  injectApproval,
  PHASE_ORDER,
  putFile,
  type InstrumentedRuntime,
  type RunStateFixture,
} from './run-state.js';
import { RESUME_COST, RESUME_STAGES } from './resume-stages.js';

/** A seeded step checkpoint of `run-1`. */
interface SeededStep {
  step: string;
  attempt?: number;
  status: 'done' | 'failed' | 'running';
  sessionId?: string;
}

export interface StoppedRunOptions {
  /** The phase the run was in when it stopped. */
  left: (typeof PHASE_ORDER)[number];
  /** The status it stopped in. `undefined` leaves it in the phase, as a crashed orchestrator does. */
  stop?: 'killed' | 'interrupted' | 'budget' | 'timeout' | 'needs_human' | 'cost_missing' | 'passed' | 'refused' | 'breach';
  steps?: readonly SeededStep[];
}

/**
 * Puts `run-1` where a stopped run is: a real linked worktree in the temp cache, the run moved through the
 * phases with `transition` up to `left` (so the stop event records the phase it left), the given step
 * checkpoints, an approved plan, and then the stop status. Nothing here is code under test except `transition`.
 */
export function stoppedRun(state: RunStateFixture, options: StoppedRunOptions): void {
  createWorktree(state.fx.options());
  for (const phase of PHASE_ORDER) {
    transition(state.context, 'run-1', phase);
    if (phase === options.left) break;
  }
  putFile(state.runFolder, 'plan.md', '# Plan\n\nA stub plan.\n');
  injectApproval(state);
  for (const seeded of options.steps ?? []) {
    state.fx.log.upsertStep({
      run_id: 'run-1',
      step: seeded.step,
      attempt: seeded.attempt ?? 1,
      role: 'implementer',
      model: 'example-model',
      status: seeded.status,
      ...(seeded.status === 'failed' ? { exit_reason: 'killed' } : {}),
      ...(seeded.sessionId === undefined ? {} : { cli_session_id: seeded.sessionId }),
    });
  }
  if (options.stop !== undefined) {
    if (options.stop === 'passed' || options.stop === 'refused' || options.stop === 'breach') {
      // Final statuses are arranged directly: `transition` would refuse `passed` without a report.
      state.arrange(options.stop);
    } else {
      transition(state.context, 'run-1', options.stop);
    }
  }
}

/** Records a dollar figure for one attempt, as a finished step with a reported cost does. */
export function seedCost(state: RunStateFixture, step: string, attempt: number, costUsd: number): void {
  state.fx.log.appendEvent({
    run_id: 'run-1',
    type: 'usage',
    step,
    attempt,
    cost_usd: costUsd,
    usage_source: 'reported',
  });
}

/** The options `resumeRun` needs for `run-1`, with a fake worker. Real Spawner and process table, temp home only. */
export function resumeOptions(
  state: RunStateFixture,
  worker: InstrumentedRuntime,
  overrides: Partial<ResumeRunOptions> = {},
): ResumeRunOptions {
  const processTable = createPosixProcessTable();
  return {
    ...state.context,
    runtime: worker.runtime,
    spawner: createPosixSpawner({ processTable, deps: state.fx.deps }),
    processTable,
    repo: 'example-frontend',
    ticket: 'FE-123',
    stages: RESUME_STAGES,
    cost: RESUME_COST,
    ...overrides,
  };
}

/** Points HOME and FACTORY_HOME at the fixture's temp folder, for the in-process CLI. Restore them in afterEach. */
export function pointEnvAt(state: RunStateFixture): void {
  process.env.HOME = state.fx.sb.tmp;
  process.env.FACTORY_HOME = state.fx.sb.home;
}

/** `factory resume ...` from inside the disposable example-frontend checkout, with a fake worker. */
export function resumeCli(
  state: RunStateFixture,
  args: string[],
  worker: InstrumentedRuntime,
  cwd = state.fx.repo.path,
): Promise<CliRun> {
  const command = createResumeCommand({
    deps: state.fx.deps,
    runtime: worker.runtime,
    stages: RESUME_STAGES,
    cost: RESUME_COST,
  });
  return runCapture(['resume', ...args], { cwd, commands: { resume: command } });
}

/** `factory resume ...` with a fake worker and the command's own default stages (no injected `stages`). */
export function resumeCliWithDefaultStages(
  state: RunStateFixture,
  args: string[],
  worker: InstrumentedRuntime,
): Promise<CliRun> {
  const command = createResumeCommand({ deps: state.fx.deps, runtime: worker.runtime, cost: RESUME_COST });
  return runCapture(['resume', ...args], { cwd: state.fx.repo.path, commands: { resume: command } });
}

/** `factory resume ...` through the command as `defaultCommands` registers it. Only for runs that are refused. */
export const resumeCliDefault = (args: string[], cwd: string): Promise<CliRun> => runCapture(['resume', ...args], { cwd });

/** Commits one file in a disposable worktree with an obviously fake identity. Returns the new HEAD. */
export function commitInWorktree(worktree: string, file: string, content: string): string {
  const env = {
    PATH: process.env.PATH ?? '',
    HOME: process.env.HOME ?? '',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'Test User',
    GIT_AUTHOR_EMAIL: 'test@example.com',
    GIT_COMMITTER_NAME: 'Test User',
    GIT_COMMITTER_EMAIL: 'test@example.com',
  };
  const run = (...args: string[]): string =>
    execFileSync('git', args, { cwd: worktree, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  writeFileSync(join(worktree, file), content);
  run('add', file);
  run('commit', '-q', '-m', 'operator change');
  return run('rev-parse', 'HEAD');
}

/** HEAD of a worktree. */
export const headOf = (worktree: string): string =>
  execFileSync('git', ['rev-parse', 'HEAD'], { cwd: worktree, encoding: 'utf8' }).trim();

export const capOf = (state: RunStateFixture): number | null => {
  const value = state.rows("SELECT cap_usd_effective AS cap FROM runs WHERE run_id = 'run-1'")[0]?.cap;
  return value === null || value === undefined ? null : Number(value);
};

export const baseCommitOf = (state: RunStateFixture): string =>
  String(state.rows("SELECT base_commit FROM runs WHERE run_id = 'run-1'")[0]?.base_commit);

/** The `to` of every `run_status` event of `run-1`, oldest first. */
export const statusTrail = (state: RunStateFixture): string[] =>
  state
    .rows("SELECT status FROM events WHERE run_id = 'run-1' AND type = 'run_status' ORDER BY id")
    .map((row) => String(row.status));

/** Ids of the steps a fake worker was asked to start, in order. */
export const startedSteps = (worker: InstrumentedRuntime): string[] => worker.requests.map((request) => request.stepId);
