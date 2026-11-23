import { existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { resolveFactoryPaths } from '../../src/platform/paths.js';
import { unpackTodoSandbox } from '../../src/sandbox/todo-sandbox.js';
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

// Built at runtime so this file holds no literal user-home path.
const USERS_DIR = ['', 'Users', ''].join('/');
const HOME_DIR = ['', 'home', ''].join('/');
const IDENTITY_LINE = `${PLACEHOLDER_IDENTITY.name}|${PLACEHOLDER_IDENTITY.email}`;

describe('unpacking the sample into the sandbox path', () => {
  test('unpacks the zip into the sandbox path as a git repo', () => {
    const home = makeTempHome();

    const { path } = unpackTodoSandbox({ env: envFor(home), sample: 'todo-v0' });

    expect(path).toBe(join(home, '.cache', 'factory', 'sandbox', 'todo-app'));
    expect(gitSucceeds(path, 'rev-parse', '--git-dir')).toBe(true);
    expect(git(path, 'tag', '--list').split('\n').sort()).toEqual(['todo-v0', 'todo-v1', 'todo-v2']);
    for (const tag of SAMPLE_TAGS) {
      expect(git(path, 'cat-file', '-t', `refs/tags/${tag}`)).toBe('tag');
    }
    expect(existsSync(join(path, 'package-lock.json'))).toBe(true);
    expect(git(path, 'status', '--porcelain')).toBe('');
  });

  test('with FACTORY_HOME set, the sandbox path is under that home\'s cache folder', () => {
    const home = makeTempHome();
    const factoryHome = markedHome(home);

    const { path } = unpackTodoSandbox({ env: envFor(home, factoryHome), sample: 'todo-v0' });

    expect(path).toBe(join(factoryHome, 'cache', 'sandbox', 'todo-app'));
    expect(gitSucceeds(path, 'rev-parse', '--git-dir')).toBe(true);
    expect(listTree(join(home, '.cache'))).toEqual([]);
  });

  test('checks out the requested tag', () => {
    const trees: string[] = [];
    for (const tag of SAMPLE_TAGS) {
      const home = makeTempHome();

      const { path } = unpackTodoSandbox({ env: envFor(home), sample: tag });

      expect(git(path, 'describe', '--tags', '--exact-match', 'HEAD')).toBe(tag);
      expect(git(path, 'status', '--porcelain')).toBe('');
      trees.push(git(path, 'rev-parse', 'HEAD^{tree}'));
    }
    expect(new Set(trees).size).toBe(3);
  });

  test('the unpacked repo has no remotes', () => {
    const home = makeTempHome();

    const { path } = unpackTodoSandbox({ env: envFor(home), sample: 'todo-v0' });

    expect(git(path, 'remote', '-v')).toBe('');
    expect(gitSucceeds(path, 'config', '--get-regexp', '^remote\\.')).toBe(false);
  });

  test('the unpacked repo has no node_modules', () => {
    const home = makeTempHome();

    const { path } = unpackTodoSandbox({ env: envFor(home), sample: 'todo-v0' });

    expect(existsSync(join(path, 'package.json'))).toBe(true);
    expect(listTree(path).filter((entry) => entry.split('/').includes('node_modules'))).toEqual([]);
    expect(tagsContain(path, 'node_modules/', SAMPLE_TAGS)).toBe(false);
  });

  test('an unknown sample name is refused', () => {
    const home = makeTempHome();
    const before = listTree(home);

    const error = refusalOf(() => unpackTodoSandbox({ env: envFor(home), sample: 'todo-v9' }));

    expect(error.code).toBe('sample_unknown');
    expect(error.exitCode).toBe(2);
    expect(error.where).toContain('todo-v9');
    for (const tag of SAMPLE_TAGS) {
      expect(error.next).toContain(tag);
    }
    expect(listTree(home)).toEqual(before);
  });

  test('every commit and tag uses the placeholder identity and no real name, email, home path or token', () => {
    const home = makeTempHome();
    const { path } = unpackTodoSandbox({ env: envFor(home), sample: 'todo-v0' });

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
    expect(tagsContain(path, 'ghp_|github_pat_|(^|[^A-Za-z])sk-[A-Za-z0-9]{10}')).toBe(false);
    const everything = git(path, 'log', '--all', '--format=%an%n%ae%n%cn%n%ce%n%B');
    expect(everything).not.toContain(home);
    expect(everything).not.toContain(USERS_DIR);
    expect(everything).not.toMatch(new RegExp(`${HOME_DIR}[A-Za-z]`));
  });
});

describe('two unpacks are identical', () => {
  test('two unpacks of the zip are identical', () => {
    const first = makeTempHome();
    const second = makeTempHome();

    const a = unpackTodoSandbox({ env: envFor(first), sample: 'todo-v0' });
    const b = unpackTodoSandbox({ env: envFor(second), sample: 'todo-v0' });

    const stateA = sandboxState(a.path);
    expect(stateA.tags).toEqual(['todo-v0', 'todo-v1', 'todo-v2']);
    expect(Object.keys(stateA.files).length).toBeGreaterThan(0);
    expect(sandboxState(b.path)).toEqual(stateA);
  });

  test('unpacking again into the same sandbox path replaces the old tree and ends identical', () => {
    const home = makeTempHome();
    const env = envFor(home);
    const { path } = unpackTodoSandbox({ env, sample: 'todo-v0' });
    const before = sandboxState(path);

    git(path, 'checkout', '-q', '-f', 'todo-v1');
    writeFileSync(join(path, 'stray.txt'), 'left over\n', 'utf8');
    writeFileSync(join(path, 'package.json'), '{}\n', 'utf8');
    const again = unpackTodoSandbox({ env, sample: 'todo-v0' });

    expect(again.path).toBe(path);
    expect(sandboxState(path)).toEqual(before);
    expect(git(path, 'remote', '-v')).toBe('');
  });
});

describe('a protected-folder or symlink path is refused', () => {
  test('refuses when the sandbox path is a protected folder', () => {
    for (const folder of ['Documents', 'Desktop', 'Downloads']) {
      const home = makeTempHome();
      const factoryHome = markedHome(join(home, folder));
      const before = listTree(join(home, folder));

      const error = refusalOf(() => unpackTodoSandbox({ env: envFor(home, factoryHome), sample: 'todo-v0' }));

      expect(['protected_folder', 'sandbox_protected']).toContain(error.code);
      expect(error.exitCode).toBe(2);
      expect(error.where).toContain(folder);
      expect(error.next).not.toBe('');
      expect(listTree(join(home, folder))).toEqual(before);
    }
  });

  test('refuses when the sandbox path is a symlink out of the cache root', () => {
    // Case 1: the todo-app folder itself is a link. Case 2: an ancestor (the sandbox folder) is a link.
    for (const linkAt of ['todo-app', 'sandbox'] as const) {
      const home = makeTempHome();
      const factoryHome = markedHome(home);
      const outside = join(home, 'outside');
      mkdirSync(outside);
      writeFileSync(join(outside, 'keep.txt'), 'keep\n', 'utf8');
      const cache = join(factoryHome, 'cache');
      if (linkAt === 'todo-app') {
        mkdirSync(join(cache, 'sandbox'), { recursive: true });
        symlinkSync(outside, join(cache, 'sandbox', 'todo-app'));
      } else {
        mkdirSync(cache, { recursive: true });
        symlinkSync(outside, join(cache, 'sandbox'));
      }

      const error = refusalOf(() => unpackTodoSandbox({ env: envFor(home, factoryHome), sample: 'todo-v0' }));

      expect(error.code).toBe('sandbox_symlink');
      expect(error.exitCode).toBe(2);
      expect(error.where).not.toBe('');
      expect(error.next).not.toBe('');
      expect(listTree(outside)).toEqual(['keep.txt']);
    }
  });
});

describe('baseline reports stay under the factory home', () => {
  test('unpacking the sample does not write baseline reports under the sandbox', () => {
    const home = makeTempHome();
    const factoryHome = markedHome(home);
    const env = envFor(home, factoryHome);

    const { path } = unpackTodoSandbox({ env, sample: 'todo-v0' });

    expect(path).toBe(join(factoryHome, 'cache', 'sandbox', 'todo-app'));
    expect(resolveFactoryPaths(env).baselineReportsDir).toBe(join(factoryHome, 'sandbox', 'baseline-reports'));
    expect(listTree(join(factoryHome, 'sandbox'))).toEqual([]);
    expect(readdirSync(join(factoryHome, 'cache', 'sandbox'))).toEqual(['todo-app']);
    expect(listTree(join(factoryHome, 'cache', 'sandbox')).filter((entry) => entry.includes('baseline'))).toEqual([]);
  });
});
