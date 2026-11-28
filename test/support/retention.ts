import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { createCleanCommand, type CleanCommandOptions } from '../../src/cli/clean.js';
import type { RunInput } from '../../src/event-log/open.js';
import type { CodeHost, CodeHostCall, PullRequest } from '../../src/ports/code-host.js';
import { createRecordingCodeHost } from '../../src/ports/code-host.js';
import { applyRetention, type RetentionResult } from '../../src/retention/clean.js';
import { createRunFolder } from '../../src/run-folder/create.js';
import { createWorktree, type WorktreeMode } from '../../src/worktree/create.js';
import { runCapture, type CliRun } from './cli-harness.js';
import { createFakeDeps } from './fake-deps.js';
import { pointEnvAt } from './status.js';
import { worktreeFixture, START_TIME, type WorktreeFixture } from './worktree-fixture.js';

export const MINUTE = 60_000;
export const DAY = 24 * 60 * MINUTE;
export const GIB = 1024 ** 3;

/** @public */
export const iso = (ms: number): string => new Date(ms).toISOString();

/** Every file is this many bytes, so disk totals in tests are independent literals. */
export const FILE_BYTES = 100;
const content = 'x'.repeat(FILE_BYTES);

/** What a run folder loses once the run ended more than 30 days ago (relative to the run folder). */
export const OLD_ARTIFACTS = [
  'ticket.json',
  'prompts/plan.md',
  'prompts/build.md',
  'evidence/diff.patch',
  'evidence/gates/lint.log',
  'evidence/screenshot.txt',
] as const;

/** What a run folder always keeps. */
export const KEPT_FILES = [
  'report.md',
  'plan.md',
  'plan.approved',
  'decisions.md',
  'review.md',
  'context/notes.md',
  'verify/result.md',
] as const;

/** Bytes of one run folder written by `seed`. */
export const RUN_FOLDER_BYTES = (OLD_ARTIFACTS.length + KEPT_FILES.length) * FILE_BYTES;

interface SeedOptions {
  runId: string;
  ticket: string;
  /** Defaults to `passed`. */
  status?: RunInput['status'];
  /** `runs.ended_at` as this long before the injected clock. Absent: the run has no ended_at. */
  endedAgoMs?: number;
  /**
   * The pull request of the run. Seeds a `draft_pr` event with `number`. `mergedAgoMs` is the scripted merge time
   * (null: scripted as not merged; absent: scripted without `mergedAt`). `fetchFails` leaves it unscripted.
   */
  pr?: { number: number; mergedAgoMs?: number | null; fetchFails?: boolean };
  /** Outcome rows, each recorded this long before the injected clock. Inserted in the order given. */
  outcomes?: ReadonlyArray<{ outcome: 'accepted' | 'accepted_with_edits' | 'rejected' | 'abandoned'; agoMs: number }>;
  /** Defaults to `linked`. */
  mode?: WorktreeMode;
  /** Defaults to true. False seeds a run folder only. */
  worktree?: boolean;
}

interface SeededRun {
  runId: string;
  ticket: string;
  /** The worktree path (it exists only when `worktree` was not false). */
  worktree: string;
  runFolder: string;
}

export interface ScriptedCodeHost extends CodeHost {
  readonly calls: readonly CodeHostCall[];
  /** Scripts the pull request with this number. Unscripted numbers fail like a failed fetch. */
  script(number: number, mergedAt: string | null | undefined): void;
}

/** A recording CodeHost fake, keyed by pull request number. Never calls the network. */
export function scriptedCodeHost(): ScriptedCodeHost {
  const recording = createRecordingCodeHost({});
  const scripted = new Map<number, string | null | undefined>();
  const calls = recording.calls as CodeHostCall[];
  return {
    ...recording,
    calls,
    script: (number, mergedAt) => {
      scripted.set(number, mergedAt);
    },
    fetchPullRequest: async (repo, number) => {
      calls.push({ method: 'fetchPullRequest', args: { repo, number } });
      if (!scripted.has(number)) throw new Error(`No scripted pull request #${number}.`);
      const mergedAt = scripted.get(number);
      const pullRequest: PullRequest = {
        number,
        title: 'Example change',
        url: `https://example.invalid/pull/${number}`,
        headBranch: 'example-branch',
        ...(mergedAt === undefined ? {} : { mergedAt }),
      };
      return pullRequest;
    },
  };
}

export interface RetentionFixture extends WorktreeFixture {
  codeHost: ScriptedCodeHost;
  /** Inserts a run, its run folder (with the standard files), and optionally its worktree, PR event and outcomes. */
  seed: (options: SeedOptions) => SeededRun;
  /** The library call, with the fixture's clock, log, reader and code host. */
  clean: () => Promise<RetentionResult>;
  /** `factory clean ...` through the CLI core, with the fixture's clock and code host. */
  cleanCli: (args?: string[], overrides?: Partial<CleanCommandOptions>) => Promise<CliRun>;
  /** Every row of the events table, as plain values, oldest first. */
  eventRows: () => Array<Record<string, unknown>>;
}

/**
 * A temp HOME and FACTORY_HOME (the process environment points at it), a temp work repo `example-frontend`,
 * a fake clock and a scripted code host. Run `run-0` for `FE-000` is a finished run with no folder and no worktree.
 * Call `cleanupStatusTest` from afterEach.
 */
export function retentionFixture(): RetentionFixture {
  const base = worktreeFixture({ run: { run_id: 'run-0', ticket: 'FE-000', status: 'passed', ended_at: iso(START_TIME) } });
  pointEnvAt(base.sb);
  const codeHost = scriptedCodeHost();

  const seed = (options: SeedOptions): SeededRun => {
    const now = base.deps.now();
    const { runId, ticket } = options;
    // Created as `passed` so the two-active-runs limit never blocks a worktree; the real status is set afterwards.
    base.addRun({
      run_id: runId,
      ticket,
      status: 'passed',
      ...(options.endedAgoMs === undefined ? {} : { ended_at: iso(now - options.endedAgoMs) }),
    });

    const runFolder = createRunFolder({ env: base.sb.env, repo: 'example-frontend', ticket });
    for (const name of [...OLD_ARTIFACTS, ...KEPT_FILES]) {
      mkdirSync(join(runFolder, name, '..'), { recursive: true });
      writeFileSync(join(runFolder, name), content);
    }

    let worktree = base.expectedPath(ticket);
    if (options.worktree !== false) {
      worktree = createWorktree(
        base.options({
          runId,
          ticket,
          // Disjoint paths, so several runs can hold a worktree while their status says they are still active.
          allowedPaths: [`area-${ticket}/**`],
          ...(options.mode === undefined ? {} : { mode: options.mode }),
        }),
      ).path;
      writeFileSync(join(worktree, 'blob.bin'), content);
    }

    if (options.status !== undefined && options.status !== 'passed') base.log.updateRunStatus(runId, options.status);
    if (options.pr !== undefined) {
      base.log.appendEvent({ run_id: runId, type: 'draft_pr', payload: { number: options.pr.number } });
      if (!options.pr.fetchFails) {
        const { mergedAgoMs } = options.pr;
        codeHost.script(options.pr.number, mergedAgoMs === undefined || mergedAgoMs === null ? mergedAgoMs : iso(now - mergedAgoMs));
      }
    }
    for (const outcome of options.outcomes ?? []) {
      base.log.appendOutcome({ run_id: runId, outcome: outcome.outcome, recorded_at: iso(now - outcome.agoMs) });
    }
    return { runId, ticket, worktree, runFolder };
  };

  return {
    ...base,
    codeHost,
    seed,
    clean: () =>
      applyRetention({ env: base.sb.env, deps: base.deps, log: base.log, reader: base.reader, codeHost }),
    cleanCli: (args = [], overrides = {}) => cleanCliWith(base.sb.tmp, { deps: base.deps, codeHost, ...overrides }, args),
    eventRows: () => base.reader.query('SELECT * FROM events ORDER BY id'),
  };
}

/** `factory clean ...` from a folder that is not a git checkout. */
export function cleanCliWith(cwd: string, options: Partial<CleanCommandOptions>, args: string[] = []): Promise<CliRun> {
  return runCapture(['clean', ...args], { cwd, commands: { clean: createCleanCommand(options) } });
}

/** A clock for the missing-db case, where no fixture (and so no db) exists. */
export const freshDeps = (): ReturnType<typeof createFakeDeps> => createFakeDeps({ start: START_TIME });

/** Relative paths of the regular files below `folder`, sorted. A missing folder has none. */
export function filesUnder(folder: string): string[] {
  if (!existsSync(folder)) return [];
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return [relative(folder, full)];
    });
  return walk(folder).sort();
}

/** Relative path to content of every regular file below `folder`. Symlinks are listed, not followed. */
export function contentsUnder(folder: string): Record<string, string> {
  return Object.fromEntries(
    filesUnder(folder).map((name) => [
      name,
      lstatSync(join(folder, name)).isSymbolicLink() ? 'symlink' : readFileSync(join(folder, name), 'utf8'),
    ]),
  );
}

/** The `data` of a `--json` CLI run. */
export const dataOf = (run: CliRun): Record<string, unknown> =>
  (JSON.parse(run.stdout) as { data: Record<string, unknown> }).data;
