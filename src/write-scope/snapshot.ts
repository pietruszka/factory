import { FactoryError } from '../platform/errors.js';
import { git, withTempIndex } from './temp-index.js';
import type { WriteScopeConfig } from './types.js';

export interface SnapshotOptions {
  env: NodeJS.ProcessEnv;
  /** The run's worktree under the cache root. */
  cwd: string;
  /** Paths matching these globs are left out of the snapshot (`snapshot_ignore`). */
  snapshotIgnore: WriteScopeConfig['snapshot_ignore'];
  /** Folder for the temporary index file. */
  tempDir: string;
}

export interface DiffOptions {
  env: NodeJS.ProcessEnv;
  cwd: string;
  /** Tree ids returned by `takeSnapshot`. */
  before: string;
  after: string;
}

export interface ScopeChange {
  path: string;
  kind: 'added' | 'modified' | 'deleted';
}

const KINDS: Readonly<Record<string, ScopeChange['kind']>> = { A: 'added', D: 'deleted' };

/** Git's glob pathspec that leaves out everything matching a `snapshot_ignore` glob. */
function ignorePathspec(glob: string): string {
  return `:(exclude,glob)${glob}`;
}

/**
 * The id of a git tree of the worktree: tracked and untracked files, also those a `.gitignore` hides,
 * minus `snapshotIgnore`. It is built in a temporary index file under `tempDir`, which is removed again,
 * so neither HEAD nor the worktree's real index changes.
 */
export function takeSnapshot({ env, cwd, snapshotIgnore, tempDir }: SnapshotOptions): string {
  return withTempIndex(tempDir, (index) => {
    git(env, cwd, 'add the worktree to a temporary index', ['add', '--all', '--force', '--', '.', ...snapshotIgnore.map(ignorePathspec)], index);
    return git(env, cwd, 'write the snapshot tree', ['write-tree'], index);
  });
}

/** The paths that differ between two snapshot trees, sorted by path. A mode change counts as modified. */
export function diffSnapshots({ env, cwd, before, after }: DiffOptions): ScopeChange[] {
  const output = git(env, cwd, 'compare two snapshots', ['diff-tree', '-r', '-z', '--no-renames', '--name-status', before, after]);
  const fields = output === '' ? [] : output.split('\0').filter((field) => field !== '');
  const changes: ScopeChange[] = [];
  for (let i = 0; i + 1 < fields.length; i += 2) {
    const status = fields[i] ?? '';
    const path = fields[i + 1] ?? '';
    changes.push({ path, kind: KINDS[status.charAt(0)] ?? 'modified' });
  }
  if (fields.length % 2 !== 0) {
    throw new FactoryError({
      code: 'write_scope_git_failed',
      message: 'Git printed a snapshot comparison the factory could not read.',
      where: cwd,
      next: 'Run the step again; if it keeps failing, report the git version.',
      exitCode: 4,
    });
  }
  return changes.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}
