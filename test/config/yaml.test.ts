import { describe, expect, test } from 'vitest';

import { readYamlConfig } from '../../src/config/yaml.js';
import { FactoryError } from '../../src/platform/errors.js';

const FILE = 'config.yaml';

function parse(text: string): ReturnType<typeof readYamlConfig> {
  return readYamlConfig({ file: FILE, bytes: Buffer.from(text, 'utf8') });
}

function refusal(fn: () => unknown): FactoryError {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(FactoryError);
    return error as FactoryError;
  }
  throw new Error('expected the call to be refused, but it returned');
}

function expectRefused(text: string, line: number): FactoryError {
  const error = refusal(() => parse(text));
  expect(error.code).toBe('yaml_invalid');
  expect(error.exitCode).toBe(2);
  expect(error.where).toBe(`${FILE}:${line}`);
  expect(error.next.length).toBeGreaterThan(0);
  return error;
}

describe('readYamlConfig parsing', () => {
  test('a mapping with a list and a multi-line string is parsed', () => {
    const text = ['name: example', 'items:', '  - one', '  - two', 'note: |', '  first line', '  second line', ''].join(
      '\n',
    );

    expect(parse(text).value).toEqual({
      name: 'example',
      items: ['one', 'two'],
      note: 'first line\nsecond line\n',
    });
  });

  test('an empty file parses to null', () => {
    expect(parse('# only a comment\n').value).toBeNull();
  });

  test('a file of exactly 1 MiB is accepted', () => {
    const bytes = Buffer.alloc(1_048_576, '#');

    expect(readYamlConfig({ file: FILE, bytes }).value).toBeNull();
  });
});

describe('readYamlConfig refusals', () => {
  test('an alias is refused', () => {
    const error = expectRefused('a: &anchor 1\nb: *anchor\n', 2);

    expect(error.message).toMatch(/alias/i);
  });

  test('a merge key << is refused', () => {
    const error = expectRefused('a: 1\n<<: {b: 2}\n', 2);

    expect(error.message).toContain('<<');
  });

  test('a custom tag such as !!js/function is refused', () => {
    const error = expectRefused('ok: 1\na: !!js/function foo\n', 2);

    expect(error.message).toMatch(/tag/i);
  });

  test('duplicate keys are refused', () => {
    const error = expectRefused('a: 1\nb: 2\na: 3\n', 3);

    expect(error.message).toMatch(/unique|duplicate/i);
  });

  test('a file larger than 1 MiB is refused', () => {
    const bytes = Buffer.alloc(1_048_577, 'a');

    const error = refusal(() => readYamlConfig({ file: FILE, bytes }));

    expect(error.code).toBe('yaml_invalid');
    expect(error.exitCode).toBe(2);
    expect(error.where).toBe(FILE);
    expect(error.message).toMatch(/1 MiB/);
    expect(error.next.length).toBeGreaterThan(0);
  });

  test.each(['__proto__', 'constructor', 'prototype'])('a key named %s is refused', (key) => {
    const error = expectRefused(`ok: 1\nnested:\n  ${key}:\n    x: 1\n`, 3);

    expect(error.message).toContain(key);
  });

  test('a parse error names the file and the line, with a next action', () => {
    const error = expectRefused('a:\n\tb: 1\n', 2);

    expect(error.message.length).toBeGreaterThan(0);
  });

  test('unique string keys only: a non-string key such as a list is refused', () => {
    expectRefused('ok: 1\n? [a, b]\n: c\n', 2);
  });

  test('bytes that are not valid UTF-8 are refused', () => {
    const error = refusal(() => readYamlConfig({ file: FILE, bytes: Uint8Array.from([0x61, 0x3a, 0x20, 0xff]) }));

    expect(error.code).toBe('yaml_invalid');
    expect(error.where).toBe(FILE);
  });
});

describe('readYamlConfig line lookup', () => {
  const text = ['version: 1', 'caps:', '  A:', '    usd: 5', 'list:', '  - x', '  - y', ''].join('\n');

  test('lineOf returns the line of the key at a path', () => {
    const doc = parse(text);

    expect(doc.lineOf(['version'])).toBe(1);
    expect(doc.lineOf(['caps', 'A', 'usd'])).toBe(4);
    expect(doc.lineOf(['caps'])).toBe(2);
  });

  test('lineOf returns the line of a list item', () => {
    expect(parse(text).lineOf(['list', 1])).toBe(7);
  });

  test('lineOf returns 1 when the path has no node', () => {
    const doc = parse(text);

    expect(doc.lineOf(['caps', 'E', 'usd'])).toBe(1);
    expect(doc.lineOf(['missing'])).toBe(1);
  });
});
