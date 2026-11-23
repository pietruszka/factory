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

interface WrittenRepoConfig {
  match: { path?: string; origin?: string };
  base_branch: string;
  package_manager: string;
  install?: string;
  gates?: Record<string, string>;
}

/** The single repo config under `<factory home>/repos`, parsed. */
function readRepoConfig(factoryHome: string): { repoFile: string; written: WrittenRepoConfig } {
  const repoFiles = readdirSync(join(factoryHome, 'repos')).filter((name) => name.endsWith('.yaml'));
  expect(repoFiles).toHaveLength(1);
  const repoFile = join(factoryHome, 'repos', repoFiles[0] as string);
  return { repoFile, written: parse(readFileSync(repoFile, 'utf8')) as WrittenRepoConfig };
}

describe('factory dev-init --sample todo-v0 writes the repo config', () => {
  test('writes a repo config whose match path is the unpacked repo', async () => {
    const home = makeTempHome();
    const factoryHome = join(home, 'factory-dev-home');
    runDevInit(factoryHome, envFor(home));
    useEnv(home, factoryHome);
    const sandboxPath = join(factoryHome, 'cache', 'sandbox', 'todo-app');

    const run = await sample('--sample', 'todo-v0');

    expect(run.exitCode).toBe(0);
    expect(parseEnvelope(run)).toMatchObject({ command: 'dev-init', ok: true, exit_code: 0 });
    const { repoFile, written } = readRepoConfig(factoryHome);
    expect(written.match.path).toBe(sandboxPath);
    expect(written.match.origin).toBeUndefined();

    const loaded = loadConfig({ env: envFor(home, factoryHome), repoPath: sandboxPath });
    expect(loaded.files.repo).toBe(repoFile);
    expect(git(sandboxPath, 'remote', '-v')).toBe('');
    expect(git(sandboxPath, 'describe', '--tags', '--exact-match', 'HEAD')).toBe('todo-v0');
    expect(git(sandboxPath, 'rev-parse', '--verify', `refs/heads/${loaded.config.base_branch}`)).not.toBe('');
  });

  test('the repo config includes the required keys', async () => {
    const home = makeTempHome();
    const factoryHome = join(home, 'factory-dev-home');
    runDevInit(factoryHome, envFor(home));
    useEnv(home, factoryHome);
    const sandboxPath = join(factoryHome, 'cache', 'sandbox', 'todo-app');

    const run = await sample('--sample', 'todo-v0');

    expect(run.exitCode).toBe(0);
    const { written } = readRepoConfig(factoryHome);
    expect(written.base_branch).toBe('main');
    expect(written.package_manager).toBe('npm');
    expect(written.install).toBe('npm ci');
    expect(written.gates?.lint).toMatch(/lint/);
    expect(written.gates?.typecheck).toMatch(/tsc|typecheck/);
    expect(written.gates?.test).toMatch(/test|vitest/);

    // Every gate runs a script the sample's package.json really has.
    const pkg = JSON.parse(git(sandboxPath, 'show', 'todo-v0:package.json')) as { scripts: Record<string, string> };
    for (const gate of Object.values(written.gates ?? {})) {
      const script = /^npm (?:run )?([\w:-]+)$/.exec(gate)?.[1];
      expect(script).toBeDefined();
      expect(Object.keys(pkg.scripts)).toContain(script);
    }
    expect(pkg.scripts.typecheck).toMatch(/\btsc\b/);
    expect(pkg.scripts.test).toMatch(/\bvitest\b/);
  });

  test('npm run dev:init still creates a throwaway factory home', () => {
    const home = makeTempHome();
    const factoryHome = join(home, 'factory-dev-home');

    runDevInit(factoryHome, envFor(home));

    expect(existsSync(join(factoryHome, '.factory-dev-home'))).toBe(true);
    expect(existsSync(join(factoryHome, 'config.yaml'))).toBe(true);
    // Without --sample nothing is unpacked and no repo config is written.
    expect(existsSync(join(factoryHome, 'repos'))).toBe(false);
    expect(existsSync(join(factoryHome, 'cache'))).toBe(false);
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
