import {
  LineCounter,
  isMap,
  isScalar,
  isSeq,
  parseDocument,
  visit,
  type Document,
  type DocumentOptions,
  type ParseOptions,
  type SchemaOptions,
  type ToJSOptions,
} from 'yaml';

import { FactoryError } from '../platform/errors.js';

export interface YamlConfig {
  /** The parsed document as plain data. `null` for an empty file. */
  value: unknown;
  /** 1-based line of the key at `path`; 1 when the path has no node. */
  lineOf(path: ReadonlyArray<string | number>): number;
}

/** Config files larger than this are refused before parsing (1 MiB). */
export const MAX_CONFIG_BYTES = 1_048_576;

const RESERVED_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// The one place that parses config YAML. Plain YAML 1.2 data only: no merge keys, no custom
// tags, no aliases, unique string keys.
const PARSE_OPTIONS: ParseOptions & DocumentOptions & SchemaOptions & ToJSOptions = {
  version: '1.2',
  schema: 'core',
  merge: false,
  resolveKnownTags: false,
  maxAliasCount: 0,
  uniqueKeys: true,
  stringKeys: true,
  prettyErrors: true,
};

function refuse(file: string, line: number | undefined, message: string, next: string): FactoryError {
  return new FactoryError({
    code: 'yaml_invalid',
    message,
    where: line === undefined ? file : `${file}:${line}`,
    next,
    exitCode: 2,
  });
}

const FIX_THE_FILE = 'Fix the line named above in the config file, then run the command again.';

/** First line of a yaml library message, without its " at line N, column M:" suffix. */
function briefMessage(message: string): string {
  const first = message.split('\n')[0] ?? message;
  return first.replace(/ at line \d+, column \d+:?$/, '');
}

function decode(file: string, bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw refuse(file, undefined, 'The config file is not valid UTF-8 text.', 'Save the file as UTF-8 text.');
  }
}

function assertPlainData(doc: Document.Parsed, lines: LineCounter, file: string): void {
  const lineAt = (offset: number | undefined): number => lines.linePos(offset ?? 0).line;

  const [error] = doc.errors;
  if (error) {
    throw refuse(file, error.linePos?.[0].line, briefMessage(error.message), FIX_THE_FILE);
  }
  const [warning] = doc.warnings;
  if (warning) {
    throw refuse(
      file,
      warning.linePos?.[0].line,
      `${briefMessage(warning.message)} Custom tags are not allowed.`,
      'Remove the tag. Config files hold plain YAML values only.',
    );
  }

  visit(doc, {
    Alias(_key, node) {
      throw refuse(
        file,
        lineAt(node.range?.[0]),
        `An alias (*${node.source}) is not allowed.`,
        'Write the value out instead of using an anchor and alias.',
      );
    },
    Pair(_key, pair) {
      const key = pair.key;
      if (!isScalar(key) || typeof key.value !== 'string') {
        return;
      }
      if (key.value === '<<') {
        throw refuse(
          file,
          lineAt(key.range?.[0]),
          'A merge key << is not allowed.',
          'Write the merged keys out instead of using <<.',
        );
      }
      if (RESERVED_KEYS.has(key.value)) {
        throw refuse(
          file,
          lineAt(key.range?.[0]),
          `The key "${key.value}" is reserved and not allowed.`,
          'Rename the key.',
        );
      }
    },
  });
}

/** Reads one config file's bytes into plain data. Every refusal is a FactoryError (code `yaml_invalid`, exit 2). */
export function readYamlConfig(input: { file: string; bytes: Uint8Array }): YamlConfig {
  const { file, bytes } = input;
  if (bytes.byteLength > MAX_CONFIG_BYTES) {
    throw refuse(
      file,
      undefined,
      `The config file is ${bytes.byteLength} bytes, over the 1 MiB limit.`,
      'Shrink the file. Config files hold settings, not data.',
    );
  }

  const lines = new LineCounter();
  const doc = parseDocument(decode(file, bytes), { ...PARSE_OPTIONS, lineCounter: lines });
  assertPlainData(doc, lines, file);

  return {
    value: doc.toJS({ maxAliasCount: 0 }) as unknown,
    lineOf(path) {
      let node: unknown = doc.contents;
      let marker: { range?: [number, number, number] | null } | undefined;
      for (const segment of path) {
        if (isMap(node)) {
          const pair = node.items.find((item) => isScalar(item.key) && item.key.value === segment);
          if (!pair) {
            return 1;
          }
          marker = pair.key as typeof marker;
          node = pair.value;
        } else if (isSeq(node) && typeof segment === 'number') {
          const item = node.items[segment];
          if (item === undefined) {
            return 1;
          }
          marker = item as typeof marker;
          node = item;
        } else {
          return 1;
        }
      }
      const offset = marker?.range?.[0];
      return offset === undefined ? 1 : lines.linePos(offset).line;
    },
  };
}
