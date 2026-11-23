import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { approvalHash, writeProgress } from '../../src/run-folder/progress.js';
import { cleanupRunStateTest, putFile, runStateFixture, type RunStateFixture } from '../support/run-state.js';

afterEach(cleanupRunStateTest);

const PLAN = '# Plan\n\n## Steps\n\n1. Add a heading to the example page.\n2. Add a test for it.\n';

/** `run-1` with a plan.md in its run folder; returns the file text. */
function withPlan(state: RunStateFixture): string {
  putFile(state.runFolder, 'plan.md', PLAN);
  return readFileSync(join(state.runFolder, 'plan.md'), 'utf8');
}

const progress = (state: RunStateFixture, current: string, done: string[], last: string) =>
  writeProgress({
    env: state.fx.sb.env,
    repo: 'example-frontend',
    ticket: 'FE-123',
    progress: { currentStep: current, doneSteps: done, lastResult: last },
  });

describe('the plan approval hash', () => {
  test('writing the pipeline progress section (current step, done steps, last result) does not change the plan approval hash', () => {
    const state = runStateFixture();
    const before = withPlan(state);
    const hashBefore = approvalHash(before);

    progress(state, 'implement', ['prepare'], 'ok');
    const first = readFileSync(join(state.runFolder, 'plan.md'), 'utf8');
    progress(state, 'verify', ['prepare', 'implement'], 'exit_nonzero');
    const second = readFileSync(join(state.runFolder, 'plan.md'), 'utf8');

    // The file did change, and it names the progress that was written ...
    expect(first).not.toBe(before);
    expect(first).toContain('implement');
    expect(second).not.toBe(first);
    expect(second).toContain('exit_nonzero');
    // ... and still every version has the same approval hash.
    expect(approvalHash(first)).toBe(hashBefore);
    expect(approvalHash(second)).toBe(hashBefore);
    // The hash is a sha256 in hex.
    expect(hashBefore).toMatch(/^[0-9a-f]{64}$/);
  });

  test('editing any other part of plan.md does change the plan approval hash', () => {
    const state = runStateFixture();
    const before = withPlan(state);
    progress(state, 'implement', ['prepare'], 'ok');
    const withProgress = readFileSync(join(state.runFolder, 'plan.md'), 'utf8');

    const editedStep = withProgress.replace('Add a test for it.', 'Add two tests for it.');
    const editedTitle = withProgress.replace('# Plan', '# Plan v2');

    expect(editedStep).not.toBe(withProgress);
    expect(approvalHash(editedStep)).not.toBe(approvalHash(before));
    expect(approvalHash(editedTitle)).not.toBe(approvalHash(before));
    expect(approvalHash(editedStep)).not.toBe(approvalHash(editedTitle));
  });

  test('when plan.md does not exist yet, writing progress creates a file that holds only the progress section', () => {
    const state = runStateFixture();

    progress(state, 'prepare', [], 'none yet');

    const text = readFileSync(join(state.runFolder, 'plan.md'), 'utf8');
    expect(text).toContain('prepare');
    expect(approvalHash(text)).toBe(approvalHash(''));
  });
});
