import { chmodSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { openEventLog, openEventLogReadOnly } from '../../src/event-log/open.js';
import { createRunFolder } from '../../src/run-folder/create.js';
import { writeEvidenceDiff } from '../../src/run-folder/evidence.js';
import { savePrompt } from '../../src/run-folder/prompts.js';
import { writeReport } from '../../src/run-folder/report.js';
import { createFakeDeps } from '../support/fake-deps.js';
import { cleanupEventLogTest, eventLogSandbox, runInput, track } from '../support/event-log.js';

afterEach(cleanupEventLogTest);

const SUBDIRECTORIES = ['context', 'evidence', 'evidence/gates', 'prompts', 'verify'];

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe('run folder permissions', () => {
  test('a new run folder and its subdirectories are mode 0700', () => {
    const sb = eventLogSandbox();

    const folder = createRunFolder({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123' });

    const modes = [folder, ...SUBDIRECTORIES.map((sub) => join(folder, sub))].map(modeOf);
    expect(modes).toEqual([0o700, 0o700, 0o700, 0o700, 0o700, 0o700]);
  });

  test('report.md, a prompt file and evidence/diff.patch are mode 0600 after they are written', () => {
    const sb = eventLogSandbox();
    const writer = track(openEventLog({ env: sb.env, deps: createFakeDeps() }));
    writer.insertRun(runInput({ status: 'awaiting_approval', ended_at: '2026-01-01T10:12:30.000Z', started_at: '2026-01-01T10:00:00.000Z' }));
    const reader = track(openEventLogReadOnly({ env: sb.env }));
    const folder = createRunFolder({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123' });

    const promptPath = savePrompt({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123', step: 'builder', prompt: 'text' });
    const diffPath = writeEvidenceDiff({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123', diff: 'diff text\n' });
    const reportPath = writeReport({
      env: sb.env,
      log: reader,
      runId: 'run-1',
      worktreePath: join(sb.home, 'cache', 'worktrees', 'example-frontend', 'FE-123'),
    });

    expect(reportPath).toBe(join(folder, 'report.md'));
    expect([modeOf(reportPath), modeOf(promptPath), modeOf(diffPath)]).toEqual([0o600, 0o600, 0o600]);
  });

  test('an existing run directory at 0755 is tightened to 0700 on createRunFolder', () => {
    const sb = eventLogSandbox();
    const folder = join(sb.home, 'runs', 'example-frontend', 'FE-123');
    mkdirSync(join(folder, 'evidence'), { recursive: true });
    chmodSync(folder, 0o755);
    chmodSync(join(folder, 'evidence'), 0o755);
    expect([modeOf(folder), modeOf(join(folder, 'evidence'))]).toEqual([0o755, 0o755]);

    createRunFolder({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123' });

    expect(modeOf(folder)).toBe(0o700);
    expect(modeOf(join(folder, 'evidence'))).toBe(0o700);
  });

  test('an existing file in the run folder at 0644 is tightened to 0600 on createRunFolder', () => {
    const sb = eventLogSandbox();
    const folder = join(sb.home, 'runs', 'example-frontend', 'FE-123');
    mkdirSync(folder, { recursive: true });
    const file = join(folder, 'plan.md');
    writeFileSync(file, 'placeholder\n');
    chmodSync(file, 0o644);

    createRunFolder({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123' });

    expect(modeOf(file)).toBe(0o600);
  });
});
