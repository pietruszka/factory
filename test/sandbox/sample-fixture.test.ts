import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { unpackTodoSandbox } from '../../src/sandbox/todo-sandbox.js';
import { unzipSafely } from '../../src/sandbox/unzip.js';
import { cleanupTempHomes, makeTempHome } from '../support/temp-home.js';
import {
  envFor,
  listTree,
  REPO_ROOT,
  SAMPLE_MANIFEST_PATH,
  SAMPLE_TAGS,
  SAMPLE_ZIP_PATH,
  type SampleManifest,
} from '../support/todo-sandbox.js';
import { git } from '../support/work-repo.js';
import { listZipEntries } from '../support/zip.js';

afterEach(cleanupTempHomes);

/** The zip may be at most 512 KiB. Raising it to the 1 MiB ceiling needs a note in the PR body. */
const ZIP_BUDGET_BYTES = 512 * 1024;

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;
const rootPackage = () => readJson<{ scripts?: Record<string, string> }>(join(REPO_ROOT, 'package.json'));

/** Unpacks the sample into a fresh temp home and returns the repo path. */
function unpackSample(sample = 'todo-v0'): string {
  return unpackTodoSandbox({ env: envFor(makeTempHome()), sample }).path;
}

interface SamplePackage {
  name?: string;
  engines?: { node?: string };
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

describe('the committed zip matches its manifest', () => {
  test("the committed zip's tags and SHAs match the recorded manifest", () => {
    expect(existsSync(SAMPLE_ZIP_PATH)).toBe(true);
    expect(existsSync(SAMPLE_MANIFEST_PATH)).toBe(true);
    const manifest = readJson<SampleManifest>(SAMPLE_MANIFEST_PATH);

    expect(manifest.zipSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(createHash('sha256').update(readFileSync(SAMPLE_ZIP_PATH)).digest('hex')).toBe(manifest.zipSha256);
    expect(manifest.identity).toEqual({ name: 'Factory Sandbox', email: 'factory-sandbox@example.invalid' });
    expect(Object.keys(manifest.tags).sort()).toEqual(SAMPLE_TAGS);
    expect(Object.keys(manifest.dates).sort()).toEqual(SAMPLE_TAGS);

    const dest = join(makeTempHome(), 'zip-check');
    unzipSafely({ zipPath: SAMPLE_ZIP_PATH, destRoot: dest });

    expect(git(dest, 'tag', '--list').split('\n').sort()).toEqual(SAMPLE_TAGS);
    for (const tag of SAMPLE_TAGS) {
      const recorded = manifest.tags[tag];
      expect(recorded?.tagObject).toMatch(/^[0-9a-f]{40}$/);
      expect(recorded?.commit).toMatch(/^[0-9a-f]{40}$/);
      expect(git(dest, 'rev-parse', `refs/tags/${tag}`)).toBe(recorded?.tagObject);
      expect(git(dest, 'rev-parse', `${tag}^{commit}`)).toBe(recorded?.commit);
      expect(manifest.dates[tag]).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
      expect(git(dest, 'for-each-ref', `refs/tags/${tag}`, '--format=%(taggerdate:iso-strict)')).toBe(manifest.dates[tag]);
    }
  });
});

describe('the factory checkout holds the fixture, not an unpacked sample', () => {
  test('the factory checkout does not contain an unpacked sample tree', () => {
    // The checkout holds the zip (and pack inputs) ...
    expect(existsSync(SAMPLE_ZIP_PATH)).toBe(true);
    // ... but no git work tree of the sample and no sample node_modules, anywhere outside the root's own folders.
    expect(unpackedSampleLeftovers()).toEqual([]);
  });

  test('the zip contains no node_modules', () => {
    expect(existsSync(SAMPLE_ZIP_PATH)).toBe(true);

    const entries = listZipEntries(SAMPLE_ZIP_PATH);

    expect(entries.length).toBeGreaterThan(0);
    expect(entries).toContain('.git/HEAD');
    expect(entries).toContain('package-lock.json');
    const banned = /(^|\/)(node_modules|dist|coverage|reports|baseline-reports|\.DS_Store)(\/|$)/;
    expect(entries.filter((name) => banned.test(name))).toEqual([]);
  });

  test('the zip is marked binary in gitattributes', () => {
    expect(existsSync(join(REPO_ROOT, '.gitattributes'))).toBe(true);

    const attr = git(REPO_ROOT, 'check-attr', 'binary', '--', relative(REPO_ROOT, SAMPLE_ZIP_PATH));

    expect(attr).toMatch(/: binary: set$/);
  });

  test('the zip is within the size budget', () => {
    expect(existsSync(SAMPLE_ZIP_PATH)).toBe(true);

    const { size } = statSync(SAMPLE_ZIP_PATH);

    expect(size).toBeGreaterThan(0);
    expect(size).toBeLessThanOrEqual(ZIP_BUDGET_BYTES);
  });
});

describe('the sample is a Vite + React + TypeScript app with a pinned lockfile', () => {
  test('the sample package.json requires Node 22.13 or newer and pins a lockfile', () => {
    const path = unpackSample();

    const pkg = JSON.parse(git(path, 'show', 'todo-v0:package.json')) as SamplePackage;
    const lock = JSON.parse(git(path, 'show', 'todo-v0:package-lock.json')) as {
      lockfileVersion?: number;
      name?: string;
      packages?: Record<string, unknown>;
    };

    expect(pkg.engines?.node).toBe('>=22.13');
    expect([2, 3]).toContain(lock.lockfileVersion);
    expect(lock.name).toBe(pkg.name);
    expect(Object.keys(lock.packages ?? {}).length).toBeGreaterThan(10);
    const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const name of ['react', 'react-dom', 'vite', 'typescript', 'vitest', '@testing-library/react']) {
      expect(Object.keys(dependencies)).toContain(name);
    }
    const files = git(path, 'ls-tree', '-r', '--name-only', 'todo-v0').split('\n');
    expect(files).toContain('package-lock.json');
    expect(files).not.toContain('yarn.lock');
    expect(files).not.toContain('pnpm-lock.yaml');
  });

  test("factory's default tests do not install the sample app", () => {
    // Unpacking leaves no installed dependencies behind.
    const path = unpackSample();
    expect(listTree(path).filter((entry) => entry.split('/').includes('node_modules'))).toEqual([]);

    // Nothing the default test run starts installs the sample.
    const scripts = rootPackage().scripts ?? {};
    expect(scripts.test).toBe('vitest run');
    for (const name of ['pretest', 'posttest', 'test:l3', 'pretest:l3', 'posttest:l3']) {
      expect(scripts[name] ?? '').not.toMatch(/npm (ci|install)|sample-gates/);
    }
    const defaultRunSources = [join(REPO_ROOT, 'scripts', 'run-layer.ts'), join(REPO_ROOT, 'vitest.config.ts')];
    for (const file of defaultRunSources) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/npm (ci|install)|sample-gates/);
    }
    for (const file of sourceFilesUnder(join(REPO_ROOT, 'src', 'sandbox'))) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/npm (ci|install)|['"]npm['"]/);
    }
  });

  test('the sample at todo-v0 has real tsc, lint, and unit-test scripts', () => {
    const path = unpackSample();

    const pkg = JSON.parse(git(path, 'show', 'todo-v0:package.json')) as SamplePackage;

    expect(pkg.scripts?.typecheck).toMatch(/\btsc\b/);
    expect(pkg.scripts?.lint).toMatch(/\beslint\b/);
    expect(pkg.scripts?.test).toMatch(/\bvitest\b/);
    const files = git(path, 'ls-tree', '-r', '--name-only', 'todo-v0').split('\n');
    expect(files.some((name) => /\.test\.tsx?$/.test(name))).toBe(true);
    expect(files).toContain('tsconfig.json');
    // The v1 stand-ins (an export-shape check on plain Node) are gone.
    expect(pkg.scripts?.typecheck).not.toMatch(/scripts\/typecheck\.mjs/);
    expect(pkg.scripts?.test).not.toMatch(/node --test/);
  });

  test('an opt-in command is wired and is not invoked by npm test', () => {
    const scripts = rootPackage().scripts ?? {};

    expect(scripts['test:sample-gates']).toEqual(expect.any(String));
    expect(scripts['test:sample-gates']).not.toBe('');
    expect(scripts.test).toBe('vitest run');
    for (const name of Object.keys(scripts)) {
      if (name === 'test:sample-gates') continue;
      expect(scripts[name]).not.toContain('test:sample-gates');
    }
    expect(readFileSync(join(REPO_ROOT, 'scripts', 'run-layer.ts'), 'utf8')).not.toContain('sample-gates');
  });

  test('the pack script is wired and is not invoked by npm test', () => {
    const scripts = rootPackage().scripts ?? {};

    expect(scripts['sandbox:pack']).toEqual(expect.any(String));
    expect(scripts['sandbox:pack']).not.toBe('');
    for (const name of ['test', 'test:l3', 'pretest', 'posttest']) {
      expect(scripts[name] ?? '').not.toContain('sandbox:pack');
    }
  });
});

/** Entries in the factory checkout that would mean an unpacked sample: any `.git`, `node_modules` or report folder. */
function unpackedSampleLeftovers(): string[] {
  // Top-level folders that are the factory's own (its git data, its dependencies, build and docs output).
  const skipTop = new Set(['.git', 'node_modules', 'dist']);
  const banned = new Set(['.git', 'node_modules', 'baseline-reports']);
  const found: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryRel = rel === '' ? entry.name : `${rel}/${entry.name}`;
      if (rel === '' && skipTop.has(entry.name)) continue;
      if (entryRel === 'docs/.vitepress/cache' || entryRel === 'docs/.vitepress/dist') continue;
      if (banned.has(entry.name)) {
        found.push(entryRel);
        continue;
      }
      if (entry.isDirectory()) walk(join(dir, entry.name), entryRel);
    }
  };
  walk(REPO_ROOT, '');
  return found;
}

function sourceFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.ts'))
    .map((entry) => join(dir, entry.name));
}
