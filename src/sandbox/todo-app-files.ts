/**
 * The three versions of the to-do sample app, as plain text written by the generator. Each later
 * version is the earlier one plus the files listed for it (a file listed again replaces the old one).
 * The app has no dependencies, so `npm install` fetches nothing and the gates run on plain Node.
 */

export type FileSet = Readonly<Record<string, string>>;

export interface SampleVersion {
  tag: string;
  message: string;
  /** Fixed author and committer date, ISO-8601 with a non-UTC offset so every git prints it the same way. */
  date: string;
  files: FileSet;
}

const lines = (...rows: string[]): string => `${rows.join('\n')}\n`;

const PACKAGE_JSON = lines(
  '{',
  '  "name": "todo-app",',
  '  "version": "0.0.0",',
  '  "private": true,',
  '  "type": "module",',
  '  "scripts": {',
  '    "lint": "node --check src/todo.js && node --check src/render.js && node --check scripts/typecheck.mjs",',
  '    "typecheck": "node scripts/typecheck.mjs",',
  '    "test": "node --test"',
  '  }',
  '}',
);

const TODO_JS = (complete: string): string =>
  lines(
    '// A to-do list is a plain object. Every function returns a new list.',
    '',
    'export function createList() {',
    '  return { nextId: 1, items: [] };',
    '}',
    '',
    'export function addItem(list, text) {',
    '  const item = { id: list.nextId, text, done: false };',
    '  return { nextId: list.nextId + 1, items: [...list.items, item] };',
    '}',
    '',
    'export function completeItem(list, id) {',
    '  const items = list.items.map((item) => (' + complete + ' ? { ...item, done: true } : item));',
    '  return { ...list, items };',
    '}',
    '',
    'export function remaining(list) {',
    '  return list.items.filter((item) => !item.done).length;',
    '}',
  );

const RENDER_JS = (heading: string, doneMark: string): string =>
  lines(
    '// Renders a list as an HTML fragment, one row per item.',
    '',
    'import { remaining } from "./todo.js";',
    '',
    'export function renderList(list) {',
    '  const rows = list.items.map((item) => {',
    '    const mark = item.done ? "' + doneMark + '" : "[ ]";',
    '    return "<li class=\\"item\\">" + mark + " " + item.text + "</li>";',
    '  });',
    '  return [',
    '    "<h1>' + heading + '</h1>",',
    '    "<ul>" + rows.join("") + "</ul>",',
    '    "<p>" + remaining(list) + " left</p>",',
    '  ].join("");',
    '}',
  );

const TYPECHECK_MJS = lines(
  '// The sample has no type checker. This checks the shape the other modules rely on.',
  '',
  'import * as todo from "../src/todo.js";',
  'import * as render from "../src/render.js";',
  '',
  'const expected = {',
  '  todo: ["createList", "addItem", "completeItem", "remaining"],',
  '  render: ["renderList"],',
  '};',
  'const modules = { todo, render };',
  '',
  'let failed = false;',
  'for (const [name, exports] of Object.entries(expected)) {',
  '  for (const key of exports) {',
  '    if (typeof modules[name][key] !== "function") {',
  '      console.error("missing function " + name + "." + key);',
  '      failed = true;',
  '    }',
  '  }',
  '}',
  'process.exit(failed ? 1 : 0);',
);

const TODO_TEST = lines(
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  '',
  'import { addItem, completeItem, createList, remaining } from "../src/todo.js";',
  '',
  'test("an added item starts open", () => {',
  '  const list = addItem(createList(), "write docs");',
  '  assert.deepEqual(list.items, [{ id: 1, text: "write docs", done: false }]);',
  '  assert.equal(remaining(list), 1);',
  '});',
  '',
  'test("completing an item marks it done", () => {',
  '  const list = completeItem(addItem(createList(), "write docs"), 1);',
  '  assert.equal(list.items[0].done, true);',
  '  assert.equal(remaining(list), 0);',
  '});',
);

const RENDER_TEST = (heading: string, doneMark: string): string =>
  lines(
    'import assert from "node:assert/strict";',
    'import { test } from "node:test";',
    '',
    'import { renderList } from "../src/render.js";',
    'import { addItem, completeItem, createList } from "../src/todo.js";',
    '',
    'test("the list renders a heading, its items and the count left", () => {',
    '  const list = completeItem(addItem(addItem(createList(), "one"), "two"), 1);',
    '  assert.equal(',
    '    renderList(list),',
    '    "<h1>' + heading + '</h1><ul><li class=\\"item\\">' + doneMark + ' one</li><li class=\\"item\\">[ ] two</li></ul><p>1 left</p>",',
    '  );',
    '});',
  );

const README = (extra: string[]): string =>
  lines(
    '# todo-app',
    '',
    'A tiny to-do list used as a sample app for the factory dev harness. Generated, not hand-edited.',
    '',
    '- npm run lint: syntax check of the sources',
    '- npm run typecheck: checks the exports the modules rely on',
    '- npm test: Node test runner',
    ...extra,
  );

const V1_BUG_TEST = lines(
  'import assert from "node:assert/strict";',
  'import { test } from "node:test";',
  '',
  'import { addItem, completeItem, createList } from "../src/todo.js";',
  '',
  'test("completing one item leaves the items added before it open", () => {',
  '  const list = completeItem(addItem(addItem(addItem(createList(), "one"), "two"), "three"), 2);',
  '  assert.deepEqual(',
  '    list.items.map((item) => item.done),',
  '    [false, true, false],',
  '  );',
  '});',
);

const GITIGNORE = lines('node_modules/');

/** Fixed placeholder identity of every generated commit and tag. */
export const SANDBOX_IDENTITY = { name: 'Factory Sandbox', email: 'factory-sandbox@example.invalid' } as const;

export const SAMPLE_VERSIONS: readonly SampleVersion[] = [
  {
    tag: 'todo-v0',
    message: 'A small working to-do list',
    date: '2024-01-01T12:00:00+0100',
    files: {
      '.gitignore': GITIGNORE,
      'package.json': PACKAGE_JSON,
      'README.md': README([]),
      'scripts/typecheck.mjs': TYPECHECK_MJS,
      'src/todo.js': TODO_JS('item.id === id'),
      'src/render.js': RENDER_JS('To-do', '[x]'),
      'test/todo.test.js': TODO_TEST,
      'test/render.test.js': RENDER_TEST('To-do', '[x]'),
    },
  },
  {
    tag: 'todo-v1',
    message: 'Add a known bug: completing an item completes the earlier ones too',
    date: '2024-01-02T12:00:00+0100',
    files: {
      'README.md': README([
        '',
        '## Known issue (todo-v1)',
        '',
        'completeItem marks every item up to and including the given id as done, not only that item.',
        'test/known-bug.test.js describes the right behaviour and fails until the bug is fixed.',
      ]),
      'src/todo.js': TODO_JS('item.id <= id'),
      'test/known-bug.test.js': V1_BUG_TEST,
    },
  },
  {
    tag: 'todo-v2',
    message: 'Add a UI difference: new heading and a different done mark',
    date: '2024-01-03T12:00:00+0100',
    files: {
      'README.md': README([
        '',
        '## Known issue (todo-v1)',
        '',
        'completeItem marks every item up to and including the given id as done, not only that item.',
        'test/known-bug.test.js describes the right behaviour and fails until the bug is fixed.',
        '',
        '## UI difference (todo-v2)',
        '',
        'The heading reads "My to-do list" instead of "To-do", and a done item shows "[done]" instead of "[x]".',
      ]),
      'src/render.js': RENDER_JS('My to-do list', '[done]'),
      'test/render.test.js': RENDER_TEST('My to-do list', '[done]'),
    },
  },
];

export const SAMPLE_TAGS: readonly string[] = SAMPLE_VERSIONS.map((version) => version.tag);
