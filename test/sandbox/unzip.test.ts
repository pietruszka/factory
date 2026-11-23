import { lstatSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { unzipSafely } from '../../src/sandbox/unzip.js';
import { cleanupTempHomes, makeTempHome } from '../support/temp-home.js';
import { listTree, refusalOf } from '../support/todo-sandbox.js';
import { writeZip, type ZipEntry } from '../support/zip.js';

afterEach(cleanupTempHomes);

/** A temp work area: `dest` is the sandbox root, `outside` is a folder next to it that must stay untouched. */
function workArea() {
  const root = makeTempHome();
  const dest = join(root, 'sandbox', 'todo-app');
  const outside = join(root, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'keep.txt'), 'keep\n', 'utf8');
  const zipPath = join(root, 'crafted.zip');
  return { root, dest, outside, zipPath, before: listTree(root) };
}

/** The refusal for a crafted zip, with the checks every refusal must satisfy. */
function refuseZip(area: ReturnType<typeof workArea>, entries: ZipEntry[], badName: string) {
  writeZip(area.zipPath, entries);
  const error = refusalOf(() => unzipSafely({ zipPath: area.zipPath, destRoot: area.dest }));
  expect(error.exitCode).toBe(2);
  expect(error.code).not.toBe('');
  expect(error.code).not.toBe('internal_error');
  expect(error.where).toContain(badName);
  expect(error.next).not.toBe('');
  return error;
}

describe('unzip refuses zip-slip entries', () => {
  test('unzip refuses zip-slip entries', () => {
    for (const name of ['../evil.txt', 'nested/../../evil.txt']) {
      const area = workArea();

      // A good entry first: nothing may be written even though it is valid.
      refuseZip(area, [{ name: 'good.txt', data: 'good\n' }, { name, data: 'evil\n' }], name);

      const added = listTree(area.root).filter((entry) => !area.before.includes(entry) && entry !== 'crafted.zip');
      expect(added.filter((entry) => entry.endsWith('evil.txt') || entry.endsWith('good.txt'))).toEqual([]);
      expect(listTree(area.outside)).toEqual(['keep.txt']);
    }
  });

  test('unzip refuses an absolute entry path and writes nothing', () => {
    const area = workArea();
    const target = join(area.outside, 'abs-evil.txt');

    refuseZip(area, [{ name: 'good.txt', data: 'good\n' }, { name: target, data: 'evil\n' }], target);

    expect(listTree(area.outside)).toEqual(['keep.txt']);
    expect(listTree(area.dest)).toEqual([]);
  });
});

describe('unzip refuses symlink entries', () => {
  test('unzip refuses symlink entries', () => {
    const area = workArea();

    refuseZip(
      area,
      [
        { name: 'good.txt', data: 'good\n' },
        { name: 'link', symlinkTo: '../../outside' },
        { name: 'link/pwn.txt', data: 'pwn\n' },
      ],
      'link',
    );

    expect(listTree(area.outside)).toEqual(['keep.txt']);
    expect(listTree(area.dest)).toEqual([]);
  });

  test('unzip refuses a symlink entry that points at an absolute path', () => {
    const area = workArea();

    refuseZip(area, [{ name: 'abs-link', symlinkTo: area.outside }], 'abs-link');

    expect(listTree(area.outside)).toEqual(['keep.txt']);
    expect(listTree(area.dest)).toEqual([]);
  });
});

describe('unzip writes only under the sandbox root', () => {
  test('unzip writes only under the sandbox root', () => {
    const area = workArea();
    writeZip(area.zipPath, [
      { name: '.git/' },
      { name: '.git/HEAD', data: 'ref: refs/heads/main\n' },
      { name: 'src/' },
      { name: 'src/app.ts', data: 'export const app = 1;\n' },
      { name: 'package.json', data: '{}\n' },
    ]);

    unzipSafely({ zipPath: area.zipPath, destRoot: area.dest });

    expect(lstatSync(area.dest).isDirectory()).toBe(true);
    expect(lstatSync(area.dest).isSymbolicLink()).toBe(false);
    expect(listTree(area.dest)).toEqual(['.git/', '.git/HEAD', 'package.json', 'src/', 'src/app.ts']);
    expect(readFileSync(join(area.dest, 'src', 'app.ts'), 'utf8')).toBe('export const app = 1;\n');
    const added = listTree(area.root).filter((entry) => !area.before.includes(entry));
    for (const entry of added) {
      expect(['crafted.zip', 'sandbox/', 'sandbox/todo-app/'].includes(entry) || entry.startsWith('sandbox/todo-app/')).toBe(true);
    }
    expect(listTree(area.outside)).toEqual(['keep.txt']);
  });

  test('unzip refuses a destination root that is a symlink out of the sandbox and leaves the target alone', () => {
    const area = workArea();
    mkdirSync(join(area.root, 'sandbox'));
    symlinkSync(area.outside, area.dest);
    writeZip(area.zipPath, [{ name: 'good.txt', data: 'good\n' }]);

    const error = refusalOf(() => unzipSafely({ zipPath: area.zipPath, destRoot: area.dest }));

    expect(error.exitCode).toBe(2);
    expect(error.code).not.toBe('internal_error');
    expect(listTree(area.outside)).toEqual(['keep.txt']);
  });
});
