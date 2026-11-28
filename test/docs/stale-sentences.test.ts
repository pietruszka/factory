import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

import { REPO_ROOT } from '../support/todo-sandbox.js';

const BANNED = [
  'There are no tests in the repository',
  'None exist yet',
  '--passWithNoTests',
  'holds no test',
  'passes with zero tests',
];

function markdownFiles(dir: string): string[] {
  const found: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      found.push(...markdownFiles(path));
    } else if (name.endsWith('.md')) {
      found.push(path);
    }
  }
  return found;
}

describe('stale M1 sentences', () => {
  test('README and docs do not claim the suite or L3 is empty', () => {
    const files = [join(REPO_ROOT, 'README.md'), ...markdownFiles(join(REPO_ROOT, 'docs'))];
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, 'utf8');
      for (const phrase of BANNED) {
        if (text.includes(phrase)) hits.push(`${file}: ${phrase}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
