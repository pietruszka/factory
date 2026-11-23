import { checkEnvironment, type EnvironmentProbe } from '../cli/version-check.js';
import { loadConfig, type LoadedConfig } from '../config/load.js';
import { MODEL_ROLES } from '../config/models.js';
import type { Deps } from '../platform/deps.js';
import { FactoryError } from '../platform/errors.js';
import { assertNotProtectedFolder, resolveFactoryPaths } from '../platform/paths.js';
import { readRun, type RunStateContext, type RunStatus } from '../run-state/context.js';
import { transition } from '../run-state/transition.js';
import { checkConfigDrift } from './config-drift.js';
import { runModelsPreflight, type ModelCatalogLoader } from './models.js';

export interface PreflightOptions {
  env: NodeJS.ProcessEnv;
  /** The work repo checkout the config must match. */
  repoPath: string;
  /** Overrides the git origin used to pick the repo config. `null` means the repo has no origin. */
  originUrl?: string | null;
  deps: Deps;
  /** Injected Node and git version probe. */
  probe: EnvironmentProbe;
  /** Injected model catalog loader. Never shells out to `agent models` or `opencode models` in tests. */
  loadCatalog: ModelCatalogLoader;
  /** The run to record the result on. Without it the checks run and nothing is written. */
  run?: { context: RunStateContext; runId: string };
  /** A worktree path to check against the protected folders when a role uses OpenCode. */
  worktreePath?: string;
  /** A sandbox root to check against the protected folders when a role uses OpenCode. */
  sandboxPath?: string;
}

export interface PreflightResult {
  ok: true;
  /** Names of the checks that passed. */
  checks: string[];
}

interface Check {
  name: string;
  /** The status a failed check moves the run to; `undefined` leaves the status alone. */
  stopsAs?: RunStatus;
  run: () => void | Promise<void>;
}

const EVENT_TYPE = 'preflight';

function modelRefusal(
  errors: Array<{ message: string; code: string; role?: string }>,
  globalConfigFile: string,
): FactoryError {
  const [first] = errors;
  return new FactoryError({
    code: first?.code ?? 'model_preflight_failed',
    message: errors.map((error) => error.message).join(' '),
    where: first?.role === undefined ? 'models' : `models.${first.role}`,
    next: `Fix the models section in ${globalConfigFile}. See docs/reference/models.md.`,
    exitCode: 2,
  });
}

/** The shared guard, with its next action pointed at this home's cache folder (it names the default one). */
function assertOutsideProtectedFolder(path: string, options: PreflightOptions, cacheRoot: string): void {
  try {
    assertNotProtectedFolder(path, options.env);
  } catch (error) {
    if (!(error instanceof FactoryError) || error.code !== 'protected_folder') throw error;
    throw new FactoryError({
      code: error.code,
      message: `${error.message} A role uses OpenCode, which cannot run there.`,
      where: error.where,
      next: `Use the factory cache folder ${cacheRoot} or another folder outside Documents, Desktop and Downloads.`,
      exitCode: error.exitCode,
    });
  }
}

/** Appends the result to the run, then moves it to the status the failed check stops it in. */
function record(run: NonNullable<PreflightOptions['run']>, passed: string[], failure: unknown, stopsAs?: RunStatus): void {
  const { context, runId } = run;
  const failed = failure instanceof FactoryError ? { code: failure.code, where: failure.where } : undefined;
  context.log.appendEvent({
    run_id: runId,
    type: EVENT_TYPE,
    status: failure === undefined ? 'ok' : 'failed',
    payload: { ok: failure === undefined, checks: passed, ...(failed === undefined ? {} : { failed }) },
  });
  if (stopsAs !== undefined && readRun(context, runId).status === 'preflight') {
    transition(context, runId, stopsAs);
  }
}

/**
 * Runs before any agent call. Checks, in order: Node and git versions, the repo config, config drift,
 * the model policy (injected catalog) and, when a role uses OpenCode, the worktree and sandbox paths
 * against Documents, Desktop and Downloads. Starts no agent, runs no install or gate and spends nothing.
 *
 * The first failing check throws its `FactoryError`. With `run`, the result is appended as a `preflight`
 * event (no cost) and the run stays in `preflight` when everything passes; a config drift moves it to
 * `config_drift`, and a version, model or protected-folder failure to `refused`.
 */
export async function preflight(options: PreflightOptions): Promise<PreflightResult> {
  let loaded: LoadedConfig | undefined;
  const config = (): LoadedConfig => {
    if (loaded === undefined) throw new Error('preflight config is not loaded yet');
    return loaded;
  };
  const usesOpencode = (): boolean => MODEL_ROLES.some((role) => config().config.models[role]?.cli === 'opencode');

  const checks: Check[] = [
    { name: 'toolchain', stopsAs: 'refused', run: () => checkEnvironment(options.probe, { checkGit: true }) },
    {
      name: 'config',
      run: () => {
        loaded = loadConfig({
          env: options.env,
          repoPath: options.repoPath,
          ...(options.originUrl === undefined ? {} : { originUrl: options.originUrl }),
        });
      },
    },
    {
      name: 'config_drift',
      stopsAs: 'config_drift',
      run: () =>
        checkConfigDrift({ config: config().config, repoPath: options.repoPath, repoConfigFile: config().files.repo }),
    },
    {
      name: 'models',
      stopsAs: 'refused',
      run: async () => {
        const { ok, errors } = await runModelsPreflight(config().config.models, options.loadCatalog);
        if (!ok) throw modelRefusal(errors, config().files.global);
      },
    },
    {
      name: 'protected_folder',
      stopsAs: 'refused',
      run: () => {
        if (!usesOpencode()) return;
        const paths = resolveFactoryPaths(options.env);
        for (const path of [options.worktreePath, options.sandboxPath ?? paths.sandboxRoot]) {
          if (path !== undefined) assertOutsideProtectedFolder(path, options, paths.cacheRoot);
        }
      },
    },
  ];

  const passed: string[] = [];
  for (const check of checks) {
    try {
      await check.run();
    } catch (error) {
      if (options.run !== undefined) record(options.run, passed, error, check.stopsAs);
      throw error;
    }
    passed.push(check.name);
  }
  // The OpenCode path check only counts as passed when it applied.
  const result = passed.filter((name) => name !== 'protected_folder' || usesOpencode());
  if (options.run !== undefined) record(options.run, result, undefined);
  return { ok: true, checks: result };
}
