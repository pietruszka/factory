import { chmodSync, existsSync, lstatSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { isWithinOrSamePath, resolveComparablePath } from '../platform/path-helpers.js';
import { resolveFactoryPaths } from '../platform/paths.js';
import { DIR_MODE, FILE_MODE } from './files.js';
import { runFolderInvalid, runFolderPath } from './path.js';

export interface CreateRunFolderOptions {
  env: NodeJS.ProcessEnv;
  repo: string;
  ticket: string;
  /** A work-repo checkout the run folder must never be created in. */
  workRepoPath?: string;
}

const SUBDIRECTORIES = ['context', 'evidence/gates', 'prompts', 'verify'] as const;

function ownedByUser(uid: number): boolean {
  return process.getuid === undefined || process.getuid() === uid;
}

/** Sets 0700 on a directory and 0600 on a file; symlinks and entries of other users are left alone. */
function tighten(path: string, recursive: boolean): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink() || !ownedByUser(stat.uid)) {
    return;
  }
  if (stat.isDirectory()) {
    chmodSync(path, DIR_MODE);
    if (recursive) {
      for (const name of readdirSync(path)) {
        tighten(join(path, name), true);
      }
    }
  } else if (stat.isFile()) {
    chmodSync(path, FILE_MODE);
  }
}

/**
 * Creates `<runsRoot>/<repo>/<ticket>/` with `context/`, `evidence/gates/`, `prompts/` and
 * `verify/` at mode 0700, and returns its path. An existing run folder is kept: everything in it is
 * tightened to 0700 (directories) and 0600 (files); nothing outside it is walked.
 * Refuses a slug that is a path, a folder inside `workRepoPath`, and a folder that holds `.git`.
 */
export function createRunFolder(options: CreateRunFolderOptions): string {
  const { env, repo, ticket, workRepoPath } = options;
  const folder = runFolderPath(env, repo, ticket);

  if (
    workRepoPath !== undefined &&
    isWithinOrSamePath(resolveComparablePath(workRepoPath), resolveComparablePath(folder))
  ) {
    throw runFolderInvalid(
      `The run folder ${folder} is inside the work repo ${workRepoPath}.`,
      folder,
      'Point FACTORY_HOME at a folder outside every work repo; run folders never live in a checkout.',
    );
  }
  if (existsSync(join(folder, '.git'))) {
    throw runFolderInvalid(
      `The run folder ${folder} already contains a .git directory. A run folder holds no checkout.`,
      join(folder, '.git'),
      'Move the checkout out of the run folder, then run the command again.',
    );
  }

  mkdirSync(folder, { recursive: true, mode: DIR_MODE });
  for (const sub of SUBDIRECTORIES) {
    mkdirSync(join(folder, sub), { recursive: true, mode: DIR_MODE });
  }

  const { home, runsRoot } = resolveFactoryPaths(env);
  for (const parent of [home, runsRoot, dirname(folder)]) {
    tighten(parent, false);
  }
  tighten(folder, true);
  return folder;
}
