import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { parseEnvelope } from '../support/cli-harness.js';
import { cleanupDevRunTest, devRunFixture } from '../support/dev-run.js';

afterEach(cleanupDevRunTest);

describe('the runbook contract at L3', () => {
  test('a fake-worker run reaches awaiting_approval, is dev-approved, and reaches a final status', async () => {
    // A temp home with the throwaway marker and the unpacked sample; no human, no live worker, no sample install.
    const run = await devRunFixture();
    expect(existsSync(join(run.factoryHome, '.factory-dev-home'))).toBe(true);
    expect(run.repoPath).toBe(join(run.factoryHome, 'cache', 'sandbox', 'todo-app'));

    expect(await run.plan()).toBe('awaiting_approval');
    expect(run.status()).toBe('awaiting_approval');
    expect(run.approvals()).toEqual([]);

    const approved = await run.devApprove(['FE-123']);
    expect(approved.exitCode, approved.stderr).toBe(0);
    expect(parseEnvelope(approved)).toMatchObject({ command: 'dev-approve', ok: true, exit_code: 0 });
    expect(run.approvals()).toHaveLength(1);

    const final = await run.build();

    expect(final).toBe('passed');
    expect(run.status()).toBe('passed');
    expect(existsSync(join(run.runFolder, 'report.md'))).toBe(true);
  });
});
