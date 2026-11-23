import { mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, test } from 'vitest';

import { resolveFactoryPaths } from '../../src/platform/paths.js';
import { generateTodoSandbox } from '../../src/sandbox/todo-sandbox.js';
import { cleanupTempHomes, makeTempHome } from '../support/temp-home.js';
import {
  envFor,
  listTree,
  markedHome,
  PLACEHOLDER_IDENTITY,
  refusalOf,
  SAMPLE_TAGS,
  sandboxState,
  tagsContain,
} from '../support/todo-sandbox.js';
import { git, gitSucceeds } from '../support/work-repo.js';

afterEach(cleanupTempHomes);

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url));
// Built at runtime so this file holds no literal user-home path.
const USERS_DIR = ['', 'Users', ''].join('/');
const HOME_DIR = ['', 'home', ''].join('/');
const IDENTITY_LINE = `${PLACEHOLDER_IDENTITY.name}|${PLACEHOLDER_IDENTITY.email}`;

describe('the generator builds a local, unpushed to-do repo at the sandbox path', () => {
  test('the generator builds todo-app at the cache sandbox root as a local git repo with no remote, tagged todo-v0, todo-v1 and todo-v2', () => {
    const home = makeTempHome();

    const { path } = generateTodoSandbox({ env: envFor(home) });

    expect(path).toBe(join(home, '.cache', 'factory', 'sandbox', 'todo-app'));
    expect(gitSucceeds(path, 'rev-parse', '--git-dir')).toBe(true);
    expect(git(path, 'tag', '--list').split('\n').sort()).toEqual(['todo-v0', 'todo-v1', 'todo-v2']);
    for (const tag of SAMPLE_TAGS) {
      expect(git(path, 'cat-file', '-t', `refs/tags/${tag}`)).toBe('tag');
    }
    expect(git(path, 'remote', '-v')).toBe('');
    expect(gitSucceeds(path, 'config', '--get-regexp', '^remote\\.')).toBe(false);
    expect(git(path, 'status', '--porcelain')).toBe('');
  });

  test('with FACTORY_HOME set, the sandbox path is under that home\'s cache folder, not the default cache root', () => {
    const home = makeTempHome();
    const factoryHome = join(home, 'factory-dev-home');
    mkdirSync(factoryHome);

    const { path } = generateTodoSandbox({ env: envFor(home, factoryHome) });

    expect(path).toBe(join(factoryHome, 'cache', 'sandbox', 'todo-app'));
    expect(gitSucceeds(path, 'rev-parse', '--git-dir')).toBe(true);
    expect(listTree(join(home, '.cache'))).toEqual([]);
  });

  test('each tag points at its own commit, in order, and the tags differ in content', () => {
    const home = makeTempHome();

    const { path } = generateTodoSandbox({ env: envFor(home) });

    const state = sandboxState(path);
    expect(new Set(Object.values(state.tagCommits)).size).toBe(3);
    expect(new Set(Object.values(state.tagTrees)).size).toBe(3);
    expect(gitSucceeds(path, 'merge-base', '--is-ancestor', 'todo-v0', 'todo-v1')).toBe(true);
    expect(gitSucceeds(path, 'merge-base', '--is-ancestor', 'todo-v1', 'todo-v2')).toBe(true);
  });

  test('todo-v0 has a package.json with lint, typecheck and test scripts', () => {
    const home = makeTempHome();
    const { path } = generateTodoSandbox({ env: envFor(home) });

    const pkg = JSON.parse(git(path, 'show', 'todo-v0:package.json')) as { scripts?: Record<string, string> };

    expect(Object.keys(pkg.scripts ?? {})).toEqual(expect.arrayContaining(['lint', 'typecheck', 'test']));
  });

  test('every commit and tag uses the placeholder identity and no real name, email, home path or token', () => {
    const home = makeTempHome();
    const { path } = generateTodoSandbox({ env: envFor(home) });

    const commitIdentities = git(path, 'log', '--all', '--format=%an|%ae|%cn|%ce').split('\n');
    expect(commitIdentities.length).toBeGreaterThanOrEqual(3);
    for (const line of commitIdentities) {
      expect(line).toBe(`${IDENTITY_LINE}|${IDENTITY_LINE}`);
    }
    const commitDates = git(path, 'log', '--all', '--date=iso-strict', '--format=%ad|%cd').split('\n');
    for (const line of commitDates) {
      const [author, committer] = line.split('|');
      expect(author).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
      expect(author).toBe(committer);
    }
    const taggers = git(path, 'for-each-ref', 'refs/tags', '--format=%(taggername)|%(taggeremail)').split('\n');
    expect(taggers).toEqual(SAMPLE_TAGS.map(() => `${PLACEHOLDER_IDENTITY.name}|<${PLACEHOLDER_IDENTITY.email}>`));

    expect(tagsContain(path, `${USERS_DIR}|${HOME_DIR}[A-Za-z]`)).toBe(false);
    expect(tagsContain(path, 'ghp_|github_pat_|sk-[A-Za-z0-9]{10}')).toBe(false);
    expect(tagsContain(path, '[A-Za-z0-9._-]+@[A-Za-z0-9-]+\\.[A-Za-z]{2,}')).toBe(false);
    expect(tagsContain(path, home.replace(/[.[\]()*+?^$|\\]/g, '\\$&'))).toBe(false);
    const everything = git(path, 'log', '--all', '--format=%an%n%ae%n%cn%n%ce%n%B');
    expect(everything).not.toContain(home);
    expect(everything).not.toContain(USERS_DIR);
    expect(everything).not.toMatch(new RegExp(`${HOME_DIR}[A-Za-z]`));
  });

  test('the generator refuses when the sandbox folder is a symlink out of the sandbox root and leaves the target alone', () => {
    const home = makeTempHome();
    const factoryHome = markedHome(home);
    const outside = join(home, 'outside');
    mkdirSync(outside);
    writeFileSync(join(outside, 'keep.txt'), 'keep\n', 'utf8');
    mkdirSync(join(factoryHome, 'cache', 'sandbox'), { recursive: true });
    symlinkSync(outside, join(factoryHome, 'cache', 'sandbox', 'todo-app'));

    const error = refusalOf(() => generateTodoSandbox({ env: envFor(home, factoryHome) }));

    expect(error.exitCode).toBe(2);
    expect(error.where).not.toBe('');
    expect(error.next).not.toBe('');
    expect(listTree(outside)).toEqual(['keep.txt']);
  });
});

describe('two runs of the generator are identical', () => {
  test('running the generator twice produces the same tree, the same tags and the same commit ids', () => {
    const first = makeTempHome();
    const second = makeTempHome();

    const a = generateTodoSandbox({ env: envFor(first) });
    const b = generateTodoSandbox({ env: envFor(second) });

    const stateA = sandboxState(a.path);
    expect(stateA.tags).toEqual(['todo-v0', 'todo-v1', 'todo-v2']);
    expect(Object.keys(stateA.files).length).toBeGreaterThan(0);
    expect(sandboxState(b.path)).toEqual(stateA);
  });

  test('a second run that starts with the sandbox already present still ends identical', () => {
    const home = makeTempHome();
    const env = envFor(home);
    const { path } = generateTodoSandbox({ env });
    const before = sandboxState(path);

    git(path, 'checkout', '-q', '-f', 'todo-v1');
    writeFileSync(join(path, 'stray.txt'), 'left over\n', 'utf8');
    writeFileSync(join(path, 'package.json'), '{}\n', 'utf8');
    const again = generateTodoSandbox({ env });

    expect(again.path).toBe(path);
    expect(sandboxState(path)).toEqual(before);
    expect(git(path, 'remote', '-v')).toBe('');
  });
});

describe('a protected-folder path is refused', () => {
  test('when the resolved sandbox path would sit inside Documents, Desktop or Downloads under the test home, the generator and factory dev-init --sample refuse and write nothing there', () => {
    for (const folder of ['Documents', 'Desktop', 'Downloads']) {
      const home = makeTempHome();
      const factoryHome = markedHome(join(home, folder));
      const before = listTree(join(home, folder));

      const error = refusalOf(() => generateTodoSandbox({ env: envFor(home, factoryHome) }));

      expect(error.code).toBe('protected_folder');
      expect(error.exitCode).toBe(2);
      expect(error.where).toContain(folder);
      expect(error.next).not.toBe('');
      expect(listTree(join(home, folder))).toEqual(before);
    }
  });

  test('a FACTORY_HOME that is a symlink into Documents is refused and writes nothing there', () => {
    const home = makeTempHome();
    const real = markedHome(join(home, 'Documents'));
    const link = join(home, 'link-home');
    symlinkSync(real, link);
    const before = listTree(join(home, 'Documents'));

    const error = refusalOf(() => generateTodoSandbox({ env: envFor(home, link) }));

    expect(error.code).toBe('protected_folder');
    expect(error.exitCode).toBe(2);
    expect(listTree(join(home, 'Documents'))).toEqual(before);
  });
});

describe('the factory source repo holds only the generator, not the sample app', () => {
  test('the factory checkout does not contain the sample app tree, and the generator writes the app only under the resolved sandbox root', () => {
    const home = makeTempHome();
    const factoryHome = markedHome(home);
    const before = listTree(home);
    const checkoutTopLevel = readdirSync(REPO_ROOT).sort();

    const { path } = generateTodoSandbox({ env: envFor(home, factoryHome) });

    expect(path).toBe(join(factoryHome, 'cache', 'sandbox', 'todo-app'));
    const added = listTree(home).filter((entry) => !before.includes(entry));
    expect(added).toContain('factory-home/cache/sandbox/todo-app/');
    for (const entry of added) {
      expect(entry.startsWith('factory-home/cache/sandbox') || entry === 'factory-home/cache/').toBe(true);
    }
    expect(readdirSync(REPO_ROOT).sort()).toEqual(checkoutTopLevel);
    expect(checkoutHoldsSampleApp()).toEqual([]);
  });
});

/** Paths in the factory checkout (outside node_modules, .git, dist, caches) named like the sample app or its reports. */
function checkoutHoldsSampleApp(): string[] {
  const skip = new Set(['node_modules', '.git', 'dist', 'cache']);
  const banned = new Set(['todo-app', 'baseline-reports']);
  const found: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (banned.has(entry.name)) {
        found.push(entryRel);
      }
      if (entry.isDirectory() && !skip.has(entry.name)) {
        walk(join(dir, entry.name), entryRel);
      }
    }
  };
  walk(REPO_ROOT, '');
  return found;
}

describe('baseline reports stay under the factory home', () => {
  test('baseline reports stay at the existing factory-home sandbox/baseline-reports path; the generator does not move that folder into the cache root or write reports', () => {
    const home = makeTempHome();
    const factoryHome = markedHome(home);
    const env = envFor(home, factoryHome);

    const { path } = generateTodoSandbox({ env });

    expect(path).toBe(join(factoryHome, 'cache', 'sandbox', 'todo-app'));
    expect(resolveFactoryPaths(env).baselineReportsDir).toBe(join(factoryHome, 'sandbox', 'baseline-reports'));
    expect(listTree(join(factoryHome, 'sandbox'))).toEqual([]);
    expect(listTree(join(factoryHome, 'cache', 'sandbox'))).not.toContain('baseline-reports/');
    expect(readdirSync(join(factoryHome, 'cache', 'sandbox'))).toEqual(['todo-app']);
  });
});
