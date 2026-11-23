import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { parseEnvelope } from '../support/cli-harness.js';
import { cleanupRunStateTest, runStateFixture, type RunStateFixture } from '../support/run-state.js';
import {
  capOf,
  pointEnvAt,
  resumeCli,
  resumeCliDefault,
  resumeCliWithDefaultStages,
  seedCost,
  startedSteps,
  stoppedRun,
} from '../support/resume.js';
import { eventsOf } from '../support/worktree-fixture.js';
import { makeTempHome } from '../support/temp-home.js';
import { makeWorkRepo } from '../support/work-repo.js';

let previousFactoryHome: string | undefined;

beforeEach(() => {
  previousFactoryHome = process.env.FACTORY_HOME;
});

afterEach(async () => {
  if (previousFactoryHome === undefined) {
    delete process.env.FACTORY_HOME;
  } else {
    process.env.FACTORY_HOME = previousFactoryHome;
  }
  await cleanupRunStateTest();
});

/** `run-1` for example-frontend / FE-123, with HOME and FACTORY_HOME pointing at its temp folder. */
function setup(opts: Parameters<typeof runStateFixture>[0] = {}): RunStateFixture {
  const state = runStateFixture(opts);
  pointEnvAt(state);
  return state;
}

const stepRows = (state: RunStateFixture, step: string) =>
  state.rows('SELECT attempt, status FROM steps WHERE run_id = ? AND step = ? ORDER BY attempt', 'run-1', step);

describe('factory resume FE-123', () => {
  test('factory resume FE-123 continues a stopped run in its existing cache worktree and does not start a step that already has a done checkpoint', async () => {
    const state = setup();
    stoppedRun(state, {
      left: 'building',
      stop: 'killed',
      steps: [
        { step: 'prepare', status: 'done' },
        { step: 'implement', status: 'failed' },
      ],
    });
    const worker = state.scenarioRuntime('session-id');

    const run = await resumeCli(state, ['FE-123'], worker);

    expect(run.exitCode, run.stderr).toBe(0);
    expect(startedSteps(worker)[0]).toBe('implement');
    expect(startedSteps(worker)).not.toContain('prepare');
    expect(worker.requests[0]?.cwd).toBe(state.worktree);
    expect(stepRows(state, 'prepare')).toEqual([{ attempt: 1, status: 'done' }]);
    expect(stepRows(state, 'implement')).toEqual([
      { attempt: 1, status: 'failed' },
      { attempt: 2, status: 'done' },
    ]);
    // The worktree was reused, not created again.
    expect(eventsOf(state.fx.reader, 'run-1', 'worktree_created')).toHaveLength(1);
    expect(state.status()).toBe('passed');
  });

  test('factory resume FE-123 --from verify re-runs verify and later steps and keeps earlier done checkpoints', async () => {
    const state = setup();
    stoppedRun(state, {
      left: 'verifying',
      stop: 'killed',
      steps: [
        { step: 'prepare', status: 'done' },
        { step: 'implement', status: 'done' },
        { step: 'verify', status: 'done' },
      ],
    });
    const worker = state.scenarioRuntime('session-id');

    const run = await resumeCli(state, ['FE-123', '--from', 'verify'], worker);

    expect(run.exitCode, run.stderr).toBe(0);
    expect(startedSteps(worker)).toEqual(['verify', 'review']);
    expect(worker.requests[0]).toMatchObject({ stepId: 'verify', attempt: 2, cwd: state.worktree });
    expect(stepRows(state, 'prepare')).toEqual([{ attempt: 1, status: 'done' }]);
    expect(stepRows(state, 'implement')).toEqual([{ attempt: 1, status: 'done' }]);
    expect(stepRows(state, 'verify')).toEqual([
      { attempt: 1, status: 'done' },
      { attempt: 2, status: 'done' },
    ]);
  });

  test('the command with its own default stages accepts --from verify instead of refusing it as unknown', async () => {
    const state = setup();
    stoppedRun(state, {
      left: 'verifying',
      stop: 'killed',
      steps: [
        { step: 'implement', status: 'done' },
      ],
    });
    const worker = state.scenarioRuntime('session-id');

    const run = await resumeCliWithDefaultStages(state, ['FE-123', '--from', 'verify', '--json'], worker);

    expect(run.exitCode, run.stderr).toBe(0);
    expect(parseEnvelope(run).errors).toEqual([]);
    expect(startedSteps(worker)).toEqual([]);
    expect(state.status()).toBe('passed');
    expect(stepRows(state, 'implement')).toEqual([{ attempt: 1, status: 'done' }]);
  });

  test('an unknown --from step is refused with exit 2 and nothing is started', async () => {
    const state = setup();
    stoppedRun(state, { left: 'building', stop: 'killed' });
    const worker = state.scenarioRuntime('session-id');

    const run = await resumeCli(state, ['FE-123', '--from', 'no-such-step', '--json'], worker);

    expect(run.exitCode, run.stderr).toBe(2);
    expect(parseEnvelope(run).errors[0]?.message).toContain('no-such-step');
    expect(worker.requests).toEqual([]);
    expect(state.status()).toBe('killed');
  });
});

describe('factory resume refusals', () => {
  test('a missing ticket is refused with exit 2 and a message about the ticket', async () => {
    const state = setup();

    const run = await resumeCliDefault([], state.fx.repo.path);

    expect(run.exitCode, run.stderr).toBe(2);
    expect(run.stderr.toLowerCase()).toContain('ticket');
  });

  test('a ticket that is not a slug is refused with exit 2 and a message about the ticket', async () => {
    const state = setup();

    const run = await resumeCliDefault(['../FE-123'], state.fx.repo.path);

    expect(run.exitCode, run.stderr).toBe(2);
    expect(run.stderr.toLowerCase()).toContain('ticket');
  });

  test('a ticket with no run in this checkout is refused as run_not_found with exit 2 and nothing is started', async () => {
    const state = setup();
    stoppedRun(state, { left: 'building', stop: 'killed' });
    const worker = state.scenarioRuntime('session-id');

    const run = await resumeCli(state, ['FE-999', '--json'], worker);

    const envelope = parseEnvelope(run);
    expect(run.exitCode, run.stderr).toBe(2);
    expect(envelope.errors[0]?.code).toBe('run_not_found');
    expect(envelope.errors[0]?.next).toBeTruthy();
    expect(worker.requests).toEqual([]);
    expect(state.status()).toBe('killed');
  });

  test('a checkout that no repo config matches is refused as repo_config_missing with exit 2', async () => {
    const state = setup();
    stoppedRun(state, { left: 'building', stop: 'killed' });
    const other = makeWorkRepo(join(state.fx.sb.tmp, 'work', 'example-other'));

    const run = await resumeCliDefault(['FE-123', '--json'], other.path);

    expect(run.exitCode, run.stderr).toBe(2);
    expect(parseEnvelope(run).errors[0]?.code).toBe('repo_config_missing');
  });

  test('a folder that is not a git checkout is refused with exit 2, naming the folder and a next action', async () => {
    const state = setup();
    stoppedRun(state, { left: 'building', stop: 'killed' });
    const plain = makeTempHome();

    const run = await resumeCliDefault(['FE-123', '--json'], plain);

    const envelope = parseEnvelope(run);
    expect(run.exitCode, run.stderr).toBe(2);
    expect(envelope.errors[0]?.message).toContain(plain);
    expect(envelope.errors[0]?.next).toBeTruthy();
  });

  test.each(['passed', 'refused', 'breach'] as const)(
    'a run that is %s cannot be resumed: exit 2, the message names the status, nothing is started and the status is unchanged',
    async (stop) => {
      const state = setup();
      stoppedRun(state, { left: 'building', stop });
      const worker = state.scenarioRuntime('session-id');

      const run = await resumeCli(state, ['FE-123', '--json'], worker);

      const envelope = parseEnvelope(run);
      expect(run.exitCode, run.stderr).toBe(2);
      expect(envelope.errors[0]?.code).not.toBe('internal_error');
      expect(envelope.errors[0]?.message).toContain(stop);
      expect(envelope.errors[0]?.next).toBeTruthy();
      expect(worker.requests).toEqual([]);
      expect(state.status()).toBe(stop);
    },
  );
});

describe('factory resume --cap', () => {
  test('factory resume FE-123 --cap +$2 raises cap_usd_effective by 2 and does not raise it when --cap is omitted', async () => {
    const state = setup({ run: { cap_usd_effective: 5 } });
    stoppedRun(state, { left: 'building', stop: 'killed', steps: [{ step: 'prepare', status: 'done' }] });

    // Without --cap the cap stays as it was; this attempt fails, so the run stops and can be resumed again.
    await resumeCli(state, ['FE-123'], state.scenarioRuntime('fail'));
    expect(capOf(state)).toBe(5);
    expect(state.status()).toBe('needs_human');

    const run = await resumeCli(state, ['FE-123', '--cap', '+$2'], state.scenarioRuntime('session-id'));

    expect(run.exitCode, run.stderr).toBe(0);
    expect(capOf(state)).toBe(7);
  });

  test.each(['2', '$2', '-$2', '+$x'])(
    'a --cap value of %s is not a plus sign and a dollar amount: it is refused with exit 2 and the cap is unchanged',
    async (value) => {
      const state = setup({ run: { cap_usd_effective: 5 } });
      stoppedRun(state, { left: 'building', stop: 'killed' });
      const worker = state.scenarioRuntime('session-id');

      const run = await resumeCli(state, ['FE-123', `--cap=${value}`], worker);

      expect(run.exitCode, run.stderr).toBe(2);
      expect(capOf(state)).toBe(5);
      expect(worker.requests).toEqual([]);
    },
  );

  test('when the dollar cap is already reached and --cap is omitted, resume refuses and names the amount spent', async () => {
    const state = setup({ run: { cap_usd_effective: 2.5 } });
    stoppedRun(state, { left: 'building', stop: 'budget', steps: [{ step: 'implement', status: 'failed' }] });
    seedCost(state, 'implement', 1, 1.25);
    seedCost(state, 'implement', 2, 1.75);
    const worker = state.scenarioRuntime('session-id');

    const run = await resumeCli(state, ['FE-123', '--json'], worker);

    const envelope = parseEnvelope(run);
    expect(run.exitCode, run.stderr).toBe(2);
    expect(envelope.errors[0]?.message).toContain('$3.00');
    expect(envelope.errors[0]?.next).toContain('--cap');
    expect(worker.requests).toEqual([]);
    expect(state.status()).toBe('budget');
    expect(capOf(state)).toBe(2.5);
  });
});
