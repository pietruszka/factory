import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';

import { runCapture, parseEnvelope } from '../support/cli-harness.js';
import { allGone, startWorkerInRun } from '../support/kill.js';
import { cleanupRunStateTest, runStateFixture, type RunStateFixture } from '../support/run-state.js';
import { eventsOf } from '../support/worktree-fixture.js';
import { makeWorkRepo } from '../support/work-repo.js';
import { makeTempHome } from '../support/temp-home.js';

let previousFactoryHome: string | undefined;

beforeEach(() => {
  previousFactoryHome = process.env.FACTORY_HOME;
});

afterEach(async () => {
  vi.restoreAllMocks();
  if (previousFactoryHome === undefined) {
    delete process.env.FACTORY_HOME;
  } else {
    process.env.FACTORY_HOME = previousFactoryHome;
  }
  await cleanupRunStateTest();
});

/** `run-1` for example-frontend / FE-123, with HOME and FACTORY_HOME pointing at its temp folder. */
function setup(): RunStateFixture {
  const state = runStateFixture();
  process.env.HOME = state.fx.sb.tmp;
  process.env.FACTORY_HOME = state.fx.sb.home;
  return state;
}

/** Runs `factory kill ...` from inside the disposable example-frontend checkout. */
const kill = (state: RunStateFixture, args: string[], cwd = state.fx.repo.path) =>
  runCapture(['kill', ...args], { cwd });

const killedEvents = (state: RunStateFixture) => eventsOf(state.fx.reader, 'run-1', 'killed');

/** Signals other than the existence check (0) sent through process.kill. */
const signalsSent = (signal: { mock: { calls: unknown[][] } }) =>
  signal.mock.calls.filter((call) => call[1] !== 0);

describe('factory kill FE-123', () => {
  test("factory kill FE-123 in a checkout of example-frontend stops a running run's process tree, records a killed event and runs.status killed, and leaves the worktree on disk", async () => {
    const state = setup();
    const worker = await startWorkerInRun(state, 'children', 2);

    const run = await kill(state, ['FE-123']);

    expect(run.exitCode).toBe(0);
    await allGone([worker.pid, ...worker.descendants]);
    expect(state.status()).toBe('killed');
    expect(killedEvents(state)).toHaveLength(1);
    expect(existsSync(state.worktree)).toBe(true);
    await worker.step.result;
  }, 20_000);

  test('the success output names the ticket, that the worktree was kept, the run folder path, and factory resume FE-123 as the next command', async () => {
    const state = setup();
    const worker = await startWorkerInRun(state, 'hang');

    const run = await kill(state, ['FE-123', '--json']);

    const envelope = parseEnvelope(run);
    expect(envelope).toMatchObject({ command: 'kill', ok: true, exit_code: 0, next_command: 'factory resume FE-123' });
    // With --json the human text goes to stderr.
    expect(run.stderr).toContain('FE-123');
    expect(run.stderr.toLowerCase()).toMatch(/worktree.*kept|kept.*worktree/);
    expect(run.stderr).toContain(join(state.fx.sb.home, 'runs', 'example-frontend', 'FE-123'));
    await worker.step.result;
  }, 20_000);

  test('a second kill on an already-killed run with no live matching pids exits 0, signals nothing, and keeps the worktree', async () => {
    const state = setup();
    const worker = await startWorkerInRun(state, 'hang');
    expect((await kill(state, ['FE-123'])).exitCode).toBe(0);
    await worker.step.result;
    const signal = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const second = await kill(state, ['FE-123']);

    expect(second.exitCode).toBe(0);
    expect(signalsSent(signal)).toEqual([]);
    expect(state.status()).toBe('killed');
    expect(existsSync(state.worktree)).toBe(true);
  }, 20_000);
});

describe('factory kill refusals', () => {
  test('a missing ticket is refused with exit 2 and a message about the ticket', async () => {
    const state = setup();

    const run = await kill(state, []);

    expect(run.exitCode).toBe(2);
    expect(run.stderr.toLowerCase()).toContain('ticket');
  });

  test('a second ticket is refused with exit 2 and a message about the ticket', async () => {
    const state = setup();

    const run = await kill(state, ['FE-123', 'FE-124']);

    expect(run.exitCode).toBe(2);
    expect(run.stderr.toLowerCase()).toContain('ticket');
  });

  test('a ticket that is not a slug is refused with exit 2 and a message about the ticket', async () => {
    const state = setup();

    const run = await kill(state, ['../FE-123']);

    expect(run.exitCode).toBe(2);
    expect(run.stderr.toLowerCase()).toContain('ticket');
  });

  test('a ticket with no run in this checkout is refused as run_not_found with exit 2 and nothing is signalled', async () => {
    const state = setup();
    state.arrange('building');
    const signal = vi.spyOn(process, 'kill').mockImplementation(() => true);

    const run = await kill(state, ['FE-999', '--json']);

    const envelope = parseEnvelope(run);
    expect(run.exitCode).toBe(2);
    expect(envelope.errors[0]?.code).toBe('run_not_found');
    expect(envelope.errors[0]?.next).toBeTruthy();
    expect(signalsSent(signal)).toEqual([]);
    expect(state.status()).toBe('building');
  });

  test('a checkout that no repo config matches is refused as repo_config_missing with exit 2', async () => {
    const state = setup();
    const other = makeWorkRepo(join(state.fx.sb.tmp, 'work', 'example-other'));

    const run = await kill(state, ['FE-123', '--json'], other.path);

    expect(run.exitCode).toBe(2);
    expect(parseEnvelope(run).errors[0]?.code).toBe('repo_config_missing');
  });

  test('a folder that is not a git checkout is refused with exit 2, naming the folder and a next action', async () => {
    const state = setup();
    const plain = makeTempHome();

    const run = await kill(state, ['FE-123', '--json'], plain);

    const envelope = parseEnvelope(run);
    expect(run.exitCode).toBe(2);
    expect(envelope.errors[0]?.message).toContain(plain);
    expect(envelope.errors[0]?.next).toBeTruthy();
  });
});
