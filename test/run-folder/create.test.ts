import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createRunFolder } from '../../src/run-folder/create.js';
import { writeEvidenceDiff } from '../../src/run-folder/evidence.js';
import { errorFields, thrownBy } from '../support/event-log.js';
import { cleanupTempHomes, makeTempHome } from '../support/temp-home.js';

afterEach(cleanupTempHomes);

const BAD_SEGMENTS = ['a/b', '..', '../x', 'x/..', '~', '~/x', '/tmp/example-frontend', '', 'a b'];

interface Sandbox {
  tmp: string;
  home: string;
  env: NodeJS.ProcessEnv;
  folder: string;
}

function sandbox(): Sandbox {
  const tmp = makeTempHome();
  const home = join(tmp, 'factory-home');
  return {
    tmp,
    home,
    env: { HOME: tmp, FACTORY_HOME: home },
    folder: join(home, 'runs', 'example-frontend', 'FE-123'),
  };
}

/** Every file below `root` as a sorted list of relative paths; directories are listed with a trailing slash. */
function listTree(root: string, prefix = ''): string[] {
  return readdirSync(root, { withFileTypes: true })
    .flatMap((entry) => {
      const rel = `${prefix}${entry.name}`;
      return entry.isDirectory() ? [`${rel}/`, ...listTree(join(root, entry.name), `${rel}/`)] : [rel];
    })
    .sort();
}

describe('createRunFolder location', () => {
  test('createRunFolder puts the folder at <home>/runs/example-frontend/FE-123', () => {
    const sb = sandbox();

    const folder = createRunFolder({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123' });

    expect(folder).toBe(join(sb.tmp, 'factory-home', 'runs', 'example-frontend', 'FE-123'));
    expect(statSync(sb.folder).isDirectory()).toBe(true);
  });

  test('the path is under FACTORY_HOME when that is set, not under the default home of that test\'s HOME', () => {
    const sb = sandbox();

    const folder = createRunFolder({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123' });

    expect(folder.startsWith(join(sb.tmp, 'factory-home', 'runs'))).toBe(true);
    expect(existsSync(join(sb.tmp, '.factory'))).toBe(false);
  });

  test('the run folder is not created under the cache root', () => {
    const sb = sandbox();

    const folder = createRunFolder({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123' });

    expect(folder.startsWith(join(sb.home, 'cache'))).toBe(false);
    expect(existsSync(join(sb.home, 'cache'))).toBe(false);
    expect(readdirSync(sb.home).sort()).toEqual(['runs']);
  });

  test('createRunFolder does not write into a path passed as a work-repo checkout', () => {
    const sb = sandbox();
    const workRepo = join(sb.tmp, 'example-frontend-checkout');
    mkdirSync(workRepo);
    writeFileSync(join(workRepo, 'README.md'), 'placeholder\n');

    const folder = createRunFolder({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123', workRepoPath: workRepo });

    expect(folder.startsWith(workRepo)).toBe(false);
    expect(listTree(workRepo)).toEqual(['README.md']);
  });

  test('createRunFolder refuses when the factory home is inside the work-repo path', () => {
    const tmp = makeTempHome();
    const workRepo = join(tmp, 'example-frontend-checkout');
    mkdirSync(workRepo);
    const env = { HOME: tmp, FACTORY_HOME: join(workRepo, 'factory-home') };

    const error = errorFields(
      thrownBy(() => createRunFolder({ env, repo: 'example-frontend', ticket: 'FE-123', workRepoPath: workRepo })),
    );

    expect(error.code).toBe('run_folder_invalid');
    expect(error.exitCode).toBe(2);
    expect(listTree(workRepo)).toEqual([]);
  });

  test('a repo or ticket that contains a slash or .. is refused as run_folder_invalid, exit code 2', () => {
    const sb = sandbox();
    const attempts = [
      ...BAD_SEGMENTS.map((repo) => ({ field: 'repo', value: repo, repo, ticket: 'FE-123' })),
      ...BAD_SEGMENTS.map((ticket) => ({ field: 'ticket', value: ticket, repo: 'example-frontend', ticket })),
    ];

    const results = attempts.map(({ field, value, repo, ticket }) => {
      const error = errorFields(thrownBy(() => createRunFolder({ env: sb.env, repo, ticket })));
      return {
        field,
        value,
        code: error.code,
        exitCode: error.exitCode,
        suggestsSlug: (error.next ?? '').includes('example-frontend') && (error.next ?? '').includes('FE-123'),
      };
    });

    expect(results).toEqual(
      attempts.map(({ field, value }) => ({
        field,
        value,
        code: 'run_folder_invalid',
        exitCode: 2,
        suggestsSlug: true,
      })),
    );
    expect(existsSync(sb.home)).toBe(false);
  });
});

describe('run folder layout', () => {
  test('createRunFolder creates context, evidence, evidence/gates, prompts and verify and writes no ticket, plan or review file', () => {
    const sb = sandbox();

    createRunFolder({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123' });

    expect(listTree(sb.folder)).toEqual(['context/', 'evidence/', 'evidence/gates/', 'prompts/', 'verify/']);
  });

  test('createRunFolder refuses if the destination already contains a .git directory', () => {
    const sb = sandbox();
    mkdirSync(join(sb.folder, '.git'), { recursive: true });

    const error = errorFields(thrownBy(() => createRunFolder({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123' })));

    expect(error.code).toBe('run_folder_invalid');
    expect(error.exitCode).toBe(2);
    expect(listTree(sb.folder)).toEqual(['.git/']);
  });
});

describe('evidence diff', () => {
  test('writeEvidenceDiff writes evidence/diff.patch and does not copy a worktree tree', () => {
    const sb = sandbox();
    createRunFolder({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123' });
    const worktree = join(sb.home, 'cache', 'worktrees', 'example-frontend', 'FE-123');
    mkdirSync(join(worktree, 'src'), { recursive: true });
    mkdirSync(join(worktree, '.git'));
    writeFileSync(join(worktree, 'src', 'app.ts'), 'export const value = 1;\n');
    const diff = 'diff --git a/src/app.ts b/src/app.ts\n--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-export const value = 0;\n+export const value = 1;\n';

    const path = writeEvidenceDiff({ env: sb.env, repo: 'example-frontend', ticket: 'FE-123', diff });

    expect(path).toBe(join(sb.folder, 'evidence', 'diff.patch'));
    expect(listTree(sb.folder).filter((entry) => !entry.endsWith('/'))).toEqual(['evidence/diff.patch']);
    expect(listTree(sb.folder)).not.toContain('src/');
    expect(listTree(sb.folder)).not.toContain('.git/');
  });
});
