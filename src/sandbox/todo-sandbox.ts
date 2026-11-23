import { execFileSync } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FactoryError } from '../platform/errors.js';
import { assertNotProtectedFolder, resolveFactoryPaths } from '../platform/paths.js';
import { unzipSafely } from './unzip.js';

/** The annotated tags inside the sample's git repo, one starter state each. */
export const SAMPLE_TAGS: readonly string[] = ['todo-v0', 'todo-v1', 'todo-v2'];

export interface UnpackTodoSandboxOptions {
  /** HOME and FACTORY_HOME decide where the sandbox lands (through resolveFactoryPaths). */
  env: NodeJS.ProcessEnv;
  /** The sample tag to leave checked out: todo-v0, todo-v1 or todo-v2. */
  sample: string;
}

export interface TodoSandbox {
  /** Absolute path of the unpacked `todo-app` repo. */
  path: string;
}

const SANDBOX_DIR = 'todo-app';
const STAGING_DIR = `${SANDBOX_DIR}.unpacking`;
const ZIP_RELATIVE = join('test', 'fixtures', 'sandbox', 'todo-app.zip');

/** The checked-in zip, found by walking up from this file (it sits in `src/` when run from source, `dist/src/` when built). */
function fixtureZipPath(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(dir, ZIP_RELATIVE);
    if (existsSync(candidate)) return candidate;
    dir = dirname(dir);
  }
  throw new FactoryError({
    code: 'sample_fixture_missing',
    message: `The sample fixture ${ZIP_RELATIVE} was not found next to this checkout.`,
    where: ZIP_RELATIVE,
    next: 'Run from a full factory checkout. `npm run sandbox:pack` rebuilds the zip.',
    exitCode: 2,
  });
}

/** Runs git in the unpacked repo with no user or system config and no hooks. */
function git(cwd: string, env: NodeJS.ProcessEnv, args: readonly string[]): void {
  execFileSync('git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.autocrlf=false', ...args], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: env.PATH ?? process.env.PATH ?? '',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_TERMINAL_PROMPT: '0',
    },
  });
}

const failure = (code: string, message: string, where: string, next: string): FactoryError =>
  new FactoryError({ code, message, where, next, exitCode: 2 });

/** The folders the unpack writes through must be real folders: a symlink could point outside the sandbox root. */
function assertNoSymlink(path: string): void {
  let isLink = false;
  try {
    isLink = lstatSync(path).isSymbolicLink();
  } catch {
    return; // not there yet
  }
  if (isLink) {
    throw failure(
      'sandbox_symlink',
      `${path} is a symbolic link. The sandbox does not follow links out of the sandbox root.`,
      path,
      'Remove the link, or point FACTORY_HOME at a folder whose cache and sandbox folders are real folders.',
    );
  }
}

/**
 * Unpacks the checked-in zip of the to-do sample's git repo at `<sandbox root>/todo-app` and checks out `sample`
 * (detached). The repo has the tags todo-v0, todo-v1 and todo-v2, no remote and no node_modules; nothing is
 * installed or pushed. An existing sandbox folder is replaced, so two runs end identical. The tree is unpacked
 * beside the target and moved into place, so a failed unpack leaves no half-written sandbox.
 * Throws a FactoryError (exit 2) for an unknown sample, a protected folder, or a symlink in the sandbox path.
 */
export function unpackTodoSandbox(options: UnpackTodoSandboxOptions): TodoSandbox {
  const { env, sample } = options;
  if (!SAMPLE_TAGS.includes(sample)) {
    throw failure('sample_unknown', `Unknown sample "${sample}".`, `--sample ${sample}`, `Use one of: ${SAMPLE_TAGS.join(', ')}.`);
  }
  const { cacheRoot, sandboxRoot } = resolveFactoryPaths(env);
  const path = join(sandboxRoot, SANDBOX_DIR);
  const staging = join(sandboxRoot, STAGING_DIR);

  assertNotProtectedFolder(path, env);
  for (const folder of [cacheRoot, sandboxRoot, path, staging]) {
    assertNoSymlink(folder);
  }
  const zipPath = fixtureZipPath();

  rmSync(staging, { recursive: true, force: true });
  mkdirSync(sandboxRoot, { recursive: true });
  try {
    unzipSafely({ zipPath, destRoot: staging });
    // The zip carries no index: rebuild it from HEAD (the newest state), then switch to the tag so files that
    // exist only in a newer state are removed.
    git(staging, env, ['reset', '--quiet']);
    git(staging, env, ['checkout', '--quiet', '--force', '--detach', `refs/tags/${sample}`]);
    rmSync(path, { recursive: true, force: true });
    renameSync(staging, path);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return { path };
}
