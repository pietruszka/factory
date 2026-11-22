import { afterEach, describe, expect, test } from 'vitest';

import { enterLoop, type LoopKind } from '../../src/run-state/loops.js';
import { cleanupRunStateTest, runStateFixture } from '../support/run-state.js';

afterEach(cleanupRunStateTest);

const KINDS: readonly LoopKind[] = ['fix', 'verify_fail', 'revision'];

describe('every retry or loop has a hard limit: loops', () => {
  test('a third fix, verify-fail or revision loop is refused as needs_human', () => {
    for (const kind of KINDS) {
      const state = runStateFixture();
      state.arrange('verifying');

      expect(enterLoop(state.context, 'run-1', kind), kind).toEqual({ allowed: true, count: 1 });
      expect(enterLoop(state.context, 'run-1', kind), kind).toEqual({ allowed: true, count: 2 });
      expect(state.status(), kind).toBe('verifying');
      expect(enterLoop(state.context, 'run-1', kind), kind).toEqual({ allowed: false, count: 3 });

      expect(state.status(), kind).toBe('needs_human');
    }
  });
});
