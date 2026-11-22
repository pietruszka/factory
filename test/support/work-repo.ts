import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

/** Runs real git on a disposable repo only, with no user or system git config. Returns trimmed stdout. */
export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: {
      PATH: process.env.PATH ?? '',
      HOME: process.env.HOME ?? '',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'example-dev',
      GIT_AUTHOR_EMAIL: 'dev@example.test',
      GIT_COMMITTER_NAME: 'example-dev',
      GIT_COMMITTER_EMAIL: 'dev@example.test',
    },
  }).trim();
}

/** Whether a git command succeeds, for example a detached-HEAD probe. */
export function gitSucceeds(cwd: string, ...args: string[]): boolean {
  try {
    git(cwd, ...args);
    return true;
  } catch {
    return false;
  }
}

function put(root: string, path: string, content: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

export interface WorkRepo {
  path: string;
  /** The first commit: the one the tests pin. */
  baseCommit: string;
  /** The second commit, which is what HEAD points at. It is not the pinned one. */
  headCommit: string;
}

/**
 * A disposable git repo at `path` (under a temp home) with two commits and a dirty state: one
 * unstaged edit, one staged file and one untracked file. The pinned commit is the first one.
 */
export function makeWorkRepo(path: string): WorkRepo {
  mkdirSync(path, { recursive: true });
  git(path, 'init', '-q', '-b', 'main');
  put(path, 'src/app.ts', 'export const app = 1;\n');
  put(path, 'README.md', 'example\n');
  git(path, 'add', '.');
  git(path, 'commit', '-q', '-m', 'first');
  const baseCommit = git(path, 'rev-parse', 'HEAD');
  put(path, 'src/later.ts', 'export const later = 2;\n');
  git(path, 'add', '.');
  git(path, 'commit', '-q', '-m', 'second');
  const headCommit = git(path, 'rev-parse', 'HEAD');
  git(path, 'branch', 'side');

  put(path, 'src/app.ts', 'export const app = 100; // edited, not staged\n');
  put(path, 'staged.txt', 'staged\n');
  git(path, 'add', 'staged.txt');
  put(path, 'notes.txt', 'untracked\n');
  return { path, baseCommit, headCommit };
}

/** Relative paths of every file and folder below `root`, sorted. `skipGit` leaves `.git` out. */
export function listTree(root: string, skipGit: boolean): string[] {
  const walk = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (skipGit && entry.name === '.git') {
        return [];
      }
      return entry.isDirectory() ? [relative(root, full), ...walk(full)] : [relative(root, full)];
    });
  return walk(root).sort();
}

export interface RepoSnapshot {
  head: string;
  /** Every ref and the object it points at. */
  refs: string;
  /** `git ls-files -s`: mode, object and path of every index entry. */
  index: string;
  status: string;
  /** Content hash of every file outside `.git`, by relative path. */
  files: Record<string, string>;
}

/** The working tree, index and refs of a repo, for before and after comparisons. */
export function snapshotRepo(path: string): RepoSnapshot {
  const files: Record<string, string> = {};
  for (const name of listTree(path, true)) {
    try {
      files[name] = createHash('sha256').update(readFileSync(join(path, name))).digest('hex');
    } catch {
      files[name] = 'directory';
    }
  }
  return {
    head: git(path, 'rev-parse', 'HEAD'),
    refs: git(path, 'for-each-ref', '--format=%(refname) %(objectname)'),
    index: git(path, 'ls-files', '-s'),
    status: git(path, 'status', '--porcelain=v1', '--untracked-files=all'),
    files,
  };
}

/** Paths in the work repo, `.git` included, whose name says they belong to the factory. */
export function factoryOwnedPaths(path: string): string[] {
  return listTree(path, false).filter((name) => /factory/i.test(name));
}
