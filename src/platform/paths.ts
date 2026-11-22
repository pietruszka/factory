import { join, resolve, isAbsolute } from 'node:path';

import { FactoryError } from './errors.js';
import {
  isWithinOrSamePath,
  privateSiblingOf,
  resolveComparablePath,
  resolveUserHome,
} from './path-helpers.js';

export interface FactoryPaths {
  home: string;
  privateHome: string;
  cacheRoot: string;
  worktreesRoot: string;
  sandboxRoot: string;
  runsRoot: string;
  dbPath: string;
  configPath: string;
  reposDir: string;
  baselineReportsDir: string;
}

export interface PathOptions {
  /** Overrides process.platform so case rules can be tested on any OS. */
  platform?: NodeJS.Platform;
  /**
   * Real user home to guard against. Defaults to the value the vitest setup stores under
   * `Symbol.for('factory.realHome')`; when neither is set the guard does nothing.
   */
  realHome?: string;
}

const REAL_HOME_KEY = Symbol.for('factory.realHome');
const PROTECTED_FOLDERS = ['Documents', 'Desktop', 'Downloads'] as const;
const DEFAULT_HOME_DIR = '~/.factory';
const DEFAULT_CACHE_DIR = '~/.cache/factory';

function failure(code: string, message: string, where: string, next: string): FactoryError {
  return new FactoryError({ code, message, where, next, exitCode: 2 });
}

function expandTilde(value: string, userHome: string): string {
  if (value === '~') {
    return userHome;
  }
  return value.startsWith('~/') ? join(userHome, value.slice(2)) : value;
}

function recordedRealHome(opts: PathOptions): string | undefined {
  const realHome = opts.realHome ?? (globalThis as Record<symbol, unknown>)[REAL_HOME_KEY];
  return typeof realHome === 'string' ? realHome : undefined;
}

function realHomeInTest(message: string, where: string, next: string): FactoryError {
  return new FactoryError({ code: 'real_home_in_test', message, where, next, exitCode: 4 });
}

const TEMP_HOME_HINT = 'Set HOME to a fresh temp folder in the test, for example with makeTempHome().';

/** Test-mode guard: a test must never resolve paths while HOME is the real user home. */
function assertNotRealHome(userHome: string, opts: PathOptions): void {
  const realHome = recordedRealHome(opts);
  if (realHome === undefined) {
    return;
  }
  const platform = opts.platform ?? process.platform;
  if (resolveComparablePath(userHome, platform) === resolveComparablePath(realHome, platform)) {
    throw realHomeInTest('A test resolved factory paths while HOME is the real user home.', 'HOME', TEMP_HOME_HINT);
  }
}

/** Test-mode guard: no resolved root may be at or inside the real home's factory folders. */
function assertRootsOutsideRealHome(roots: string[], opts: PathOptions): void {
  const realHome = recordedRealHome(opts);
  if (realHome === undefined) {
    return;
  }
  const platform = opts.platform ?? process.platform;
  const guarded = [
    join(realHome, '.factory'),
    join(realHome, '.factory-private'),
    join(realHome, '.cache', 'factory'),
  ].map((folder) => resolveComparablePath(folder, platform));

  for (const root of roots) {
    const comparable = resolveComparablePath(root, platform);
    if (guarded.some((folder) => isWithinOrSamePath(folder, comparable))) {
      throw realHomeInTest(
        `A test resolved the factory path ${root}, which is inside the real user home's factory folders.`,
        root,
        `Point HOME and FACTORY_HOME at a fresh temp folder in the test. ${TEMP_HOME_HINT}`,
      );
    }
  }
}

/** Refuses a path inside ~/Documents, ~/Desktop or ~/Downloads (D-39), symlinks and case included. */
export function assertNotProtectedFolder(
  path: string,
  env: NodeJS.ProcessEnv,
  opts: PathOptions = {},
): void {
  const platform = opts.platform ?? process.platform;
  const userHome = resolveUserHome(env);
  const comparable = resolveComparablePath(path, platform);

  for (const folder of PROTECTED_FOLDERS) {
    if (isWithinOrSamePath(resolveComparablePath(join(userHome, folder), platform), comparable)) {
      throw failure(
        'protected_folder',
        `${path} is inside the protected folder ~/${folder}. macOS blocks background tools there.`,
        path,
        `Use ${DEFAULT_CACHE_DIR} or another folder outside Documents, Desktop and Downloads.`,
      );
    }
  }
}

/** Pure: reads env and the file system, creates and writes nothing. */
export function resolveFactoryPaths(env: NodeJS.ProcessEnv, opts: PathOptions = {}): FactoryPaths {
  const userHome = resolveUserHome(env);
  assertNotRealHome(userHome, opts);

  const configured = env.FACTORY_HOME ? expandTilde(env.FACTORY_HOME, userHome) : undefined;
  if (configured !== undefined && !isAbsolute(configured)) {
    throw failure(
      'factory_home_relative',
      `FACTORY_HOME must be an absolute path, got "${env.FACTORY_HOME}".`,
      'FACTORY_HOME',
      `Set FACTORY_HOME to an absolute path, or to a path starting with ~/, or unset it to use ${DEFAULT_HOME_DIR}.`,
    );
  }

  const home = configured === undefined ? join(userHome, '.factory') : resolve(configured);
  const cacheRoot = configured === undefined ? join(userHome, '.cache', 'factory') : join(home, 'cache');
  const paths: FactoryPaths = {
    home,
    privateHome: privateSiblingOf(home),
    cacheRoot,
    worktreesRoot: join(cacheRoot, 'worktrees'),
    sandboxRoot: join(cacheRoot, 'sandbox'),
    runsRoot: join(home, 'runs'),
    dbPath: join(home, 'factory.db'),
    configPath: join(home, 'config.yaml'),
    reposDir: join(home, 'repos'),
    baselineReportsDir: join(home, 'sandbox', 'baseline-reports'),
  };

  const roots = [paths.home, paths.privateHome, paths.cacheRoot, paths.worktreesRoot, paths.sandboxRoot];
  assertRootsOutsideRealHome(roots, opts);
  for (const root of [paths.home, paths.cacheRoot, paths.worktreesRoot, paths.sandboxRoot]) {
    assertNotProtectedFolder(root, env, opts);
  }
  return paths;
}
