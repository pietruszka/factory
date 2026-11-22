import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { describe, expect, test } from 'vitest';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Needles are built at runtime so this file holds no literal user-home path.
const USERS_DIR = ['', 'Users', ''].join('/');
const HOME_DIR = ['', 'home', ''].join('/');

async function lintErrors(code: string, filePath: string): Promise<ESLint.LintResult['messages']> {
  const eslint = new ESLint({ cwd: repoRoot });
  const [result] = await eslint.lintText(code, { filePath: join(repoRoot, filePath) });
  return (result?.messages ?? []).filter((message) => message.severity === 2);
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
      const errors = await lintErrors(code, 'src/core/x.ts');

      expect(errors).toHaveLength(1);
      expect(errors[0]?.message).toContain('use Deps (P-14)');
    },
  );

  test.each(CLOCK_SNIPPETS)(
    '%s in src/platform/deps.ts gives no error',
    async (label, code) => {
      // Contrast case: the same snippet must still be rejected outside the platform folder.
      expect(await lintErrors(code, 'src/core/x.ts'), `${label} outside platform`).not.toHaveLength(0);

      expect(await lintErrors(code, 'src/platform/deps.ts')).toEqual([]);
    },
  );

  test('Date.now() in src/platform/paths.ts is an error: only deps.ts owns the clock', async () => {
    const errors = await lintErrors('export const t = Date.now();', 'src/platform/paths.ts');

    expect(errors.map((error) => error.message)).toEqual(['use Deps (P-14)']);
  });

  test.each(CLOCK_SNIPPETS)(
    '%s in a non-deps platform file (src/platform/errors.ts) is an error',
    async (_label, code) => {
      const errors = await lintErrors(code, 'src/platform/errors.ts');

      expect(errors).toHaveLength(1);
    },
  );

  test('test files under test/ are exempt', async () => {
    expect(await lintErrors(CLOCK_SNIPPETS[0]![1], 'src/core/x.ts')).not.toHaveLength(0);

    expect(await lintErrors(CLOCK_SNIPPETS[0]![1], 'test/x.test.ts')).toEqual([]);
  });

  test('npm run lint passes on the repo (zero errors over src/)', async () => {
    const eslint = new ESLint({ cwd: repoRoot });
    const results = await eslint.lintFiles(['src']);
    const errors = results.flatMap((result) =>
      result.messages
        .filter((message) => message.severity === 2)
        .map((message) => `${relative(repoRoot, result.filePath)}:${message.line} ${message.message}`),
    );

    expect(results.length).toBeGreaterThan(0);
    expect(errors).toEqual([]);
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
      const errors = await lintErrors(code, 'src/core/x.ts');

      expect(errors).toHaveLength(1);
    },
  );

  test('a literal ~/.factory is allowed in src/platform/paths.ts', async () => {
    const code = "export const p = '~/.factory/config';";
    expect(await lintErrors(code, 'src/core/x.ts')).toHaveLength(1);

    expect(await lintErrors(code, 'src/platform/paths.ts')).toEqual([]);
  });

  test('ordinary strings are not flagged', async () => {
    expect(await lintErrors("export const p = 'users/home';", 'src/core/x.ts')).toEqual([]);
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
