import { afterEach, describe, expect, test } from 'vitest';

import type { RunStatus } from '../../src/run-state/context.js';
import { transition } from '../../src/run-state/transition.js';
import { errorFields, thrownBy } from '../support/event-log.js';
import {
  cleanupRunStateTest,
  driveStubPipeline,
  makePassable,
  PHASE_ORDER,
  runStateFixture,
  STOP_STATUSES,
} from '../support/run-state.js';
import { expectRefusal } from '../support/worktree-fixture.js';

afterEach(cleanupRunStateTest);

describe('only legal transitions are allowed and every run ends in a terminal or stop status', () => {
  test('a happy-path transition along the phase order is allowed', () => {
    const state = runStateFixture();

    for (const to of PHASE_ORDER.slice(1)) {
      transition(state.context, 'run-1', to);

      expect(state.status()).toBe(to);
    }
  });

  test('an out-of-order or terminal-to-phase transition is refused as illegal_transition (or the planned code), exit 2, and the stored status is unchanged', () => {
    const state = runStateFixture();
    const illegal: Array<[from: string, to: RunStatus]> = [
      ['preflight', 'building'],
      ['planning', 'opening_pr'],
      ['building', 'planning'],
      ['awaiting_approval', 'gating'],
      ['building', 'passed'],
      ['passed', 'building'],
      ['passed', 'needs_human'],
      ['refused', 'planning'],
      ['breach', 'building'],
    ];

    for (const [from, to] of illegal) {
      state.arrange(from);

      expectRefusal(() => transition(state.context, 'run-1', to), ['illegal_transition']);

      expect(state.status(), `${from} -> ${to}`).toBe(from);
    }
  });

  test('a stopped run can continue back into the phase it left, and into no other phase', () => {
    for (const stop of ['interrupted', 'timeout', 'needs_human'] as const) {
      const state = runStateFixture();
      state.arrange('verifying');
      transition(state.context, 'run-1', stop);

      expectRefusal(() => transition(state.context, 'run-1', 'building'), ['illegal_transition']);
      expect(state.status(), stop).toBe(stop);

      transition(state.context, 'run-1', 'verifying');
      expect(state.status(), stop).toBe('verifying');
    }
  });

  test('passed is refused when canPassFromReport is false, and allowed from opening_pr when it is true', () => {
    const state = runStateFixture();
    state.arrange('opening_pr');

    const refused = errorFields(thrownBy(() => transition(state.context, 'run-1', 'passed')));

    expect(refused.isFactoryError, refused.message).toBe(true);
    expect(refused.exitCode).toBe(2);
    expect(refused.next).toMatch(/\S/);
    expect(state.status()).toBe('opening_pr');

    makePassable(state);
    transition(state.context, 'run-1', 'passed');

    expect(state.status()).toBe('passed');
  });

  test('a run driven by the step runner is not left in a phase: it ends as passed or as a stop status', async () => {
    const succeeded = runStateFixture();
    const failed = runStateFixture();

    const good = await driveStubPipeline(succeeded, 'edits');
    const bad = await driveStubPipeline(failed, 'fail');

    expect(good.final).toBe('passed');
    expect(succeeded.status()).toBe('passed');
    expect(STOP_STATUSES).toContain(bad.final);
    expect(failed.status()).toBe(bad.final);
    expect(PHASE_ORDER).not.toContain(failed.status());
  });
});

describe('a repeated library command does not duplicate state or side effects: transitions', () => {
  test('transitioning again to the current status is a no-op and does not write a duplicate history', () => {
    for (const [from, to] of [
      ['planning', 'planning'],
      ['building', 'needs_human'],
    ] as const) {
      const state = runStateFixture();
      state.arrange(from);
      transition(state.context, 'run-1', to);
      const eventCount = state.rows('SELECT id FROM events').length;
      const run = state.rows('SELECT status, ended_at FROM runs');
      state.fx.deps.advance(5_000);

      transition(state.context, 'run-1', to);

      expect(state.rows('SELECT id FROM events'), `${from} -> ${to}`).toHaveLength(eventCount);
      expect(state.rows('SELECT status, ended_at FROM runs')).toEqual(run);
      expect(state.status()).toBe(to);
    }
  });
});
