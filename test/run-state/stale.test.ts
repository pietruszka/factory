import { afterEach, describe, expect, test, vi } from 'vitest';

import { createFakeProcessTable } from '../../src/ports/process-table.js';
import { markStaleRuns } from '../../src/run-state/stale.js';
import { cleanupRunStateTest, PHASE_ORDER, runStateFixture, type RunStateFixture } from '../support/run-state.js';

afterEach(async () => {
  vi.restoreAllMocks();
  await cleanupRunStateTest();
});

const COMMAND = 'agent --example-flag';

/** A run in `building` with one recorded child (pid 4242) that has not ended. */
function buildingWithChild(): RunStateFixture {
  const state = runStateFixture();
  state.arrange('building');
  state.fx.log.appendProcess({ run_id: 'run-1', step: 'implement', pid: 4242, command: COMMAND });
  return state;
}

describe('a run whose process is gone or whose pid no longer matches is marked interrupted', () => {
  test('when the recorded pid is gone, the run is moved to interrupted and is not left in a phase', async () => {
    const state = buildingWithChild();
    const processTable = createFakeProcessTable();

    const marked = await markStaleRuns({ ...state.context, processTable });

    expect(marked).toEqual(['run-1']);
    expect(state.status()).toBe('interrupted');
    expect(PHASE_ORDER).not.toContain(state.status());
  });

  test('when the pid exists but ProcessTable.stillMatches is false, the run is moved to interrupted and the pid is not signalled', async () => {
    const state = buildingWithChild();
    const processTable = createFakeProcessTable();
    processTable.record({ pid: 4242, command: COMMAND, startedAt: 0 });
    processTable.plantRecycledPid(4242, 'sleep 100');
    const signal = vi.spyOn(process, 'kill');

    const marked = await markStaleRuns({ ...state.context, processTable });

    expect(marked).toEqual(['run-1']);
    expect(state.status()).toBe('interrupted');
    expect(signal).not.toHaveBeenCalled();
  });

  test('when the pid still matches its command, the run is left as it is', async () => {
    const state = buildingWithChild();
    const processTable = createFakeProcessTable();
    processTable.record({ pid: 4242, command: COMMAND, startedAt: 0 });

    const marked = await markStaleRuns({ ...state.context, processTable });

    expect(marked).toEqual([]);
    expect(state.status()).toBe('building');
  });
});

describe('a repeated library command does not duplicate state or side effects: stale runs', () => {
  test('marking an already interrupted run stale again leaves a single interrupted status', async () => {
    const state = buildingWithChild();
    const processTable = createFakeProcessTable();
    await markStaleRuns({ ...state.context, processTable });
    const events = state.rows('SELECT id FROM events').length;
    const processes = state.rows('SELECT id, ended_at FROM processes');
    const run = state.rows('SELECT status, ended_at FROM runs');
    state.fx.deps.advance(5_000);

    await markStaleRuns({ ...state.context, processTable });

    expect(state.rows('SELECT status, ended_at FROM runs')).toEqual(run);
    expect(state.rows('SELECT status FROM runs')).toEqual([{ status: 'interrupted' }]);
    expect(state.rows('SELECT id FROM events')).toHaveLength(events);
    expect(state.rows('SELECT id, ended_at FROM processes')).toEqual(processes);
  });
});
