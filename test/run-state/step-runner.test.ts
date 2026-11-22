import { mkdirSync } from 'node:fs';
import { afterEach, describe, expect, test } from 'vitest';

import type { StepRequest } from '../../src/worker-runtime/types.js';
import { runSteps, type RunStepsOptions } from '../../src/run-state/step-runner.js';
import {
  childRecorded,
  cleanupRunStateTest,
  runStateFixture,
  stepSpec,
  STOP_STATUSES,
  type InstrumentedRuntime,
  type RunStateFixture,
} from '../support/run-state.js';

afterEach(cleanupRunStateTest);

/** A run in `building` with an existing worktree folder, and the options for steps in that phase. */
function building(scenario: string, onStart?: (state: RunStateFixture, request: StepRequest) => void) {
  const state = runStateFixture();
  mkdirSync(state.worktree, { recursive: true });
  state.arrange('building');
  const worker: InstrumentedRuntime = state.scenarioRuntime(scenario, (request) => onStart?.(state, request));
  const options = (steps: RunStepsOptions['steps']): RunStepsOptions => ({
    ...state.context,
    runtime: worker.runtime,
    runId: 'run-1',
    phase: 'building',
    cwd: state.worktree,
    steps,
  });
  return { state, worker, options };
}

const STEP_ROWS = 'SELECT step, attempt, status, exit_reason, input_hash, cli_session_id FROM steps ORDER BY step, attempt';

describe('a finished step is checkpointed before the next step starts', () => {
  test('after a step finishes, a steps row records its status, input hash and session id (when present) before the next step starts', async () => {
    const snapshots: Array<Array<Record<string, unknown>>> = [];
    const { state, options } = building('session-id', (current, request) => {
      if (request.stepId === 'second') {
        snapshots.push(
          current.rows("SELECT step, status, input_hash, cli_session_id FROM steps WHERE step = 'first'"),
        );
      }
    });

    await runSteps(options([stepSpec('first'), stepSpec('second', { prompt: 'A different prompt.' })]));

    expect(snapshots).toEqual([
      [{ step: 'first', status: 'done', input_hash: expect.stringMatching(/\S/), cli_session_id: 'session-example-1' }],
    ]);
    const rows = state.rows(STEP_ROWS);
    expect(rows.map((row) => row.step)).toEqual(['first', 'second']);
    expect(rows[0]?.input_hash).not.toBe(rows[1]?.input_hash);
  });

  test('a continue from that run does not redo the checkpointed step', async () => {
    const { state, worker, options } = building('session-id');
    await runSteps(options([stepSpec('first')]));
    state.arrange('interrupted');

    const outcome = await runSteps(options([stepSpec('first'), stepSpec('second')]));

    expect(outcome.skipped).toEqual(['first']);
    expect(outcome.ran).toEqual(['second']);
    expect(worker.requests.map((request) => request.stepId)).toEqual(['first', 'second']);
    expect(state.rows(STEP_ROWS).map((row) => [row.step, row.status])).toEqual([
      ['first', 'done'],
      ['second', 'done'],
    ]);
  });
});

describe('every retry or loop has a hard limit: structured output and workers', () => {
  test('malformed structured output is retried exactly once, then the step is schema_invalid and the run becomes needs_human', async () => {
    const { state, worker, options } = building('malformed-twice');

    const outcome = await runSteps(options([stepSpec('implement', { outputSchema: { type: 'object' } })]));

    expect(worker.requests.map((request) => request.attempt)).toEqual([1, 2]);
    expect(outcome.status).toBe('needs_human');
    expect(state.status()).toBe('needs_human');
    const last = state.rows(STEP_ROWS).at(-1);
    expect(last).toMatchObject({ step: 'implement', status: 'failed', exit_reason: 'schema_invalid' });
  });

  test('the retry attaches the parse error and resumes the session when there is one', async () => {
    const { worker, options } = building('malformed-twice-session');

    await runSteps(options([stepSpec('implement', { outputSchema: { type: 'object' } })]));

    const parseError = worker.results[0]?.parseError;
    expect(parseError).toMatch(/\S/);
    expect(worker.requests[1]?.prompt).toContain(parseError);
    expect(worker.requests[1]?.resumeSessionId).toBe('session-example-1');
  });

  test('a retry that returns valid JSON finishes the step and leaves the run in its phase', async () => {
    const { state, worker, options } = building('malformed-once');

    const outcome = await runSteps(options([stepSpec('implement', { outputSchema: { type: 'object' } })]));

    expect(worker.requests).toHaveLength(2);
    expect(outcome.status).toBe('building');
    expect(state.rows(STEP_ROWS).at(-1)).toMatchObject({ step: 'implement', status: 'done' });
  });

  test('a fake worker that never succeeds does not loop forever', async () => {
    const { state, worker, options } = building('fail');

    const outcome = await runSteps(options([stepSpec('implement')]));

    expect(worker.requests.length).toBeGreaterThanOrEqual(1);
    expect(worker.requests.length).toBeLessThanOrEqual(3);
    expect(STOP_STATUSES).toContain(outcome.status);
    expect(state.status()).toBe(outcome.status);
  });

  test('a hanging worker is stopped by timeoutMs and the run becomes timeout', async () => {
    const { state, options } = building('hang');
    const pending = runSteps(options([stepSpec('implement', { timeoutMs: 30_000 })]));
    pending.catch(() => undefined);

    await Promise.race([pending, childRecorded(state)]);
    state.fx.deps.advance(30_000);
    const outcome = await pending;

    expect(outcome.status).toBe('timeout');
    expect(state.status()).toBe('timeout');
    expect(state.rows(STEP_ROWS).at(-1)).toMatchObject({ step: 'implement', status: 'failed', exit_reason: 'timeout' });
  });
});

describe('a repeated library command does not duplicate state or side effects: steps', () => {
  test('continuing a run whose current step is already done does not run the worker again or add a second process row for that step', async () => {
    const { state, worker, options } = building('session-id');
    await runSteps(options([stepSpec('implement')]));
    const processRows = state.rows("SELECT id FROM processes WHERE step = 'implement'");
    expect(processRows).toHaveLength(1);

    const outcome = await runSteps(options([stepSpec('implement')]));

    expect(outcome.ran).toEqual([]);
    expect(outcome.skipped).toEqual(['implement']);
    expect(worker.requests).toHaveLength(1);
    expect(state.rows("SELECT id FROM processes WHERE step = 'implement'")).toEqual(processRows);
    expect(state.rows(STEP_ROWS)).toHaveLength(1);
  });
});
