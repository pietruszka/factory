import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { FactoryError } from '../platform/errors.js';
import { assertNotProtectedFolder, resolveFactoryPaths } from '../platform/paths.js';
import { SAMPLE_TAGS, SAMPLE_VERSIONS, SANDBOX_IDENTITY, type FileSet } from './todo-app-files.js';

export { SAMPLE_TAGS };

export interface GenerateTodoSandboxOptions {
  /** HOME and FACTORY_HOME decide where the sandbox lands (through resolveFactoryPaths). */
  env: NodeJS.ProcessEnv;
}

export interface TodoSandbox {
  /** Absolute path of the generated `todo-app` repo. */
  path: string;
}

const SANDBOX_DIR = 'todo-app';

/**
 * Runs git with no user or system config, no hooks, no signing and a fixed identity, so the same
 * input always gives the same object ids. `date` pins both author and committer date.
 */
function git(cwd: string, env: NodeJS.ProcessEnv, date: string, args: readonly string[]): string {
  return execFileSync(
    'git',
    ['-c', 'core.hooksPath=/dev/null', '-c', 'commit.gpgsign=false', '-c', 'tag.gpgsign=false', '-c', 'core.autocrlf=false', ...args],
    {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        PATH: env.PATH ?? process.env.PATH ?? '',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
        GIT_AUTHOR_NAME: SANDBOX_IDENTITY.name,
        GIT_AUTHOR_EMAIL: SANDBOX_IDENTITY.email,
        GIT_AUTHOR_DATE: date,
        GIT_COMMITTER_NAME: SANDBOX_IDENTITY.name,
        GIT_COMMITTER_EMAIL: SANDBOX_IDENTITY.email,
        GIT_COMMITTER_DATE: date,
      },
    },
  ).trim();
}

const failure = (code: string, message: string, where: string, next: string): FactoryError =>
  new FactoryError({ code, message, where, next, exitCode: 2 });

/** The folders the generator writes through must be real folders: a symlink could point outside the sandbox root. */
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
      `${path} is a symbolic link. The sandbox generator does not follow links out of the sandbox root.`,
      path,
      'Remove the link, or point FACTORY_HOME at a folder whose cache and sandbox folders are real folders.',
    );
  }
}

function writeFiles(root: string, files: FileSet): void {
  for (const [name, content] of Object.entries(files)) {
    const target = join(root, name);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, content, { encoding: 'utf8', mode: 0o644 });
  }
}

/**
 * Builds the to-do sample app as a local git repo at `<sandbox root>/todo-app`, tagged todo-v0, todo-v1 and
 * todo-v2. It has no remote and is never pushed. An existing sandbox is rebuilt, so two runs end identical.
 * Throws a FactoryError (exit 2) when the path is in a protected folder or the sandbox folder is a symlink.
 */
export function generateTodoSandbox(options: GenerateTodoSandboxOptions): TodoSandbox {
  const { env } = options;
  const { cacheRoot, sandboxRoot } = resolveFactoryPaths(env);
  const path = join(sandboxRoot, SANDBOX_DIR);

  assertNotProtectedFolder(path, env);
  for (const folder of [cacheRoot, sandboxRoot, path]) {
    assertNoSymlink(folder);
  }

  rmSync(path, { recursive: true, force: true });
  mkdirSync(path, { recursive: true });

  const first = SAMPLE_VERSIONS[0];
  const run = (date: string, ...args: string[]): string => git(path, env, date, args);
  run(first?.date ?? '', 'init', '--quiet', '--template=', '--initial-branch=main');
  for (const version of SAMPLE_VERSIONS) {
    writeFiles(path, version.files);
    run(version.date, 'add', '--all');
    run(version.date, 'commit', '--quiet', '--no-verify', '--message', version.message);
    run(version.date, 'tag', '--annotate', '--message', version.message, version.tag);
  }
  return { path };
}

/** Checks out a sample tag (detached HEAD) in a generated sandbox. */
export function checkoutSampleTag(sandboxPath: string, tag: string, env: NodeJS.ProcessEnv): void {
  git(sandboxPath, env, SAMPLE_VERSIONS[0]?.date ?? '', ['checkout', '--quiet', '--detach', tag]);
}
