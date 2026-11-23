import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from 'yaml';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

import { loadConfig } from '../../src/config/load.js';
import { runDevInit } from '../../src/dev/dev-init.js';
import { cleanupTempHomes, makeTempHome } from '../support/temp-home.js';
import { parseEnvelope, runCapture } from '../support/cli-harness.js';
import { envFor, listTree, markedHome } from '../support/todo-sandbox.js';
import { git } from '../support/work-repo.js';

let previous: { HOME?: string; FACTORY_HOME?: string } = {};

beforeEach(() => {
  previous = { HOME: process.env.HOME, FACTORY_HOME: process.env.FACTORY_HOME };
});

afterEach(() => {
  for (const key of ['HOME', 'FACTORY_HOME'] as const) {
    const value = previous[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
  cleanupTempHomes();
});

/** Points the in-process CLI at a temp HOME and, when given, a throwaway FACTORY_HOME. */
function useEnv(home: string, factoryHome?: string): void {
  process.env.HOME = home;
  if (factoryHome === undefined) {
    delete process.env.FACTORY_HOME;
  } else {
    process.env.FACTORY_HOME = factoryHome;
  }
}

const sample = (...args: string[]) => runCapture(['dev-init', ...args, '--json']);

describe('factory dev-init --sample todo-v0', () => {
  test('factory dev-init --sample todo-v0 writes a repo config under the factory home whose match.path is the absolute sandbox path, and loadConfig accepts that path', async () => {
    const home = makeTempHome();
    const factoryHome = join(home, 'factory-dev-home');
    runDevInit(factoryHome, envFor(home));
    useEnv(home, factoryHome);
    const sandboxPath = join(factoryHome, 'cache', 'sandbox', 'todo-app');

    const run = await sample('--sample', 'todo-v0');

    expect(run.exitCode).toBe(0);
    expect(parseEnvelope(run)).toMatchObject({ command: 'dev-init', ok: true, exit_code: 0 });

    const repoFiles = readdirSync(join(factoryHome, 'repos')).filter((name) => name.endsWith('.yaml'));
    expect(repoFiles).toHaveLength(1);
    const repoFile = join(factoryHome, 'repos', repoFiles[0] as string);
    const written = parse(readFileSync(repoFile, 'utf8')) as {
      match: { path?: string; origin?: string };
      base_branch: string;
      package_manager: string;
    };
    expect(written.match.path).toBe(sandboxPath);
    expect(written.match.origin).toBeUndefined();
    expect(written.package_manager).toBe('npm');

    const loaded = loadConfig({ env: envFor(home, factoryHome), repoPath: sandboxPath });
    expect(loaded.files.repo).toBe(repoFile);
    expect(loaded.config.package_manager).toBe('npm');
    expect(loaded.config.install).not.toBe('');
    expect(loaded.config.gates.lint).not.toBe('');
    expect(loaded.config.gates.typecheck).not.toBe('');
    expect(loaded.config.gates.test).not.toBe('');

    expect(git(sandboxPath, 'remote', '-v')).toBe('');
    expect(git(sandboxPath, 'describe', '--tags', '--exact-match', 'HEAD')).toBe('todo-v0');
    expect(git(sandboxPath, 'rev-parse', '--verify', `refs/heads/${loaded.config.base_branch}`)).not.toBe('');
  });

  test('npm run dev:init creates only the marked throwaway home, and factory dev-init --sample then adds the sample repo config', async () => {
    const home = makeTempHome();
    const factoryHome = join(home, 'factory-dev-home');

    runDevInit(factoryHome, envFor(home));

    expect(existsSync(join(factoryHome, '.factory-dev-home'))).toBe(true);
    expect(existsSync(join(factoryHome, 'config.yaml'))).toBe(true);
    expect(existsSync(join(factoryHome, 'repos'))).toBe(false);
    expect(existsSync(join(factoryHome, 'cache'))).toBe(false);

    useEnv(home, factoryHome);
    const run = await sample('--sample', 'todo-v0');

    expect(run.exitCode).toBe(0);
    expect(readdirSync(join(factoryHome, 'repos'))).toHaveLength(1);
  });

  test('an unknown --sample name is refused with exit 2, lists the known tags and writes nothing', async () => {
    const home = makeTempHome();
    const factoryHome = markedHome(home);
    const before = listTree(home);
    useEnv(home, factoryHome);

    const run = await sample('--sample', 'todo-v9');

    expect(run.exitCode).toBe(2);
    const envelope = parseEnvelope(run);
    expect(envelope.ok).toBe(false);
    const error = envelope.errors[0];
    expect(error?.code).not.toBe('internal_error');
    expect(error?.where).toContain('todo-v9');
    for (const tag of ['todo-v0', 'todo-v1', 'todo-v2']) {
      expect(error?.next).toContain(tag);
    }
    expect(listTree(home)).toEqual(before);
  });

  test('a FACTORY_HOME without the dev-home marker is refused and writes nothing', async () => {
    const home = makeTempHome();
    const factoryHome = join(home, 'unmarked-home');
    mkdirSync(factoryHome);
    const before = listTree(home);
    useEnv(home, factoryHome);

    const run = await sample('--sample', 'todo-v0');

    expect(run.exitCode).toBe(2);
    expect(parseEnvelope(run).errors[0]?.code).not.toBe('internal_error');
    expect(listTree(home)).toEqual(before);
  });

  test('without FACTORY_HOME the command is refused and creates nothing under the default home or cache', async () => {
    const home = makeTempHome();
    const before = listTree(home);
    useEnv(home);

    const run = await sample('--sample', 'todo-v0');

    expect(run.exitCode).toBe(2);
    expect(parseEnvelope(run).errors[0]?.code).not.toBe('internal_error');
    expect(listTree(home)).toEqual(before);
  });
});

describe('factory dev-init --sample in a protected folder', () => {
  test('a factory home inside Documents, Desktop or Downloads is refused with protected_folder and nothing is written there', async () => {
    for (const folder of ['Documents', 'Desktop', 'Downloads']) {
      const home = makeTempHome();
      const factoryHome = markedHome(join(home, folder));
      const before = listTree(join(home, folder));
      useEnv(home, factoryHome);

      const run = await sample('--sample', 'todo-v0');

      expect(run.exitCode).toBe(2);
      expect(parseEnvelope(run).errors[0]?.code).toBe('protected_folder');
      expect(listTree(join(home, folder))).toEqual(before);
    }
  });

  test('a factory home that is a symlink into Documents is refused with protected_folder', async () => {
    const home = makeTempHome();
    const real = markedHome(join(home, 'Documents'));
    const link = join(home, 'link-home');
    symlinkSync(real, link);
    const before = listTree(join(home, 'Documents'));
    useEnv(home, link);

    const run = await sample('--sample', 'todo-v0');

    expect(run.exitCode).toBe(2);
    expect(parseEnvelope(run).errors[0]?.code).toBe('protected_folder');
    expect(listTree(join(home, 'Documents'))).toEqual(before);
  });
});

describe('factory dev-init --sample leaves baseline reports alone', () => {
  test('factory dev-init --sample does not create or fill the factory-home sandbox/baseline-reports folder', async () => {
    const home = makeTempHome();
    const factoryHome = join(home, 'factory-dev-home');
    runDevInit(factoryHome, envFor(home));
    useEnv(home, factoryHome);

    const run = await sample('--sample', 'todo-v0');

    expect(run.exitCode).toBe(0);
    expect(existsSync(join(factoryHome, 'sandbox'))).toBe(false);
    expect(existsSync(join(factoryHome, 'sandbox', 'baseline-reports'))).toBe(false);
    expect(readdirSync(join(factoryHome, 'cache', 'sandbox'))).toEqual(['todo-app']);
  });
});
