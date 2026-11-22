import { afterEach, describe, expect, test } from 'vitest';

import { startRun } from '../../src/run-state/start.js';
import { runInput } from '../support/event-log.js';
import { cleanupRunStateTest, runStateFixture } from '../support/run-state.js';
import { expectRefusal } from '../support/worktree-fixture.js';

afterEach(cleanupRunStateTest);

describe('a second active run for the same ticket and repo is refused', () => {
  test('starting a second run for the same repo and ticket while the first is non-terminal is refused as run_already_active, exit 2, with a next action, and no second run row is written', () => {
    const state = runStateFixture();

    expectRefusal(() => startRun(state.context, runInput({ run_id: 'run-2', base_commit: state.fx.repo.baseCommit })), [
      'run_already_active',
    ]);

    expect(state.rows('SELECT run_id FROM runs')).toEqual([{ run_id: 'run-1' }]);
  });

  test('a run is started when the first run for the same repo and ticket has passed', () => {
    const state = runStateFixture();
    state.arrange('passed');

    const started = startRun(state.context, runInput({ run_id: 'run-2', base_commit: state.fx.repo.baseCommit }));

    expect(started).toEqual({ run_id: 'run-2' });
    expect(state.rows('SELECT run_id FROM runs ORDER BY run_id')).toEqual([{ run_id: 'run-1' }, { run_id: 'run-2' }]);
  });
});
