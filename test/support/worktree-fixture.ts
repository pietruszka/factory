import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect } from 'vitest';

import { openEventLog, openEventLogReadOnly, type EventLog, type EventLogReadOnly, type RunInput } from '../../src/event-log/open.js';
import type { CreateWorktreeOptions, WorktreeMode } from '../../src/worktree/create.js';
import { createFakeDeps, type FakeDeps } from './fake-deps.js';
import { errorFields, eventLogSandbox, runInput, thrownBy, track, type EventLogSandbox } from './event-log.js';
import { git, makeWorkRepo, type WorkRepo } from './work-repo.js';

export const START_TIME = Date.parse('2026-01-01T10:00:00.000Z');

export interface WorktreeFixture {
  sb: EventLogSandbox;
  deps: FakeDeps;
  log: EventLog;
  reader: EventLogReadOnly;
  repo: WorkRepo;
  /** `<FACTORY_HOME>/cache/worktrees`, written out as a literal join so tests do not reuse the code under test. */
  worktreesRoot: string;
  /** Run `run-1` for `example-frontend` / `FE-123` is already inserted. */
  expectedPath: (ticket?: string) => string;
  /** Options for createWorktree for run `run-1`, with overrides. */
  options: (overrides?: Partial<CreateWorktreeOptions>) => CreateWorktreeOptions;
  /** Inserts another run row that points at the same pinned commit. */
  addRun: (overrides?: Partial<RunInput>) => void;
  /** Records that a run created its worktree, as createWorktree would, with the given allowed paths. */
  recordCreated: (runId: string, allowedPaths?: readonly string[]) => void;
}

/**
 * A temp HOME and FACTORY_HOME with a config for `example-frontend`, an open event log, a fake
 * clock and a disposable work repo at `<temp>/work/example-frontend`. Call `cleanupEventLogTest`
 * from afterEach.
 */
export function worktreeFixture(opts: { configMode?: WorktreeMode } = {}): WorktreeFixture {
  const sb = eventLogSandbox();
  const repo = makeWorkRepo(join(sb.tmp, 'work', 'example-frontend'));

  mkdirSync(join(sb.home, 'repos'), { recursive: true });
  writeFileSync(join(sb.home, 'config.yaml'), 'version: 1\n');
  writeFileSync(
    join(sb.home, 'repos', 'example-frontend.yaml'),
    [
      'match:',
      `  path: ${repo.path}`,
      'base_branch: main',
      'package_manager: npm',
      'install: make install-deps',
      'gates:',
      '  lint: npm run lint',
      '  typecheck: npm run typecheck',
      '  test: npm test',
      ...(opts.configMode === undefined ? [] : ['worktree:', `  mode: ${opts.configMode}`]),
      '',
    ].join('\n'),
  );

  const deps = createFakeDeps({ start: START_TIME });
  const log = track(openEventLog({ env: sb.env, deps }));
  const reader = track(openEventLogReadOnly({ env: sb.env }));
  const worktreesRoot = join(sb.home, 'cache', 'worktrees');

  const addRun = (overrides: Partial<RunInput> = {}): void => {
    log.insertRun(runInput({ base_commit: repo.baseCommit, ...overrides }));
  };
  addRun();

  return {
    sb,
    deps,
    log,
    reader,
    repo,
    worktreesRoot,
    expectedPath: (ticket = 'FE-123') => join(worktreesRoot, 'example-frontend', ticket),
    options: (overrides = {}) => ({
      env: sb.env,
      deps,
      log,
      reader,
      runId: 'run-1',
      repo: 'example-frontend',
      ticket: 'FE-123',
      repoPath: repo.path,
      baseCommit: repo.baseCommit,
      ...overrides,
    }),
    addRun,
    recordCreated: (runId, allowedPaths) => {
      log.appendEvent({
        run_id: runId,
        type: 'worktree_created',
        payload: {
          path: join(worktreesRoot, 'example-frontend', runId),
          base_commit: repo.baseCommit,
          mode: 'linked',
          ...(allowedPaths === undefined ? {} : { allowed_paths: allowedPaths }),
        },
      });
    },
  };
}

/** Rows of the events table for one run and type, oldest first, with the payload parsed. */
export function eventsOf(
  reader: EventLogReadOnly,
  runId: string,
  type: string,
): Array<{ id: number; started_at: string; ended_at: string | null; payload: Record<string, unknown> | null }> {
  return reader
    .query('SELECT id, started_at, ended_at, payload_json FROM events WHERE run_id = ? AND type = ? ORDER BY id', runId, type)
    .map((row) => ({
      id: Number(row.id),
      started_at: String(row.started_at),
      ended_at: row.ended_at === null ? null : String(row.ended_at),
      payload: row.payload_json === null ? null : (JSON.parse(String(row.payload_json)) as Record<string, unknown>),
    }));
}

/** Asserts that `fn` throws a FactoryError with one of `codes`, exit code 2, and a `where` and `next`. */
export function expectRefusal(fn: () => unknown, codes: readonly string[]): void {
  expectRefusalFields(errorFields(thrownBy(fn)), codes);
}

/** The same check for an async call. */
export async function expectRejection(promise: Promise<unknown>, codes?: readonly string[]): Promise<void> {
  let error: unknown;
  try {
    await promise;
  } catch (caught) {
    error = caught;
  }
  expect(error, 'expected the call to be refused, but it resolved').toBeDefined();
  expectRefusalFields(errorFields(error), codes);
}

function expectRefusalFields(fields: ReturnType<typeof errorFields>, codes?: readonly string[]): void {
  expect(fields.isFactoryError, `not a FactoryError: ${fields.message ?? ''}`).toBe(true);
  if (codes !== undefined) {
    expect(codes).toContain(fields.code);
  }
  expect(fields.exitCode).toBe(2);
  expect(fields.where).toMatch(/\S/);
  expect(fields.next).toMatch(/\S/);
}

/** Paths git lists as worktrees of the repo, the main checkout included. */
export function listedWorktrees(repoPath: string): string[] {
  return git(repoPath, 'worktree', 'list', '--porcelain')
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length));
}
