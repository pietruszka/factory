import { afterEach, describe, expect, test } from 'vitest';

import { createFakeDeps, type FakeDeps } from '../support/fake-deps.js';
import {
  createStopLimitSession,
  type CommandResult,
  type FailureSignature,
  type StopLimitSession,
} from '../support/stop-limits.js';
import { cleanupTempHomes } from '../support/temp-home.js';

afterEach(cleanupTempHomes);

const MINUTE = 60_000;
const OK: CommandResult = { exitCode: 0 };
const failure = (step: string, errorCode?: string): CommandResult => {
  const signature: FailureSignature = { status: 'needs_human', exitReason: 'exit_nonzero', step };
  return { exitCode: 1, signature, ...(errorCode === undefined ? {} : { errorCode }) };
};

/** Lets pending promise callbacks and timers registered by the code under test run. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

interface Harness {
  deps: FakeDeps;
  session: StopLimitSession;
  executed: string[][];
  killed: string[][];
}

/** A session whose commands take `durationMs` of injected time and then return the next scripted result. */
function harness(script: (call: number) => CommandResult, durationMs = 0): Harness {
  const deps = createFakeDeps();
  const executed: string[][] = [];
  const killed: string[][] = [];
  const session = createStopLimitSession({
    deps,
    exec: async (argv) => {
      executed.push([...argv]);
      if (durationMs > 0) await deps.sleep(durationMs);
      return script(executed.length);
    },
    kill: async (argv) => {
      killed.push([...argv]);
    },
  });
  return { deps, session, executed, killed };
}

/** Advances the injected clock a minute at a time until the promise settles. */
async function runClock<T>(deps: FakeDeps, promise: Promise<T>): Promise<T> {
  let done = false;
  void promise.finally(() => {
    done = true;
  });
  for (let minute = 0; minute < 120 && !done; minute += 1) {
    await settle();
    deps.advance(MINUTE);
  }
  return promise;
}

describe('stop limits are enforced', () => {
  test('three identical failures end the session with a report', async () => {
    const { session, executed } = harness(() => failure('implement'));

    const first = await session.run(['status', 'FE-123']);
    const second = await session.run(['status', 'FE-123']);
    const third = await session.run(['status', 'FE-123']);

    expect(first.kind).toBe('ran');
    expect(second.kind).toBe('ran');
    expect(third).toEqual({ kind: 'ended', reason: 'identical_failures' });
    expect(session.report()).toContain('identical');
    expect(session.report()).toContain('implement');
    // Once the session ended, nothing else is started.
    expect(await session.run(['status', 'FE-123'])).toMatchObject({ kind: 'ended' });
    expect(executed).toHaveLength(3);
  });

  test('failures with different signatures do not end the session', async () => {
    const steps = ['plan', 'implement', 'plan', 'implement'];
    const { session } = harness((call) => failure(steps[call - 1] ?? 'plan'));

    const outcomes = [];
    for (let i = 0; i < steps.length; i += 1) outcomes.push(await session.run(['status', 'FE-123']));

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(['ran', 'ran', 'ran', 'ran']);
  });

  test('a 21st command is refused', async () => {
    const { session, executed } = harness(() => OK);

    for (let i = 0; i < 20; i += 1) {
      expect(await session.run(['status', 'FE-123'])).toMatchObject({ kind: 'ran' });
    }
    const twentyFirst = await session.run(['status', 'FE-123']);

    expect(twentyFirst).toEqual({ kind: 'refused', reason: 'command_limit' });
    expect(executed).toHaveLength(20);
    expect(session.commandsStarted()).toBe(20);
  });

  test('a command over 10 minutes is stopped', async () => {
    const { deps, session, killed } = harness(() => OK, 30 * MINUTE);

    const running = session.run(['resume', 'FE-123'], { cause: 'budget' });
    await settle();
    deps.advance(10 * MINUTE - 1);
    await settle();
    expect(killed).toEqual([]);
    deps.advance(1);

    expect(await running).toEqual({ kind: 'stopped', reason: 'command_timeout' });
    expect(killed).toEqual([['resume', 'FE-123']]);
  });

  test('a session over 60 minutes is stopped', async () => {
    // Each command takes 9 minutes, so the 7th one is running when the hour is up (54 to 63 minutes).
    const { deps, session, executed, killed } = harness(() => OK, 9 * MINUTE);

    const outcomes = [];
    for (let i = 0; i < 7; i += 1) outcomes.push(await runClock(deps, session.run(['status', 'FE-123'])));

    expect(outcomes.slice(0, 6).map((outcome) => outcome.kind)).toEqual(Array(6).fill('ran'));
    expect(outcomes[6]).toEqual({ kind: 'ended', reason: 'session_timeout' });
    expect(killed).toEqual([['status', 'FE-123']]);
    expect(await session.run(['status', 'FE-123'])).toMatchObject({ kind: 'ended', reason: 'session_timeout' });
    expect(executed).toHaveLength(7);
  });

  test('a second resume for the same cause is refused, a resume for another cause is allowed', async () => {
    const { session, executed } = harness(() => OK);

    const first = await session.run(['resume', 'FE-123'], { cause: 'budget' });
    const again = await session.run(['resume', 'FE-123'], { cause: 'budget' });
    const other = await session.run(['resume', 'FE-123'], { cause: 'timeout' });

    expect(first.kind).toBe('ran');
    expect(again).toEqual({ kind: 'refused', reason: 'resume_limit' });
    expect(other.kind).toBe('ran');
    expect(executed).toHaveLength(2);
  });

  test('a command that failed with cli_error is retried at most once', async () => {
    const { session, executed } = harness(() => failure('plan', 'cli_error'));

    const first = await session.run(['status', 'FE-123']);
    const retry = await session.run(['status', 'FE-123']);
    const second = await session.run(['status', 'FE-123']);

    expect(first.kind).toBe('ran');
    expect(retry.kind).toBe('ran');
    expect(second).toEqual({ kind: 'refused', reason: 'retry_limit' });
    expect(executed).toHaveLength(2);
  });
});
