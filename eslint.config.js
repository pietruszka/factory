import js from '@eslint/js';
import tseslint from 'typescript-eslint';

// esquery regexes cannot contain a literal "/", so slashes are written as \x2f.
// The patterns below must stay free of literal user-home paths (NFR-33).
const CLOCK_MESSAGE = 'use Deps (P-14)';
const clockSelectors = [
  "MemberExpression[object.name='Date'][property.name='now']",
  "NewExpression[callee.name='Date']",
  "CallExpression[callee.name=/^(setTimeout|setInterval|randomUUID)$/]",
  "MemberExpression[object.name='Math'][property.name='random']",
  "MemberExpression[property.name='randomUUID']",
].map((selector) => ({ selector, message: CLOCK_MESSAGE }));

const PATH_MESSAGE =
  'no hard-coded home paths (NFR-33): build paths with resolveFactoryPaths from src/platform/paths.ts';
const pathSelectors = [
  '\\x2fUsers\\x2f',
  '\\x2fhome\\x2f\\w',
  '~\\x2f\\.factory',
].flatMap((pattern) => [
  { selector: `Literal[value=/${pattern}/]`, message: PATH_MESSAGE },
  { selector: `TemplateElement[value.raw=/${pattern}/]`, message: PATH_MESSAGE },
]);

export default tseslint.config(
  { ignores: ['dist/**'] },
  {
    files: ['src/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        // Virtual paths used by test/lint/*.test.ts (lintText) are not in tsconfig.
        projectService: { allowDefaultProject: ['src/core/*.ts', 'src/lint-fixtures/*.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      'no-restricted-syntax': ['error', ...clockSelectors, ...pathSelectors],
    },
  },
  {
    files: ['test/**/*.ts', 'scripts/**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
  },
  {
    // Only deps.ts owns the clock and randomness; the home-path ban still applies there.
    files: ['src/platform/deps.ts'],
    rules: { 'no-restricted-syntax': ['error', ...pathSelectors] },
  },
  {
    // Only paths.ts owns the home-path literals; the clock ban still applies there.
    files: ['src/platform/paths.ts'],
    rules: { 'no-restricted-syntax': ['error', ...clockSelectors] },
  },
);
