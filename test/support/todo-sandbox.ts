import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { FactoryError } from '../../src/platform/errors.js';
import { DEV_HOME_MARKER } from '../../src/dev/home.js';
import { git, gitSucceeds } from './work-repo.js';

export const SAMPLE_TAGS = ['todo-v0', 'todo-v1', 'todo-v2'];

/** The fixed placeholder identity every generated commit and tag must use. */
export const PLACEHOLDER_IDENTITY = {
  name: 'Factory Sandbox',
  email: 'factory-sandbox@example.invalid',
};

/** An env with only HOME (and FACTORY_HOME when given), as the path helpers read it. */
export function envFor(home: string, factoryHome?: string): NodeJS.ProcessEnv {
  return factoryHome === undefined ? { HOME: home } : { HOME: home, FACTORY_HOME: factoryHome };
}

/** A throwaway factory home with the dev-home marker, created under `parent`. */
export function markedHome(parent: string, name = 'factory-home'): string {
  const home = join(parent, name);
  mkdirSync(home, { recursive: true });
  writeFileSync(join(home, DEV_HOME_MARKER), 'factory dev home marker\n', 'utf8');
  return home;
}

/** Every path under `root` (relative, sorted, folders end in "/"). Symlinks are listed, not followed. */
export function listTree(root: string): string[] {
  if (!existsSync(root)) {
    return [];
  }
  const found: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      const rel = relative(root, full);
      if (entry.isDirectory()) {
        found.push(`${rel}/`);
        walk(full);
      } else {
        found.push(rel);
      }
    }
  };
  walk(root);
  return found.sort();
}

/** Path -> sha256 of the content for every regular file under `root`, skipping the `.git` folder. */
export function fileDigests(root: string): Record<string, string> {
  const digests: Record<string, string> = {};
  for (const rel of listTree(root)) {
    if (rel.endsWith('/') || rel === '.git' || rel.startsWith('.git/')) {
      continue;
    }
    digests[rel] = createHash('sha256').update(readFileSync(join(root, rel))).digest('hex');
  }
  return digests;
}

/** Everything two generator runs must agree on: files, tags, tag and commit ids, history, HEAD. */
export interface SandboxState {
  files: Record<string, string>;
  tags: string[];
  tagObjects: Record<string, string>;
  tagCommits: Record<string, string>;
  tagTrees: Record<string, string>;
  history: string;
  head: string;
}

export function sandboxState(path: string): SandboxState {
  const tags = git(path, 'tag', '--list').split('\n').filter(Boolean).sort();
  const state: SandboxState = {
    files: fileDigests(path),
    tags,
    tagObjects: {},
    tagCommits: {},
    tagTrees: {},
    history: git(path, 'log', '--all', '--date=iso-strict', '--format=%H|%an|%ae|%ad|%cn|%ce|%cd|%s'),
    head: git(path, 'rev-parse', 'HEAD'),
  };
  for (const tag of tags) {
    state.tagObjects[tag] = git(path, 'rev-parse', `refs/tags/${tag}`);
    state.tagCommits[tag] = git(path, 'rev-parse', `${tag}^{commit}`);
    state.tagTrees[tag] = git(path, 'rev-parse', `${tag}^{tree}`);
  }
  return state;
}

/** The FactoryError a call throws; fails the test when it returns or throws something else. */
export function refusalOf(fn: () => unknown): FactoryError {
  try {
    fn();
  } catch (error) {
    if (error instanceof FactoryError) {
      return error;
    }
    throw error;
  }
  throw new Error('expected the call to be refused, but it returned');
}

/** True when git finds `pattern` (extended regex) in any file at any of the tags. */
export function tagsContain(path: string, pattern: string, tags: string[] = SAMPLE_TAGS): boolean {
  return gitSucceeds(path, 'grep', '-q', '-I', '-E', pattern, ...tags);
}

/** The factory checkout root. */
export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));

/** The one planned pair: the committed zip of the sample's git repo and its recorded manifest. */
export const SAMPLE_ZIP_PATH = join(REPO_ROOT, 'test', 'fixtures', 'sandbox', 'todo-app.zip');
export const SAMPLE_MANIFEST_PATH = join(REPO_ROOT, 'test', 'fixtures', 'sandbox', 'todo-app.manifest.json');

/** The recorded manifest of the fixture zip. Dates use git's `iso-strict` form with a non-UTC offset. */
export interface SampleManifest {
  zipSha256: string;
  identity: { name: string; email: string };
  dates: Record<string, string>;
  tags: Record<string, { tagObject: string; commit: string }>;
  node?: string;
  npm?: string;
}
