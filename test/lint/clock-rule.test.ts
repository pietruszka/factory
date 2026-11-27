import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, test } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Needles are built at runtime so this file holds no literal user-home path.
const USERS_DIR = ['', 'Users', ''].join('/');
const HOME_DIR = ['', 'home', ''].join('/');

// Virtual paths under allowDefaultProject so lintText does not overwrite real src files.
const SRC_OUTSIDE_DEPS = 'src/core/x.ts';
const SRC_FIXTURE = 'src/lint-fixtures/planted.ts';

async function lintErrors(code: string, filePath: string): Promise<ESLint.LintResult['messages']> {
  const eslint = new ESLint({ cwd: repoRoot });
  const [result] = await eslint.lintText(code, { filePath: join(repoRoot, filePath) });
  return (result?.messages ?? []).filter((message) => message.severity === 2);
}

function depsErrors(messages: ESLint.LintResult['messages']): ESLint.LintResult['messages'] {
  return messages.filter((message) => message.message.includes('use Deps (P-14)'));
}

const CLOCK_SNIPPETS: Array<[string, string]> = [
  ['Date.now()', 'export const t = Date.now();'],
  ['new Date()', 'export const t = new Date();'],
  ['new Date(0)', 'export const t = new Date(0);'],
  ['setTimeout(fn, 1)', 'export const t = setTimeout(() => {}, 1);'],
  ['setInterval(fn, 1)', 'export const t = setInterval(() => {}, 1);'],
  ['Math.random()', 'export const t = Math.random();'],
  ['crypto.randomUUID()', 'export const t = crypto.randomUUID();'],
];

describe('clock and randomness lint rule', () => {
  test.each(CLOCK_SNIPPETS)(
    '%s in src/core/x.ts gives one error "use Deps (P-14)"',
    async (_label, code) => {
      const errors = depsErrors(await lintErrors(code, SRC_OUTSIDE_DEPS));

      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain('use Deps (P-14)');
    },
  );

  test.each(CLOCK_SNIPPETS)(
    '%s in src/platform/deps.ts gives no error',
    async (label, code) => {
      // Contrast case: the same snippet must still be rejected outside the platform folder.
      expect(depsErrors(await lintErrors(code, SRC_OUTSIDE_DEPS)), `${label} outside platform`).not.toHaveLength(0);

      expect(depsErrors(await lintErrors(code, 'src/platform/deps.ts'))).toEqual([]);
    },
  );

  test('Date.now() in src/platform/paths.ts is an error: only deps.ts owns the clock', async () => {
    const errors = depsErrors(await lintErrors('export const t = Date.now();', 'src/platform/paths.ts'));

    expect(errors.map((error) => error.message)).toEqual(['use Deps (P-14)']);
  });

  test.each(CLOCK_SNIPPETS)(
    '%s in a non-deps platform file (src/platform/errors.ts) is an error',
    async (_label, code) => {
      // Path is virtual; the errors.ts override is only for home-path literals, not the clock ban.
      expect(depsErrors(await lintErrors(code, 'src/platform/errors.ts'))).toHaveLength(1);
    },
  );

  test('test files under test/ are exempt from the Deps ban', async () => {
    expect(depsErrors(await lintErrors(CLOCK_SNIPPETS[0]![1], SRC_OUTSIDE_DEPS))).not.toHaveLength(0);

    expect(depsErrors(await lintErrors(CLOCK_SNIPPETS[0]![1], 'test/x.test.ts'))).toEqual([]);
  });

  test('npm run lint passes on the repo (zero errors over src/, test/ and scripts/)', () => {
    // Fresh process: lintText against real src paths poisons the in-process type-aware project service.
    const result = spawnSync(
      process.execPath,
      [join(repoRoot, 'node_modules/eslint/bin/eslint.js'), 'src', 'test', 'scripts'],
      { cwd: repoRoot, encoding: 'utf8' },
    );

    expect(result.status, result.stderr || result.stdout).toBe(0);
  });

  test('an unused variable under test/ is reported', async () => {
    const errors = await lintErrors('const unused = 1;\nexport const x = 1;\n', 'test/x.test.ts');

    expect(errors.some((message) => message.ruleId === '@typescript-eslint/no-unused-vars')).toBe(true);
  });

  test('a floating promise under src/ is reported by the type-aware rules', async () => {
    const errors = await lintErrors(
      'export async function f(): Promise<void> { Promise.resolve(1); }\n',
      SRC_FIXTURE,
    );

    expect(errors.some((message) => message.ruleId === '@typescript-eslint/no-floating-promises')).toBe(true);
  });
});

describe('hard-coded home path lint rule', () => {
  const PATH_SNIPPETS: Array<[string, string]> = [
    ['a user-home literal', `export const p = '${USERS_DIR}someone/work';`],
    ['a linux home literal', `export const p = '${HOME_DIR}someone/work';`],
    ['a literal ~/.factory', "export const p = '~/.factory/config';"],
  ];

  test.each(PATH_SNIPPETS)(
    '%s in src/core/x.ts is an error',
    async (_label, code) => {
      const errors = await lintErrors(code, SRC_OUTSIDE_DEPS);

      expect(errors).toHaveLength(1);
    },
  );

  test('a literal ~/.factory is allowed in src/platform/paths.ts', async () => {
    const code = "export const p = '~/.factory/config';";
    expect(await lintErrors(code, SRC_OUTSIDE_DEPS)).toHaveLength(1);

    expect(await lintErrors(code, 'src/platform/paths.ts')).toEqual([]);
  });

  test('ordinary strings are not flagged', async () => {
    expect(await lintErrors("export const p = 'users/home';", SRC_OUTSIDE_DEPS)).toEqual([]);
  });
});

describe('repo scan for hard-coded user paths', () => {
  function listFiles(dir: string, skip: (path: string) => boolean): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (skip(full)) {
        return [];
      }
      return entry.isDirectory() ? listFiles(full, skip) : [full];
    });
  }

  test('no user-home path substring in src/, test/ or docs/', () => {
    const skip = (path: string): boolean =>
      path.includes('node_modules') ||
      path.includes(join('docs', '.vitepress', 'dist')) ||
      path.includes(join('docs', '.vitepress', 'cache'));
    const files = ['src', 'test', 'docs'].flatMap((dir) => listFiles(join(repoRoot, dir), skip));

    const hits = files
      .filter((file) => readFileSync(file, 'utf8').includes(USERS_DIR))
      .map((file) => relative(repoRoot, file));

    expect(files.length).toBeGreaterThan(0);
    expect(hits).toEqual([]);
  });
});
