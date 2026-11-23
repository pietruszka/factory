import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { approvalHash, approvedContent, writeProgress } from '../../src/run-folder/progress.js';
import { parseEnvelope } from '../support/cli-harness.js';
import { cleanupDevRunTest, devRunFixture, type DevRun, type DevRunOptions } from '../support/dev-run.js';

afterEach(cleanupDevRunTest);

/** A run that is awaiting approval, with the CLI environment pointing at its home. */
async function awaiting(options: DevRunOptions = {}): Promise<DevRun> {
  const run = await devRunFixture(options);
  expect(await run.plan()).toBe('awaiting_approval');
  return run;
}

/** The stub plan.md text the stub pipeline writes, as a literal. */
const STUB_PLAN = '# Plan\n\nA stub plan.\n';
const sha256 = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

/** Runs dev-approve and checks it was refused with exit 2, with no approvals row and no new event row. */
async function expectRefused(run: DevRun, expectedCode?: string): Promise<void> {
  const eventsBefore = run.eventCount();

  const result = await run.devApprove();

  expect(result.exitCode, result.stderr).toBe(2);
  const envelope = parseEnvelope(result);
  expect(envelope.ok).toBe(false);
  expect(envelope.exit_code).toBe(2);
  const error = envelope.errors[0];
  expect(error?.code).not.toBe('internal_error');
  if (expectedCode !== undefined) expect(error?.code).toBe(expectedCode);
  expect(error?.where).toMatch(/\S/);
  expect(error?.next).toMatch(/\S/);
  expect(run.approvals()).toEqual([]);
  expect(run.eventCount()).toBe(eventsBefore);
  expect(run.status()).toBe('awaiting_approval');
}

describe('factory dev-approve refuses outside a throwaway home and the sandbox', () => {
  test('refuses on a factory home without the throwaway marker', async () => {
    const run = await awaiting({ home: 'unmarked' });

    await expectRefused(run);
  });

  test('refuses when the run is not the sandbox repo', async () => {
    const run = await awaiting({ repo: 'elsewhere' });

    await expectRefused(run);
  });

  test('refuses the default factory home even when FACTORY_HOME names it and it has the marker', async () => {
    const run = await awaiting({ home: 'default' });

    await expectRefused(run);
  });

  test('refuses when FACTORY_HOME is not set', async () => {
    const run = await awaiting({ home: 'unset' });

    await expectRefused(run);
  });

  test('refuses a run whose worker is not the fake worker', async () => {
    const run = await awaiting();
    run.recordOtherWorker();

    await expectRefused(run);
  });

  test('refuses a ticket that is not a slug and a missing ticket, with exit 2', async () => {
    const run = await awaiting();

    for (const args of [['../FE-123'], []]) {
      const result = await run.devApprove(args);

      expect(result.exitCode).toBe(2);
      expect(parseEnvelope(result).errors[0]?.code).not.toBe('internal_error');
    }
    expect(run.approvals()).toEqual([]);
  });
});

describe('factory dev-approve records an approval in a throwaway home', () => {
  test('records an approval for a sandbox run in a throwaway home', async () => {
    const run = await awaiting();
    const planPath = join(run.runFolder, 'plan.md');
    expect(readFileSync(planPath, 'utf8')).toBe(STUB_PLAN);

    const result = await run.devApprove();

    expect(result.exitCode, result.stderr).toBe(0);
    expect(parseEnvelope(result)).toMatchObject({ command: 'dev-approve', ok: true, exit_code: 0 });
    const approvals = run.approvals();
    expect(approvals).toHaveLength(1);
    expect(approvals[0]).toMatchObject({
      run_id: 'run-1',
      hash_algo: 'sha256',
      approver: 'agent-debug',
      client: 'dev-harness',
      plan_hash: approvalHash(readFileSync(planPath, 'utf8')),
    });
    // The same hash, worked out from the literal plan text.
    expect(approvals[0]?.plan_hash).toBe(sha256(STUB_PLAN));
  });

  test('the recorded approval is one the stub build accepts, and the run reaches a final status', async () => {
    const run = await awaiting();
    expect((await run.devApprove()).exitCode).toBe(0);

    const final = await run.build();

    expect(final).toBe('passed');
    expect(run.status()).toBe('passed');
  });

  test('a later edit to plan.md does not match the stored hash, but a progress-section change does', async () => {
    const run = await awaiting();
    const planPath = join(run.runFolder, 'plan.md');
    expect((await run.devApprove()).exitCode).toBe(0);
    const stored = String(run.approvals()[0]?.plan_hash);

    // The pipeline's own progress section is not part of the approved text.
    writeProgress({
      env: run.context.env,
      repo: run.repoName,
      ticket: 'FE-123',
      progress: { currentStep: 'implement', doneSteps: ['plan'], lastResult: 'ok' },
    });
    expect(approvalHash(readFileSync(planPath, 'utf8'))).toBe(stored);

    // A change to the plan itself is.
    appendFileSync(planPath, '\nAn extra step.\n');
    expect(approvedContent(readFileSync(planPath, 'utf8'))).not.toBe(STUB_PLAN);
    expect(approvalHash(readFileSync(planPath, 'utf8'))).not.toBe(stored);
  });
});
