import { existsSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';

import { resumeRun } from '../../src/resume/resume-run.js';
import { cleanupRunStateTest, runStateFixture, stepSpec } from '../support/run-state.js';
import { RESUME_COST } from '../support/resume-stages.js';
import { eventsOf, listedWorktrees } from '../support/worktree-fixture.js';
import {
  baseCommitOf,
  commitInWorktree,
  headOf,
  resumeOptions,
  seedCost,
  startedSteps,
  statusTrail,
  stoppedRun,
} from '../support/resume.js';

afterEach(cleanupRunStateTest);

describe('resuming a stopped run', () => {
  test('resuming a killed run returns to the phase the run left and not to a later phase', async () => {
    const state = runStateFixture();
    stoppedRun(state, { left: 'building', stop: 'killed', steps: [{ step: 'prepare', status: 'done' }] });
    const phasesSeenByWorker: string[] = [];
    const worker = state.scenarioRuntime('session-id', () => phasesSeenByWorker.push(state.status()));

    const outcome = await resumeRun(resumeOptions(state, worker));

    // The first step started while the run was in building, not in gating or later; then the run moved on.
    expect(phasesSeenByWorker).toEqual(['building', 'verifying', 'reviewing']);
    // The first move out of `killed` goes back to building; only then does the run move on.
    const trail = statusTrail(state);
    expect(trail.slice(trail.indexOf('killed'), trail.indexOf('killed') + 2)).toEqual(['killed', 'building']);
    expect(outcome.skipped).toEqual(['prepare']);
    expect(outcome.ran[0]).toBe('implement');
  });
});

describe('commits made in the worktree become the new base', () => {
  test('after commits are made in the existing worktree, resume stores that HEAD as runs.base_commit and the next step runs with that commit as HEAD', async () => {
    const state = runStateFixture();
    stoppedRun(state, { left: 'building', stop: 'killed', steps: [{ step: 'prepare', status: 'done' }] });
    const pinned = baseCommitOf(state);
    const operatorHead = commitInWorktree(state.worktree, 'operator.txt', 'added by the operator\n');
    const headAtStart: string[] = [];
    const worker = state.scenarioRuntime('session-id', (request) => headAtStart.push(headOf(request.cwd)));

    await resumeRun(resumeOptions(state, worker));

    expect(operatorHead).not.toBe(pinned);
    expect(baseCommitOf(state)).toBe(operatorHead);
    expect(headAtStart[0]).toBe(operatorHead);
    // The same worktree was reused: no second one was created.
    expect(listedWorktrees(state.fx.repo.path).filter((path) => path === state.worktree)).toHaveLength(1);
    expect(eventsOf(state.fx.reader, 'run-1', 'worktree_created')).toHaveLength(1);
    expect(existsSync(state.worktree)).toBe(true);
  });
});

describe('cost is summed across attempts', () => {
  test('cost from the resumed attempt is summed with prior attempts when checking the dollar cap', async () => {
    // $1.25 was spent before the stop. The resumed attempt reports another $1.25, which reaches the $2.50 cap.
    const state = runStateFixture({ run: { cap_usd_effective: 2.5 } });
    stoppedRun(state, { left: 'building', stop: 'killed', steps: [{ step: 'implement', status: 'failed' }] });
    seedCost(state, 'implement', 1, 1.25);
    const worker = state.scenarioRuntime('usage-reported-cost');

    const outcome = await resumeRun(
      resumeOptions(state, worker, {
        cost: { ...RESUME_COST, expectedUsage: ['tokens'] },
        stages: [{ phase: 'building', steps: [stepSpec('implement'), stepSpec('polish')] }],
      }),
    );

    expect(startedSteps(worker)).toEqual(['implement']);
    expect(outcome.status).toBe('budget');
    expect(state.status()).toBe('budget');
    const stop = eventsOf(state.fx.reader, 'run-1', 'run_stop').at(-1);
    expect(stop?.payload).toMatchObject({ spentUsd: 2.5 });
  });
});

describe('a stored CLI session id is reused', () => {
  test('a new attempt of a step whose previous attempt stored a cli_session_id is started with that id as resumeSessionId', async () => {
    const state = runStateFixture();
    stoppedRun(state, {
      left: 'building',
      stop: 'killed',
      steps: [
        { step: 'prepare', status: 'done' },
        { step: 'implement', attempt: 1, status: 'failed', sessionId: 'session-example-seed' },
      ],
    });
    const worker = state.scenarioRuntime('session-id');

    await resumeRun(resumeOptions(state, worker));

    const implement = worker.requests.find((request) => request.stepId === 'implement');
    expect(implement).toMatchObject({ attempt: 2, resumeSessionId: 'session-example-seed' });
    // A step with no earlier attempt has no session to resume.
    const review = worker.requests.find((request) => request.stepId === 'review');
    expect(review).toBeDefined();
    expect(review?.resumeSessionId).toBeUndefined();
  });

  test('a step with no stored session id of its own falls back to the latest session id stored for the same role', async () => {
    const state = runStateFixture();
    stoppedRun(state, {
      left: 'building',
      stop: 'killed',
      steps: [{ step: 'prepare', status: 'done', sessionId: 'session-example-role' }],
    });
    const worker = state.scenarioRuntime('session-id');

    await resumeRun(resumeOptions(state, worker));

    // `implement` never ran, but the implementer role stored a session in `prepare`.
    const implement = worker.requests.find((request) => request.stepId === 'implement');
    expect(implement).toMatchObject({ attempt: 1, resumeSessionId: 'session-example-role' });
    // A role that stored no session has nothing to resume.
    const review = worker.requests.find((request) => request.stepId === 'review');
    expect(review?.resumeSessionId).toBeUndefined();
  });
});
