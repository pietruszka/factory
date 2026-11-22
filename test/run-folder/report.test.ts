import { existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { openEventLog, openEventLogReadOnly, type EventLog, type EventLogReadOnly } from '../../src/event-log/open.js';
import type { RunInput } from '../../src/event-log/schema.js';
import { createRunFolder } from '../../src/run-folder/create.js';
import { writeEvidenceDiff } from '../../src/run-folder/evidence.js';
import { savePrompt } from '../../src/run-folder/prompts.js';
import { canPassFromReport, writeReport } from '../../src/run-folder/report.js';
import { createFakeDeps } from '../support/fake-deps.js';
import {
  cleanupEventLogTest,
  errorFields,
  eventLogSandbox,
  runInput,
  thrownBy,
  track,
  type EventLogSandbox,
} from '../support/event-log.js';

afterEach(cleanupEventLogTest);

const CONFIG_HASH = '0123456789abcdef'.repeat(4);
const FINISHED: Partial<RunInput> = {
  tier: 'medium',
  status: 'awaiting_approval',
  started_at: '2026-01-01T10:00:00.000Z',
  ended_at: '2026-01-01T10:12:30.000Z',
};

interface Fixture {
  sb: EventLogSandbox;
  writer: EventLog;
  reader: EventLogReadOnly;
  folder: string;
  worktree: string;
}

/** A temp factory home with an event log holding one finished run (`run-1`) and an empty run folder. */
function fixture(run: Partial<RunInput> = {}): Fixture {
  const sb = eventLogSandbox();
  const writer = track(openEventLog({ env: sb.env, deps: createFakeDeps() }));
  writer.insertRun(runInput({ ...FINISHED, ...run }));
  const reader = track(openEventLogReadOnly({ env: sb.env }));
  const folder = join(sb.home, 'runs', 'example-frontend', 'FE-123');
  mkdirSync(folder, { recursive: true });
  return { sb, writer, reader, folder, worktree: join(sb.home, 'cache', 'worktrees', 'example-frontend', 'FE-123') };
}

function put(folder: string, relative: string, content = 'placeholder\n'): void {
  mkdirSync(dirname(join(folder, relative)), { recursive: true });
  writeFileSync(join(folder, relative), content);
}

function report(fx: Fixture): string {
  const path = writeReport({ env: fx.sb.env, log: fx.reader, runId: 'run-1', worktreePath: fx.worktree });
  return readFileSync(path, 'utf8');
}

/** The text of a `Label: value` line, with or without list or bold markers; undefined if absent. */
function fieldValue(text: string, label: string): string | undefined {
  const match = new RegExp(`^[-*\\s]*\\**${label}:?\\**\\s+(.+)$`, 'im').exec(text);
  return match?.[1]?.trim();
}

function hasLine(text: string, ...patterns: RegExp[]): boolean {
  return text.split('\n').some((line) => patterns.every((pattern) => pattern.test(line)));
}

/** The lines under the Artifacts heading, up to the next heading. */
function artifactLines(text: string): string[] {
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^#+\s*Artifacts\b/i.test(line));
  if (start === -1) {
    return [];
  }
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^#+\s/.test(line));
  return end === -1 ? rest : rest.slice(0, end);
}

function artifactLine(text: string, path: string): string | undefined {
  return artifactLines(text).find((line) => line.includes(path));
}

function listTree(root: string, prefix = ''): string[] {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const rel = `${prefix}${entry.name}`;
      return entry.isDirectory() ? [`${rel}/`, ...listTree(join(root, entry.name), `${rel}/`)] : [rel];
    })
    .sort();
}

describe('run report', () => {
  test('writeReport writes report.md in the run folder', () => {
    const fx = fixture();

    const path = writeReport({ env: fx.sb.env, log: fx.reader, runId: 'run-1', worktreePath: fx.worktree });

    expect(path).toBe(join(fx.folder, 'report.md'));
    expect(readFileSync(path, 'utf8').length).toBeGreaterThan(0);
  });

  test('the report names the ticket, repo, flow and tier', () => {
    const fx = fixture({ flow: 'A', tier: 'medium' });

    const text = report(fx);

    expect([
      fieldValue(text, 'Ticket'),
      fieldValue(text, 'Repo'),
      fieldValue(text, 'Flow'),
      fieldValue(text, 'Tier'),
    ]).toEqual(['FE-123', 'example-frontend', 'A', 'medium']);
  });

  test('the report includes the merged config hash as sha256:<digest>', () => {
    const fx = fixture();

    const text = report(fx);

    expect(fieldValue(text, 'Config hash')).toBe(`sha256:${CONFIG_HASH}`);
  });

  test('the report lists the role and model pairs from the run\'s steps or events', () => {
    const fx = fixture();
    fx.writer.upsertStep({ run_id: 'run-1', step: 'build', role: 'builder', model: 'example-model-a', status: 'done' });
    fx.writer.appendEvent({ run_id: 'run-1', type: 'model_call', role: 'builder', model: 'example-model-a' });
    fx.writer.appendEvent({ run_id: 'run-1', type: 'model_call', role: 'reviewer', model: 'example-model-b' });

    const text = report(fx);

    expect(hasLine(text, /builder/, /example-model-a/)).toBe(true);
    expect(hasLine(text, /reviewer/, /example-model-b/)).toBe(true);
    // The same pair from a step and an event is listed once.
    expect(text.split('example-model-a')).toHaveLength(2);
  });

  test('the report shows cost marked estimated when events have usage_source estimated', () => {
    const fx = fixture();
    fx.writer.appendEvent({ run_id: 'run-1', type: 'model_call', cost_usd: 0.25, usage_source: 'estimated' });
    fx.writer.appendEvent({ run_id: 'run-1', type: 'run_started' });

    const text = report(fx);

    expect(hasLine(text, /estimated/i, /(?<![\d.])0\.250?(?!\d)/)).toBe(true);
    expect(hasLine(text, /reported/i, /\d\.\d/)).toBe(false);
  });

  test('the report shows reported and estimated totals separately when both are present', () => {
    const fx = fixture();
    fx.writer.appendEvent({ run_id: 'run-1', type: 'model_call', cost_usd: 1, usage_source: 'reported' });
    fx.writer.appendEvent({ run_id: 'run-1', type: 'model_call', cost_usd: 0.5, usage_source: 'reported' });
    fx.writer.appendEvent({ run_id: 'run-1', type: 'model_call', cost_usd: 0.25, usage_source: 'estimated' });

    const text = report(fx);

    expect(hasLine(text, /reported/i, /(?<![\d.])1\.50?(?!\d)/)).toBe(true);
    expect(hasLine(text, /estimated/i, /(?<![\d.])0\.250?(?!\d)/)).toBe(true);
    expect(hasLine(text, /total/i, /(?<![\d.])1\.750?(?!\d)/)).toBe(true);
  });

  test('the report says cost is missing when no cost was recorded, and does not write a zero total', () => {
    const fx = fixture();
    fx.writer.appendEvent({ run_id: 'run-1', type: 'run_started' });

    const text = report(fx);

    expect(hasLine(text, /cost/i, /missing/i)).toBe(true);
    expect(hasLine(text, /total/i, /(?<![\d.])0(\.0+)?(?![\d.])/)).toBe(false);
    expect(text).not.toMatch(/\$\s?0(\.0+)?(?![\d.])/);
  });

  test('the report includes duration from started_at and ended_at, the worktree path, and the base commit', () => {
    const fx = fixture({ base_commit: 'abc1234' });

    const text = report(fx);

    expect(fieldValue(text, 'Duration')).toContain('12m 30s');
    expect(fieldValue(text, 'Worktree')).toContain(join(fx.sb.home, 'cache', 'worktrees', 'example-frontend', 'FE-123'));
    expect(fieldValue(text, 'Base commit')).toContain('abc1234');
  });

  test('the report\'s Artifacts section lists each required path and each optional path that is present', () => {
    const fx = fixture({ flow: 'A' });
    put(fx.folder, 'plan.md');
    put(fx.folder, 'plan.approved');
    put(fx.folder, 'evidence/diff.patch');
    put(fx.folder, 'ticket.json', '{}\n');
    put(fx.folder, 'prompts/builder.md');

    const text = report(fx);

    for (const path of ['plan.md', 'plan.approved', 'evidence/diff.patch', 'report.md', 'ticket.json', 'prompts/builder.md']) {
      expect([path, artifactLine(text, path) !== undefined]).toEqual([path, true]);
    }
    for (const path of ['plan.md', 'plan.approved', 'evidence/diff.patch', 'report.md']) {
      expect([path, /missing/i.test(artifactLine(text, path) ?? '')]).toEqual([path, false]);
    }
  });

  test('empty present optional directories such as context/, evidence/gates/ and verify/ are listed in the Artifacts section', () => {
    const fx = fixture({ flow: 'A' });
    const folder = createRunFolder({ env: fx.sb.env, repo: 'example-frontend', ticket: 'FE-123' });
    put(folder, 'plan.md');
    put(folder, 'plan.approved');
    put(folder, 'evidence/diff.patch');

    const text = report({ ...fx, folder });

    for (const path of ['context/', 'evidence/gates/', 'verify/']) {
      expect(artifactLine(text, path)).toBe(`- \`${path}\` (optional): present`);
    }
    expect(artifactLine(text, 'prompts/')).toBeUndefined();
  });
});

describe('required artifacts', () => {
  test('a missing plan.md for flow A is listed as missing in the Artifacts section', () => {
    const fx = fixture({ flow: 'A' });
    put(fx.folder, 'plan.approved');
    put(fx.folder, 'evidence/diff.patch');

    const text = report(fx);

    expect(artifactLine(text, 'plan.md')).toMatch(/missing/i);
    expect(artifactLine(text, 'plan.approved') ?? '').not.toMatch(/missing/i);
  });

  test('canPassFromReport is false when a required artifact is missing, even though report.md was written', () => {
    const fx = fixture({ flow: 'A' });
    put(fx.folder, 'plan.approved');
    put(fx.folder, 'evidence/diff.patch');

    const path = writeReport({ env: fx.sb.env, log: fx.reader, runId: 'run-1', worktreePath: fx.worktree });

    expect(readFileSync(path, 'utf8').length).toBeGreaterThan(0);
    expect(canPassFromReport(fx.folder)).toBe(false);
  });

  test('canPassFromReport is true when every required artifact for flow A is present', () => {
    const fx = fixture({ flow: 'A' });
    put(fx.folder, 'plan.md');
    put(fx.folder, 'plan.approved');
    put(fx.folder, 'evidence/diff.patch');

    writeReport({ env: fx.sb.env, log: fx.reader, runId: 'run-1', worktreePath: fx.worktree });

    expect(canPassFromReport(fx.folder)).toBe(true);
  });

  test('flow F requires review.md and does not require plan.md', () => {
    const withoutReview = fixture({ flow: 'F' });
    const withoutReviewText = report(withoutReview);
    const withoutReviewCanPass = canPassFromReport(withoutReview.folder);

    const withReview = fixture({ flow: 'F' });
    put(withReview.folder, 'review.md');
    const withReviewText = report(withReview);

    expect(artifactLine(withoutReviewText, 'review.md')).toMatch(/missing/i);
    expect(withoutReviewCanPass).toBe(false);
    expect(artifactLine(withReviewText, 'review.md') ?? '').not.toMatch(/missing/i);
    expect(artifactLine(withReviewText, 'plan.md') ?? '').not.toMatch(/missing/i);
    expect(canPassFromReport(withReview.folder)).toBe(true);
  });

  test('writeReport does not set runs.status to passed', () => {
    const fx = fixture({ flow: 'A' });
    put(fx.folder, 'plan.md');
    put(fx.folder, 'plan.approved');
    put(fx.folder, 'evidence/diff.patch');

    writeReport({ env: fx.sb.env, log: fx.reader, runId: 'run-1', worktreePath: fx.worktree });

    expect(fx.reader.query('SELECT status FROM runs WHERE run_id = ?', 'run-1')).toEqual([
      { status: 'awaiting_approval' },
    ]);
  });
});

describe('worktree path', () => {
  test('a worktree path outside the cache root, or the cache root itself, is refused as run_folder_invalid and no report is written', () => {
    const fx = fixture();
    const outside = join(fx.sb.tmp, 'elsewhere', 'example-frontend');
    const insideRunFolder = join(fx.folder, 'worktree');
    mkdirSync(outside, { recursive: true });
    const attempts = [outside, insideRunFolder, fx.sb.home, join(fx.sb.home, 'cache')];

    const results = attempts.map((worktreePath) => {
      const error = errorFields(
        thrownBy(() => writeReport({ env: fx.sb.env, log: fx.reader, runId: 'run-1', worktreePath })),
      );
      return { worktreePath, code: error.code, exitCode: error.exitCode };
    });

    expect(results).toEqual(attempts.map((worktreePath) => ({ worktreePath, code: 'run_folder_invalid', exitCode: 2 })));
    expect(existsSync(join(fx.folder, 'report.md'))).toBe(false);
  });

  test('a relative worktree path is refused as run_folder_invalid', () => {
    const fx = fixture();

    const error = errorFields(
      thrownBy(() => writeReport({ env: fx.sb.env, log: fx.reader, runId: 'run-1', worktreePath: 'cache/worktrees/example-frontend' })),
    );

    expect([error.code, error.exitCode]).toEqual(['run_folder_invalid', 2]);
  });

  test('a path under the cache root that is a symlink to a folder outside it is refused', () => {
    const fx = fixture();
    const outside = join(fx.sb.tmp, 'elsewhere');
    mkdirSync(outside);
    mkdirSync(join(fx.sb.home, 'cache', 'worktrees'), { recursive: true });
    const link = join(fx.sb.home, 'cache', 'worktrees', 'escape');
    symlinkSync(outside, link);

    const error = errorFields(
      thrownBy(() => writeReport({ env: fx.sb.env, log: fx.reader, runId: 'run-1', worktreePath: link })),
    );

    expect([error.code, error.exitCode]).toEqual(['run_folder_invalid', 2]);
  });
});

describe('run folder holds no checkout', () => {
  test('after createRunFolder, savePrompt, writeEvidenceDiff and writeReport, the run folder has no .git directory and no src directory', () => {
    const sb = eventLogSandbox();
    const writer = track(openEventLog({ env: sb.env, deps: createFakeDeps() }));
    writer.insertRun(runInput(FINISHED));
    const reader = track(openEventLogReadOnly({ env: sb.env }));
    const worktree = join(sb.home, 'cache', 'worktrees', 'example-frontend', 'FE-123');
    mkdirSync(join(worktree, 'src'), { recursive: true });
    mkdirSync(join(worktree, '.git'));
    writeFileSync(join(worktree, 'src', 'app.ts'), 'export const value = 1;\n');

    const folder = createRunFolder({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123' });
    savePrompt({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123', step: 'builder', prompt: 'text' });
    writeEvidenceDiff({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123', diff: 'diff text\n' });
    writeReport({ env: sb.env, log: reader, runId: 'run-1', worktreePath: worktree });

    const tree = listTree(folder);
    expect(tree.filter((entry) => !entry.endsWith('/'))).toEqual(['evidence/diff.patch', 'prompts/builder.md', 'report.md']);
    expect(tree.some((entry) => entry.split('/').includes('.git'))).toBe(false);
    expect(tree.some((entry) => entry.split('/').includes('src'))).toBe(false);
  });
});
