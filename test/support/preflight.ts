import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect } from 'vitest';

import type { EnvironmentProbe } from '../../src/cli/version-check.js';
import { DEFAULT_MODELS, renderModelsSectionYaml, type CompleteModelsSection } from '../../src/config/models.js';
import { openEventLog, openEventLogReadOnly, type EventLog, type EventLogReadOnly } from '../../src/event-log/open.js';
import type { ModelCatalogByCli, ModelCatalogLoader } from '../../src/preflight/models.js';
import type { PreflightOptions } from '../../src/preflight/preflight.js';
import type { RunStateContext } from '../../src/run-state/context.js';
import { startRun } from '../../src/run-state/start.js';
import { createFakeDeps, type FakeDeps } from './fake-deps.js';
import { errorFields, eventLogSandbox, runInput, track, type EventLogSandbox } from './event-log.js';

/** Scripts a matching repo defines. */
const DEFAULT_SCRIPTS: Record<string, string> = {
  lint: 'eslint .',
  typecheck: 'tsc --noEmit',
  test: 'vitest run',
};

const DEFAULT_GATES: Record<string, string | null> = {
  lint: 'npm run lint',
  typecheck: 'npm run typecheck',
  test: 'npm test',
};

/** Model ids that DEFAULT_MODELS names, as the injected `agent models` catalog. */
export const DEFAULT_CATALOG: ModelCatalogByCli = {
  'cursor-agent': ['gpt-5.3-codex-high', 'claude-opus-5-5-high'],
};

export interface PreflightFixtureOptions {
  /** `package_manager` in the repo config. Default `npm`. */
  packageManager?: 'npm' | 'pnpm' | 'yarn';
  /** The lockfile written at the repo root. `null` writes none. Default `package-lock.json`. */
  lockfile?: string | null;
  /** The `scripts` of the package.json in `gates_cwd`. Default has lint, typecheck and test. */
  scripts?: Record<string, string>;
  /** `install` in the repo config. Default `npm ci`. */
  install?: string;
  /** `gates` in the repo config; a `null` value leaves that gate out of the file. */
  gates?: Record<string, string | null>;
  /** `gates_cwd`; the package.json under test is written there. Default `.`. */
  gatesCwd?: string;
  /** The `models` section of the global config. Default DEFAULT_MODELS. */
  models?: CompleteModelsSection;
}

export interface PreflightFixture {
  sb: EventLogSandbox;
  deps: FakeDeps;
  log: EventLog;
  reader: EventLogReadOnly;
  context: RunStateContext;
  /** The temp work repo `<temp>/work/example-frontend`. */
  repoPath: string;
  /** `<FACTORY_HOME>/cache`, written out as a literal join. */
  cacheRoot: string;
  /** Options for `preflight` on run `run-1` (`example-frontend` / `FE-123`, in `preflight`). */
  options: (overrides?: Partial<PreflightOptions>) => PreflightOptions;
  /** The same without a run, for checks that must write nothing. */
  dryOptions: (overrides?: Partial<PreflightOptions>) => PreflightOptions;
  /** The stored status of `run-1`. */
  status: () => string;
  /** Rows of the events table of `run-1` for one type, oldest first. */
  events: (type: string) => Array<Record<string, unknown>>;
}

function writeJson(path: string, value: unknown): void {
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

/** The fake `git --version` and Node version a toolchain that passes reports. */
export function probe(
  processVersion = 'v24.1.0',
  runGitVersion: EnvironmentProbe['runGitVersion'] = async () => 'git version 2.47.1',
): EnvironmentProbe {
  return { processVersion, runGitVersion };
}

export interface CatalogSpy {
  loadCatalog: ModelCatalogLoader;
  /** The `clis` argument of every call, in order. */
  calls: string[][];
}

/** An injected model catalog that records its calls. Nothing here starts a CLI. */
export function catalogSpy(catalog: ModelCatalogByCli = DEFAULT_CATALOG): CatalogSpy {
  const calls: string[][] = [];
  return {
    calls,
    loadCatalog: (clis) => {
      calls.push([...clis]);
      return catalog;
    },
  };
}

/**
 * A temp HOME and FACTORY_HOME holding a global config, a repo config for `example-frontend` and
 * an empty temp work repo (no git needed: the origin is injected as `null`) with a package.json,
 * plus an open event log and run `run-1` in `preflight`. Call `cleanupEventLogTest` from afterEach.
 */
export function preflightFixture(opts: PreflightFixtureOptions = {}): PreflightFixture {
  const sb = eventLogSandbox();
  const repoPath = join(sb.tmp, 'work', 'example-frontend');
  const gatesCwd = opts.gatesCwd ?? '.';
  const gates = { ...DEFAULT_GATES, ...(opts.gates ?? {}) };
  const lockfile = opts.lockfile === undefined ? 'package-lock.json' : opts.lockfile;

  mkdirSync(repoPath, { recursive: true });
  writeJson(join(repoPath, 'package.json'), { name: 'example-frontend', private: true, scripts: DEFAULT_SCRIPTS });
  if (gatesCwd !== '.') {
    writeJson(join(repoPath, gatesCwd, 'package.json'), {
      name: 'example-frontend-app',
      private: true,
      scripts: opts.scripts ?? DEFAULT_SCRIPTS,
    });
  } else if (opts.scripts !== undefined) {
    writeJson(join(repoPath, 'package.json'), { name: 'example-frontend', private: true, scripts: opts.scripts });
  }
  if (lockfile !== null) {
    writeFileSync(join(repoPath, lockfile), '');
  }

  mkdirSync(join(sb.home, 'repos'), { recursive: true });
  writeFileSync(join(sb.home, 'config.yaml'), `version: 1\n${renderModelsSectionYaml(opts.models ?? DEFAULT_MODELS)}\n`);
  writeFileSync(
    join(sb.home, 'repos', 'example-frontend.yaml'),
    [
      'match:',
      `  path: ${repoPath}`,
      'base_branch: main',
      `package_manager: ${opts.packageManager ?? 'npm'}`,
      `install: ${opts.install ?? 'npm ci'}`,
      `gates_cwd: ${gatesCwd}`,
      'gates:',
      ...Object.entries(gates)
        .filter((entry): entry is [string, string] => entry[1] !== null)
        .map(([name, command]) => `  ${name}: ${command}`),
      '',
    ].join('\n'),
  );

  const deps = createFakeDeps({ start: Date.parse('2026-01-01T10:00:00.000Z') });
  const log = track(openEventLog({ env: sb.env, deps }));
  const reader = track(openEventLogReadOnly({ env: sb.env }));
  const context: RunStateContext = { env: sb.env, deps, log, reader };
  const { status: _status, ...run } = runInput({ base_commit: 'abc1234' });
  void _status;
  startRun(context, run);

  const dryOptions: PreflightFixture['dryOptions'] = (overrides = {}) => ({
    env: sb.env,
    repoPath,
    originUrl: null,
    deps,
    probe: probe(),
    loadCatalog: catalogSpy().loadCatalog,
    ...overrides,
  });

  return {
    sb,
    deps,
    log,
    reader,
    context,
    repoPath,
    cacheRoot: join(sb.home, 'cache'),
    dryOptions,
    options: (overrides = {}) => dryOptions({ run: { context, runId: 'run-1' }, ...overrides }),
    status: () => String(reader.query("SELECT status FROM runs WHERE run_id = 'run-1'")[0]?.status),
    events: (type) => reader.query('SELECT * FROM events WHERE run_id = ? AND type = ? ORDER BY id', 'run-1', type),
  };
}

/** The fields of the FactoryError a call rejects with, or of the plain error when it is not one. */
export async function refusalOf(promise: Promise<unknown>): Promise<ReturnType<typeof errorFields>> {
  try {
    await promise;
  } catch (error) {
    return errorFields(error);
  }
  throw new Error('expected preflight to be refused, but it resolved');
}

/** What a refusal must look like: a FactoryError with exit code 2, a place and a next action. */
export function refusal(code: string): Record<string, unknown> {
  return {
    isFactoryError: true,
    code,
    exitCode: 2,
    where: expect.stringMatching(/\S/),
    next: expect.stringMatching(/\S/),
  };
}

/** No agent child was recorded and no event on the run carries a cost. */
export function agentAndSpend(fx: PreflightFixture): { processes: number; steps: number; costedEvents: number } {
  const count = (sql: string): number => Number(fx.reader.query(sql)[0]?.n);
  return {
    processes: count('SELECT COUNT(*) AS n FROM processes'),
    steps: count('SELECT COUNT(*) AS n FROM steps'),
    costedEvents: count('SELECT COUNT(*) AS n FROM events WHERE cost_usd IS NOT NULL'),
  };
}

export const NOTHING_STARTED = { processes: 0, steps: 0, costedEvents: 0 };
