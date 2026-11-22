import { readdirSync, rmSync, rmdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import type { ScopeChange } from './snapshot.js';
import { git, withTempIndex } from './temp-index.js';

export interface RestoreOptions {
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** The snapshot tree taken before the step. */
  tree: string;
  /** The changes to undo. */
  changes: readonly ScopeChange[];
  tempDir: string;
}

/** Paths per git call, to stay under the command line limit. */
const BATCH = 200;

function isFolder(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/** Removes the folders left empty by a removed file, up to but not including the worktree. */
function removeEmptyParents(root: string, file: string): void {
  for (let folder = dirname(file); folder !== root && folder.startsWith(`${root}/`); folder = dirname(folder)) {
    if (!isFolder(folder) || readdirSync(folder).length > 0) {
      return;
    }
    rmdirSync(folder);
  }
}

/**
 * Puts the worktree files in `changes` back to their contents in `tree`: an added file is removed, a
 * modified or deleted file is written again from the tree. Other paths are left alone. HEAD and the
 * real index do not change; the contents come through a temporary index file.
 */
export function restorePaths({ env, cwd, tree, changes, tempDir }: RestoreOptions): void {
  const root = resolve(cwd);
  const present = changes.filter(({ kind }) => kind !== 'added').map(({ path }) => path);
  for (const { path, kind } of changes) {
    if (kind === 'added') {
      rmSync(join(root, path), { force: true, recursive: true });
      removeEmptyParents(root, join(root, path));
    } else if (isFolder(join(root, path))) {
      // The step put a folder where the file was.
      rmSync(join(root, path), { force: true, recursive: true });
    }
  }
  if (present.length === 0) {
    return;
  }
  withTempIndex(tempDir, (index) => {
    git(env, cwd, 'read the snapshot into a temporary index', ['read-tree', tree], index);
    for (let i = 0; i < present.length; i += BATCH) {
      git(env, cwd, 'restore files from the snapshot', ['checkout-index', '--force', '--', ...present.slice(i, i + BATCH)], index);
    }
  });
}
