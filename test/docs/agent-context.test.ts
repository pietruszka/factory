import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';

import { REPO_ROOT } from '../support/todo-sandbox.js';

/** Decision numbers as cited. `ADR` and `NFR` come before `D` and `P` so the longer prefix wins. */
const ID = /\b(?:ADR|NFR|D|P)-\d+\b/g;

/** A markdown link target, without a title. */
const LINK = /\[[^\]]*\]\(([^)\s]+)\)/g;

const INDEX = join(REPO_ROOT, 'docs', 'reference', 'decisions.md');

const LINK_FILES = [
  'AGENTS.md',
  'CONTEXT.md',
  'GLOSSARY.md',
  'docs/reference/recipes.md',
  '.agents/skills/factory-change/SKILL.md',
];

/** Generated site output is not a citation source. */
function skipDir(path: string): boolean {
  return path.includes(join('docs', '.vitepress', 'dist')) || path.includes(join('docs', '.vitepress', 'cache'));
}

/** Every file under `dir`, skipping the built site. */
function filesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (skipDir(full)) return [];
    return entry.isDirectory() ? filesUnder(full) : [full];
  });
}

/** Decision numbers cited under docs/, src/ and AGENTS.md. */
function citedIds(): Set<string> {
  const files = [join(REPO_ROOT, 'AGENTS.md'), ...filesUnder(join(REPO_ROOT, 'docs')), ...filesUnder(join(REPO_ROOT, 'src'))];
  const ids = new Set<string>();
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(ID)) {
      if (match[0] !== undefined) ids.add(match[0]);
    }
  }
  return ids;
}

/** Relative link paths in `file`. Site links and web links are left to the docs build. */
function relativeLinks(file: string): string[] {
  const links: string[] = [];
  for (const match of readFileSync(file, 'utf8').matchAll(LINK)) {
    const raw = match[1];
    if (raw === undefined || /^(https?:|mailto:|\/|#)/.test(raw)) continue;
    const path = raw.split('#')[0]?.split('?')[0] ?? '';
    if (path.length > 0) links.push(path);
  }
  return links;
}

describe('agent context docs', () => {
  test('every cited decision number is in the decision index', () => {
    expect(existsSync(INDEX), 'docs/reference/decisions.md does not exist').toBe(true);
    const index = readFileSync(INDEX, 'utf8');
    const missing = [...citedIds()].filter((id) => !new RegExp(`\\b${id}\\b`).test(index));
    expect(missing, `decision index is missing ${missing.join(', ')}`).toEqual([]);
  });

  test('relative links in the agent docs resolve to a file or a directory', () => {
    const missing: string[] = [];
    for (const rel of LINK_FILES) {
      const file = join(REPO_ROOT, rel);
      expect(existsSync(file), `${rel} does not exist`).toBe(true);
      for (const link of relativeLinks(file)) {
        const target = resolve(dirname(file), link);
        if (!existsSync(target)) {
          missing.push(`${rel} -> ${link}`);
          continue;
        }
        const kind = statSync(target);
        if (!kind.isFile() && !kind.isDirectory()) missing.push(`${rel} -> ${link}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
