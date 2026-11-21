import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { parseCursorAgentStepResult } from '../../src/adapters/cursor-agent.js';
import { parseOpenCodeStepResult } from '../../src/adapters/opencode.js';
import { toRawStepInput } from '../support/raw-step-input.js';

type CliName = 'cursor-agent' | 'opencode';

interface RawStepFixture {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  cliVersion: string;
}

interface CaseFixture {
  derivedFrom: string;
  raw: RawStepFixture;
}

interface ProbeFixture extends Record<string, unknown> {
  stdout?: unknown;
  stderr?: unknown;
  exitCode?: unknown;
  timedOut?: unknown;
  cliVersion?: unknown;
}

interface PinsFixture {
  [key: string]: string;
}

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function readCase(cli: CliName, caseName: string): RawStepFixture {
  const path = join(process.cwd(), 'test', 'fixtures', 'cli', cli, 'cases', `${caseName}.json`);
  const fixture = readJsonFile<CaseFixture>(path);
  return fixture.raw;
}

function readProbe(cli: CliName): RawStepFixture {
  const path = join(process.cwd(), 'test', 'fixtures', 'cli', cli, 'probe.json');
  const fixture = readJsonFile<ProbeFixture>(path);
  return toRawStepInput(fixture);
}

function parseNumericCore(version: string): number[] {
  // OpenCode 2.x prints `opencode v2.3.2`; 1.x printed `1.19.5`; Cursor prints `2026.11.19-hash`.
  const match = /\d+(?:\.\d+)+/.exec(version);
  if (!match) {
    return [];
  }
  return match[0].split('.').map((part) => Number(part));
}

function compareNumericParts(leftParts: number[], rightParts: number[]): number {
  const maxLength = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < maxLength; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;
    if (leftValue < rightValue) {
      return -1;
    }
    if (leftValue > rightValue) {
      return 1;
    }
  }
  return 0;
}

function compareVersion(left: string, right: string): number {
  // Cursor uses YYYY.MM.DD-hash, OpenCode uses semver; in both cases compare numeric core only.
  const leftCore = parseNumericCore(left);
  const rightCore = parseNumericCore(right);
  return compareNumericParts(leftCore, rightCore);
}

function assertFixtureFresh(raw: RawStepFixture, cli: CliName): void {
  const pinsPath = join(process.cwd(), 'test', 'fixtures', 'cli', 'pins.json');
  const pins = readJsonFile<PinsFixture>(pinsPath);
  const pin = pins[cli];
  if (!pin) {
    throw new Error(`Missing pin for ${cli}.`);
  }
  if (compareVersion(raw.cliVersion, pin) < 0) {
    throw new Error(`stale fixture: ${cli} fixture ${raw.cliVersion} is older than pin ${pin}`);
  }
}

function readAllCaseNames(cli: CliName): string[] {
  const caseDir = join(process.cwd(), 'test', 'fixtures', 'cli', cli, 'cases');
  return readdirSync(caseDir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => name.replace(/\.json$/, ''));
}

test('version comparison ignores cursor hash and compares semver cores', () => {
  expect(compareVersion('2026.11.18-anything', '2026.11.19-f005e9d')).toBeLessThan(0);
  expect(compareVersion('2026.11.19-abcdef0', '2026.11.19-f005e9d')).toBe(0);
  expect(compareVersion('2026.11.20-next', '2026.11.19-f005e9d')).toBeGreaterThan(0);
  expect(compareVersion('1.9.0', '1.19.5')).toBeLessThan(0);
  expect(compareVersion('1.19.4', '1.19.5')).toBeLessThan(0);
  expect(compareVersion('1.20.0', '1.19.5')).toBeGreaterThan(0);
  expect(compareVersion('opencode v2.3.2', '1.19.5')).toBeGreaterThan(0);
  expect(compareVersion('opencode v1.2.0', '1.19.5')).toBeLessThan(0);
  expect(compareVersion('opencode v2.3.2', '2.3.2')).toBe(0);
});

function readOpenCodeCursorAcpProbe(): RawStepFixture {
  const path = join(process.cwd(), 'test', 'fixtures', 'cli', 'opencode', 'probe-cursor-acp.json');
  return toRawStepInput(readJsonFile<ProbeFixture>(path));
}

test('all checked-in probe and case fixtures are fresh for each CLI', () => {
  const clis: CliName[] = ['cursor-agent', 'opencode'];
  assertFixtureFresh(readOpenCodeCursorAcpProbe(), 'opencode');
  for (const cli of clis) {
    assertFixtureFresh(readProbe(cli), cli);
    for (const caseName of readAllCaseNames(cli)) {
      assertFixtureFresh(readCase(cli, caseName), cli);
    }
  }
});

describe.each([
  ['cursor-agent', parseCursorAgentStepResult],
  ['opencode', parseOpenCodeStepResult],
] as const)('%s adapter contract', (cli, parse) => {
  test('parses real probe fixture with exact values', () => {
    const raw = readProbe(cli);
    assertFixtureFresh(raw, cli);
    const result = parse(raw);
    expect(result.status).toBe('ok');
    if (cli === 'cursor-agent') {
      expect(result.text).toBe('PROBE_OK');
      expect(result.sessionId).toBe('2e6ed06f-69f9-4a5e-a3ec-64fd96b09ae7');
      expect(result.cost).toBe('cost_missing');
    } else {
      expect(result.text).toBe('PROBE_OK');
      expect(result.sessionId).toBe('ses_e04ec1ddbffeQqQ7qqbtvXp8nH');
      expect(result.cost).toBe(0);
    }
    expect(result.cliVersion).toBe(raw.cliVersion);
  });

  test('maps malformed json to malformed status without throwing', () => {
    const raw = readCase(cli, 'malformed-json');
    const result = parse(raw);
    expect(result.status).toBe('malformed');
  });

  test('maps timeout and non-zero exit statuses', () => {
    const timeout = readCase(cli, 'timeout');
    const timeoutResult = parse(timeout);
    expect(timeoutResult.status).toBe('timeout');

    const nonZero = readCase(cli, 'exit-nonzero');
    const nonZeroResult = parse(nonZero);
    expect(nonZeroResult.status).toBe('exit_nonzero');
  });

  test(
    cli === 'cursor-agent'
      ? 'maps missing cost to cost_missing (Cursor cost is always missing in this adapter)'
      : 'maps missing cost to cost_missing',
    () => {
      const raw = readCase(cli, 'no-cost');
      const result = parse(raw);
      expect(result.cost).toBe('cost_missing');
    },
  );

  test('maps empty stdout with exit 0 to malformed', () => {
    const result = parse({
      stdout: '',
      stderr: '',
      exitCode: 0,
      cliVersion: '1.0.0',
    });
    expect(result.status).toBe('malformed');
  });

  test('never throws and maps invalid raw inputs to malformed', () => {
    for (const invalidRaw of [undefined, 'str', {}]) {
      expect(() => parse(invalidRaw)).not.toThrow();
      const result = parse(invalidRaw);
      expect(result.status).toBe('malformed');
    }
  });

  test('maps success without terminal success event to malformed', () => {
    const raw =
      cli === 'cursor-agent'
        ? {
            stdout: '{"type":"error","result":"auth failed"}\n',
            stderr: '',
            exitCode: 0,
            cliVersion: '2026.11.19-f005e9d',
          }
        : {
            stdout:
              '{"type":"text","part":{"type":"text","text":"still running"}}\n{"type":"error","part":{"type":"error"}}\n',
            stderr: '',
            exitCode: 0,
            cliVersion: '1.19.5',
          };
    const result = parse(raw);
    expect(result.status).toBe('malformed');
  });

  test('maps cursor is_error=true with exit 0 to exit_nonzero', () => {
    if (cli !== 'cursor-agent') {
      return;
    }
    const result = parse({
      stdout:
        '{"type":"result","subtype":"error","is_error":true,"result":"auth failed","session_id":"sid_cursor_123"}\n',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      cliVersion: '2026.11.19-f005e9d',
    });
    expect(result.status).toBe('exit_nonzero');
    expect(result.text).toBe('auth failed');
  });

  test('fills missing cursor cost with estimate when a priced model id is provided', () => {
    if (cli !== 'cursor-agent') {
      return;
    }
    const result = parse(
      {
        stdout:
          '{"type":"result","subtype":"success","is_error":false,"result":"ok","usage":{"inputTokens":1000000,"outputTokens":2000000,"cacheReadTokens":3000000,"cacheWriteTokens":0}}',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        cliVersion: '2026.11.19-f005e9d',
      },
      'claude-opus-5-5-high',
    );
    expect(result.cost).toBe(44.6);
    expect(result.estimated).toBe(true);
  });

  test('keeps cursor cost_missing when model pricing is unknown', () => {
    if (cli !== 'cursor-agent') {
      return;
    }
    const result = parse(
      {
        stdout:
          '{"type":"result","subtype":"success","is_error":false,"result":"ok","usage":{"inputTokens":1000000,"outputTokens":2000000,"cacheReadTokens":3000000,"cacheWriteTokens":0}}',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        cliVersion: '2026.11.19-f005e9d',
      },
      'gpt-5.3-codex-high',
    );
    expect(result.cost).toBe('cost_missing');
    expect(result.estimated).toBeUndefined();
  });

  test('keeps cursor cost_missing when usage object has no known token fields', () => {
    if (cli !== 'cursor-agent') {
      return;
    }
    const result = parse(
      {
        stdout: '{"type":"result","subtype":"success","is_error":false,"result":"ok","usage":{}}',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        cliVersion: '2026.11.19-f005e9d',
      },
      'claude-opus-5-5-high',
    );
    expect(result.cost).toBe('cost_missing');
    expect(result.estimated).toBeUndefined();
  });

  test('sums multi-step OpenCode cost values', () => {
    if (cli !== 'opencode') {
      return;
    }
    const result = parse({
      stdout:
        '{"type":"text","part":{"type":"text","text":"PROBE_OK"}}\n' +
        '{"type":"step_finish","part":{"type":"step-finish","cost":0.01}}\n' +
        '{"type":"step_finish","part":{"type":"step-finish","cost":0.02}}\n',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      cliVersion: '1.19.5',
    });
    expect(result.status).toBe('ok');
    expect(result.cost).toBe(0.03);
  });

  test('prefers CLI-reported cost over estimation when cost is present', () => {
    if (cli !== 'opencode') {
      return;
    }
    const result = parse(
      {
        stdout:
          '{"type":"text","part":{"type":"text","text":"PROBE_OK"}}\n' +
          '{"type":"step_finish","part":{"type":"step-finish","tokens":{"input":1000000,"output":1000000,"cache":{"read":1000000}},"cost":0.03}}\n',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        cliVersion: '1.19.5',
      },
      'claude-opus-5-5-high',
    );
    expect(result.cost).toBe(0.03);
    expect(result.estimated).toBeUndefined();
  });

  test('estimates OpenCode cost from summed step tokens and counts reasoning as output', () => {
    if (cli !== 'opencode') {
      return;
    }
    const result = parse(
      {
        stdout:
          '{"type":"text","part":{"type":"text","text":"PROBE_OK"}}\n' +
          '{"type":"step_finish","part":{"type":"step-finish","tokens":{"input":1000000,"output":1000000,"reasoning":500000,"cache":{"read":1000000}}}}\n' +
          '{"type":"step_finish","part":{"type":"step-finish","tokens":{"output":500000,"reasoning":500000,"cache":{"write":1000000}}}}\n',
        stderr: '',
        exitCode: 0,
        timedOut: false,
        cliVersion: '1.19.5',
      },
      'claude-opus-5-5-high',
    );
    expect(result.cost).toBe(59.2);
    expect(result.estimated).toBe(true);
  });

  test('keeps OpenCode zero-token usage instead of dropping it', () => {
    if (cli !== 'opencode') {
      return;
    }
    const result = parse({
      stdout:
        '{"type":"text","part":{"type":"text","text":"PROBE_OK"}}\n' +
        '{"type":"step_finish","part":{"type":"step-finish","tokens":{"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}},"cost":0}}\n',
      stderr: '',
      exitCode: 0,
      timedOut: false,
      cliVersion: '1.19.5',
    });
    expect(result.status).toBe('ok');
    expect(result.usage).toEqual({
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    });
  });

  test('uses stderr fallback for OpenCode when no text events are present', () => {
    if (cli !== 'opencode') {
      return;
    }
    const result = parse({
      stdout:
        '{"type":"step_start","part":{"type":"step-start"}}\n' +
        '{"type":"step_finish","part":{"type":"step-finish","cost":0.01}}\n',
      stderr: 'from-stderr',
      exitCode: 0,
      timedOut: false,
      cliVersion: '1.19.5',
    });
    expect(result.status).toBe('ok');
    expect(result.text).toBe('from-stderr');
  });

  test('handles open-ended extra keys in raw fixture input', () => {
    const raw = readCase(cli, 'no-cost');
    const result = parse({ ...raw, extraField: 'ignored' });
    expect(result.status).not.toBe('malformed');
  });

  test('handles both session-id present and absent', () => {
    const withSession = parse(readCase(cli, 'session-id-present'));
    expect(withSession.status).toBe('ok');
    expect(withSession.sessionId).toBe(cli === 'cursor-agent' ? 'sid_cursor_123' : 'ses_present');

    const withoutSession = parse(readCase(cli, 'session-id-absent'));
    expect(withoutSession.status).toBe('ok');
    expect(withoutSession.sessionId).toBeUndefined();
  });

  test('fails stale fixtures with clear message', () => {
    const raw = readProbe(cli);
    const stale = {
      ...raw,
      cliVersion: '0.0.0',
    };
    expect(() => assertFixtureFresh(stale, cli)).toThrow(/stale fixture/i);
  });
});

describe('opencode via cursor-acp/ (Cursor models through OpenCode)', () => {
  test('parses the real cursor-acp/gpt-5.4-nano-none probe with exact values', () => {
    const raw = readOpenCodeCursorAcpProbe();
    const result = parseOpenCodeStepResult(raw, 'cursor-acp/gpt-5.4-nano-none');
    expect(result.status).toBe('ok');
    // Final answer is the last step's text, not the tool-call JSON the bridge emitted in earlier steps.
    expect(result.text).toBe('PROBE_OK');
    expect(result.sessionId).toBe('ses_e02c36948ffea7GVTfW1kAnece');
    // OpenCode reports a real (non-zero) cost for Cursor-backed models; it is not estimated.
    expect(result.cost).toBe(0.00490775);
    expect(result.estimated).toBeUndefined();
    expect(result.usage).toEqual({ input: 24495, output: 7, reasoning: 0, cache: { read: 0, write: 0 } });
  });

  test('keeps text from the last step that produced text', () => {
    const step = (text: string, reason: string) =>
      [
        '{"type":"step_start","sessionID":"ses_x","part":{"type":"step-start"}}',
        `{"type":"text","sessionID":"ses_x","part":{"type":"text","text":${JSON.stringify(text)}}}`,
        `{"type":"step_finish","sessionID":"ses_x","part":{"type":"step-finish","reason":"${reason}","cost":0}}`,
      ].join('\n');
    const result = parseOpenCodeStepResult({
      stdout: `${step('{"name":"write"}', 'tool-calls')}\n${step('DONE', 'stop')}\n`,
      stderr: '',
      exitCode: 0,
      cliVersion: '1.19.5',
    });
    expect(result.text).toBe('DONE');
  });
});

describe('opencode 2.x', () => {
  test('maps the real 2.x background-service error event to exit_nonzero with its message', () => {
    const raw = readCase('opencode', 'service-error-2x');
    const result = parseOpenCodeStepResult(raw);
    expect(result.status).toBe('exit_nonzero');
    expect(result.text).toBe('UnexpectedStatus: 500');
    // The error event carries sessionID "" before a session exists; that is not a session id.
    expect(result.sessionId).toBeUndefined();
    expect(result.cost).toBe('cost_missing');
  });

  test('an error event with exit 0 is not ok', () => {
    const result = parseOpenCodeStepResult({
      stdout: '{"type":"error","sessionID":"","error":{"type":"unknown","message":"boom"}}\n',
      stderr: '',
      exitCode: 0,
      cliVersion: 'opencode v2.3.2',
    });
    expect(result.status).not.toBe('ok');
    expect(result.text).toBe('boom');
  });
});
