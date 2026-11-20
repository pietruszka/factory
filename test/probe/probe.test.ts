import {
  chmodSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { createDevHome } from '../../src/dev/home.js';
import { runProbe } from '../../src/probe/probe.js';

const tempDirs: string[] = [];

function makeTempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  tempDirs.push(directory);
  return directory;
}

function writeFakeCli(binDir: string, commandName: 'agent' | 'opencode', body: string): void {
  const scriptPath = join(binDir, commandName);
  writeFileSync(
    scriptPath,
    ['#!/usr/bin/env node', body].join('\n'),
    'utf8',
  );
  chmodSync(scriptPath, 0o755);
}

function makeValidFactoryHome(userHome: string): string {
  return createDevHome(join(userHome, 'factory-dev-home'), { HOME: userHome });
}

function readJsonFile(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

interface FakeCommandResult {
  exitCode?: number;
  stdoutLines?: string[];
  stderrLines?: string[];
}

function renderFakeResult(result: FakeCommandResult = {}): string {
  const stdoutLines = result.stdoutLines ?? [];
  const stderrLines = result.stderrLines ?? [];
  const exitCode = result.exitCode ?? 0;
  return [
    ...stdoutLines.map((line) => `process.stdout.write(${JSON.stringify(`${line}\n`)});`),
    ...stderrLines.map((line) => `process.stderr.write(${JSON.stringify(`${line}\n`)});`),
    `process.exit(${exitCode});`,
  ].join('\n');
}

function buildAgentCliScript(input: {
  status?: FakeCommandResult;
  beforeStatus?: string;
  run?: FakeCommandResult;
  beforeRun?: string;
}): string {
  return [
    'const args = process.argv.slice(2);',
    "if (args.includes('--help')) {",
    "  process.stdout.write('agent --help supports -p --mode --trust --output-format --model\\n');",
    '  process.exit(0);',
    '}',
    "if (args[0] === 'status') {",
    input.beforeStatus ?? '',
    renderFakeResult(input.status),
    '}',
    input.beforeRun ?? '',
    renderFakeResult(input.run),
  ].join('\n');
}

function buildOpenCodeCliScript(input: {
  helpText?: string;
  run?: FakeCommandResult;
  beforeRun?: string;
}): string {
  const helpText = input.helpText ?? 'opencode run --help supports run --format --model';
  return [
    'const args = process.argv.slice(2);',
    "if (args[0] === 'run' && args.includes('--help')) {",
    `  process.stdout.write(${JSON.stringify(`${helpText}\n`)});`,
    '  process.exit(0);',
    '}',
    "if (args[0] !== 'run') {",
    "  process.stderr.write('expected run\\n');",
    '  process.exit(1);',
    '}',
    input.beforeRun ?? '',
    renderFakeResult(input.run),
  ].join('\n');
}

function createNodeOnlyPathDir(): string {
  const nodeOnlyDir = makeTempDir('factory-node-only-');
  symlinkSync(process.execPath, join(nodeOnlyDir, 'node'));
  return nodeOnlyDir;
}

function pathWithFakeBinOnly(binDir: string, nodeOnlyDir: string): string {
  return `${binDir}:${nodeOnlyDir}`;
}

function runProbeWithCapturedOutput(
  input: Parameters<typeof runProbe>[0],
): { result: ReturnType<typeof runProbe>; output: string } {
  let output = '';
  const result = runProbe({
    ...input,
    out: {
      write(chunk: string): boolean {
        output += chunk;
        return true;
      },
    },
  });
  return { result, output };
}

describe('runProbe', () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const directory = tempDirs.pop();
      if (directory) {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  });

  test('refuses when not live and does not spawn any CLI', () => {
    const userHome = makeTempDir('factory-user-home-');
    const factoryHome = makeValidFactoryHome(userHome);
    const repoRoot = makeTempDir('factory-repo-root-');
    const binDir = join(userHome, 'bin');
    const nodeOnlyDir = createNodeOnlyPathDir();
    const markerFile = join(userHome, 'spawned.txt');
    mkdirSync(binDir, { recursive: true });

    const scriptBody = `const { appendFileSync } = require('node:fs');
appendFileSync(${JSON.stringify(markerFile)}, 'spawned\\n');
process.stdout.write('{}\\n');`;

    writeFakeCli(binDir, 'agent', scriptBody);
    writeFakeCli(binDir, 'opencode', scriptBody);

    expect(() =>
      runProbe({
        env: {
          HOME: userHome,
          FACTORY_HOME: factoryHome,
          PATH: pathWithFakeBinOnly(binDir, nodeOnlyDir),
        },
        repoRoot,
      }),
    ).toThrow(/FACTORY_LIVE/);

    expect(() => readFileSync(markerFile, 'utf8')).toThrow();
  });

  test('refuses bad dev home and does not spawn any CLI', () => {
    const userHome = makeTempDir('factory-user-home-');
    const badFactoryHome = join(userHome, 'bad-home-without-marker');
    const repoRoot = makeTempDir('factory-repo-root-');
    const binDir = join(userHome, 'bin');
    const nodeOnlyDir = createNodeOnlyPathDir();
    const markerFile = join(userHome, 'spawned.txt');
    mkdirSync(binDir, { recursive: true });
    mkdirSync(badFactoryHome, { recursive: true });

    const scriptBody = `const { appendFileSync } = require('node:fs');
appendFileSync(${JSON.stringify(markerFile)}, 'spawned\\n');
process.stdout.write('{}\\n');`;

    writeFakeCli(binDir, 'agent', scriptBody);
    writeFakeCli(binDir, 'opencode', scriptBody);

    expect(() =>
      runProbe({
        env: {
          HOME: userHome,
          FACTORY_HOME: badFactoryHome,
          FACTORY_LIVE: '1',
          PATH: pathWithFakeBinOnly(binDir, nodeOnlyDir),
        },
        repoRoot,
      }),
    ).toThrow(/marker/i);

    expect(() => readFileSync(markerFile, 'utf8')).toThrow();
  });

  test('writes fixture for each successful fake CLI run and copies fixtures into test fixtures', () => {
    const userHome = makeTempDir('factory-user-home-');
    const factoryHome = makeValidFactoryHome(userHome);
    const repoRoot = makeTempDir('factory-repo-root-');
    const binDir = join(userHome, 'bin');
    const nodeOnlyDir = createNodeOnlyPathDir();
    mkdirSync(binDir, { recursive: true });

    writeFakeCli(
      binDir,
      'agent',
      buildAgentCliScript({
        status: {
          stdoutLines: [JSON.stringify({ userInfo: { email: 'dev@example.test' } })],
        },
        run: {
          stdoutLines: [JSON.stringify({ usage: { inputTokens: 1 }, cost: 0.02 })],
        },
      }),
    );
    writeFakeCli(
      binDir,
      'opencode',
      buildOpenCodeCliScript({
        run: {
          stdoutLines: [
            JSON.stringify({ tokens: { inputTokens: 2, outputTokens: 3 } }),
            JSON.stringify({ event: 'partial_cost', cost: 0.01 }),
            JSON.stringify({ event: 'final_cost', cost: 0.03 }),
          ],
        },
      }),
    );

    const { result } = runProbeWithCapturedOutput({
      env: {
        HOME: userHome,
        FACTORY_HOME: factoryHome,
        FACTORY_LIVE: '1',
        PATH: pathWithFakeBinOnly(binDir, nodeOnlyDir),
      },
      repoRoot,
    });

    expect(result.failed).toBe(false);

    const agentFixturePath = join(factoryHome, 'probe', 'cursor-agent.json');
    const opencodeFixturePath = join(factoryHome, 'probe', 'opencode.json');
    const copiedAgentFixturePath = join(repoRoot, 'test', 'fixtures', 'cli', 'cursor-agent', 'probe.json');
    const copiedOpencodeFixturePath = join(repoRoot, 'test', 'fixtures', 'cli', 'opencode', 'probe.json');

    const agentFixture = readJsonFile(agentFixturePath) as Record<string, unknown>;
    expect(agentFixture.prompt).toBe('Reply with exactly: PROBE_OK');
    expect(agentFixture.args).toEqual(
      expect.arrayContaining(['-p', '--mode', 'ask', '--trust', '--output-format', 'json', '--model']),
    );
    expect(agentFixture.stdout).toContain('"cost":0.02');
    expect(agentFixture.stderr).toBe('');
    expect(agentFixture.exitCode).toBe(0);
    expect(typeof agentFixture.durationMs).toBe('number');
    expect(agentFixture.usage).toEqual({ inputTokens: 1 });
    expect(agentFixture.cost).toBe(0.02);

    const opencodeFixture = readJsonFile(opencodeFixturePath) as Record<string, unknown>;
    expect(opencodeFixture.prompt).toBe('Reply with exactly: PROBE_OK');
    expect(opencodeFixture.args).toEqual(
      expect.arrayContaining(['run', '--format', 'json', '--model']),
    );
    expect(opencodeFixture.stdout).toContain('"partial_cost"');
    expect(opencodeFixture.stderr).toBe('');
    expect(opencodeFixture.exitCode).toBe(0);
    expect(typeof opencodeFixture.durationMs).toBe('number');
    expect(opencodeFixture.usage).toEqual({ inputTokens: 2, outputTokens: 3 });
    expect(opencodeFixture.cost).toBe(0.04);

    expect(readJsonFile(copiedAgentFixturePath)).toEqual(agentFixture);
    expect(readJsonFile(copiedOpencodeFixturePath)).toEqual(opencodeFixture);

    const summary = readJsonFile(join(factoryHome, 'probe', 'summary.json')) as Record<string, unknown>;
    expect(summary.totalReportedCostUsd).toBe(0.06);
    expect(summary.costByCli).toEqual({
      'cursor-agent': 0.02,
      opencode: 0.04,
    });
    expect(readJsonFile(join(repoRoot, 'test', 'fixtures', 'cli', 'summary.json'))).toEqual(summary);
  });

  test('records missing cursor agent and successful opencode independently and returns failed result', () => {
    const userHome = makeTempDir('factory-user-home-');
    const factoryHome = makeValidFactoryHome(userHome);
    const repoRoot = makeTempDir('factory-repo-root-');
    const binDir = join(userHome, 'bin');
    const nodeOnlyDir = createNodeOnlyPathDir();
    mkdirSync(binDir, { recursive: true });

    writeFakeCli(
      binDir,
      'opencode',
      buildOpenCodeCliScript({
        run: {
          stdoutLines: [JSON.stringify({ usage: { outputTokens: 2 }, cost: 0.03 })],
        },
      }),
    );

    const { result } = runProbeWithCapturedOutput({
      env: {
        HOME: userHome,
        FACTORY_HOME: factoryHome,
        FACTORY_LIVE: '1',
        PATH: pathWithFakeBinOnly(binDir, nodeOnlyDir),
      },
      repoRoot,
    });

    expect(result.failed).toBe(true);

    const agentFixture = readJsonFile(join(factoryHome, 'probe', 'cursor-agent.json')) as Record<
      string,
      unknown
    >;
    expect(agentFixture.failed).toBe(true);
    expect(agentFixture.error).toBe('agent CLI not found');

    const opencodeFixture = readJsonFile(join(factoryHome, 'probe', 'opencode.json')) as Record<
      string,
      unknown
    >;
    expect(opencodeFixture.failed).toBe(false);
    expect(opencodeFixture.error).toBeUndefined();
  });

  test('records missing opencode independently and does not copy failed fixture into repo fixtures', () => {
    const userHome = makeTempDir('factory-user-home-');
    const factoryHome = makeValidFactoryHome(userHome);
    const repoRoot = makeTempDir('factory-repo-root-');
    const binDir = join(userHome, 'bin');
    const nodeOnlyDir = createNodeOnlyPathDir();
    mkdirSync(binDir, { recursive: true });

    writeFakeCli(
      binDir,
      'agent',
      buildAgentCliScript({
        status: {
          stdoutLines: [JSON.stringify({ userInfo: { email: 'dev@example.test' } })],
        },
        run: {
          stdoutLines: [JSON.stringify({ usage: { inputTokens: 1 }, cost: 0.02 })],
        },
      }),
    );

    const { result } = runProbeWithCapturedOutput({
      env: {
        HOME: userHome,
        FACTORY_HOME: factoryHome,
        FACTORY_LIVE: '1',
        PATH: pathWithFakeBinOnly(binDir, nodeOnlyDir),
      },
      repoRoot,
    });

    expect(result.failed).toBe(true);

    const agentFixture = readJsonFile(join(factoryHome, 'probe', 'cursor-agent.json')) as Record<
      string,
      unknown
    >;
    expect(agentFixture.failed).toBe(false);
    expect(
      readJsonFile(join(repoRoot, 'test', 'fixtures', 'cli', 'cursor-agent', 'probe.json')),
    ).toEqual(agentFixture);

    const opencodeFixture = readJsonFile(join(factoryHome, 'probe', 'opencode.json')) as Record<
      string,
      unknown
    >;
    expect(opencodeFixture.failed).toBe(true);
    expect(String(opencodeFixture.error)).toContain('help check failed');
    expect(
      () => readFileSync(join(repoRoot, 'test', 'fixtures', 'cli', 'opencode', 'probe.json'), 'utf8'),
    ).toThrow();
  });

  test('fails when help check output misses required flags and still runs the other CLI', () => {
    const userHome = makeTempDir('factory-user-home-');
    const factoryHome = makeValidFactoryHome(userHome);
    const repoRoot = makeTempDir('factory-repo-root-');
    const binDir = join(userHome, 'bin');
    const nodeOnlyDir = createNodeOnlyPathDir();
    mkdirSync(binDir, { recursive: true });

    writeFakeCli(
      binDir,
      'agent',
      buildAgentCliScript({
        status: {
          stdoutLines: [JSON.stringify({ userInfo: { email: 'dev@example.test' } })],
        },
        run: {
          stdoutLines: [JSON.stringify({ usage: { inputTokens: 2 }, cost: 0.01 })],
        },
      }),
    );
    writeFakeCli(
      binDir,
      'opencode',
      buildOpenCodeCliScript({
        helpText: 'opencode run --help supports run and --model only',
        run: {
          stdoutLines: [JSON.stringify({ usage: { outputTokens: 1 }, cost: 0.01 })],
        },
      }),
    );

    const { result } = runProbeWithCapturedOutput({
      env: {
        HOME: userHome,
        FACTORY_HOME: factoryHome,
        FACTORY_LIVE: '1',
        PATH: pathWithFakeBinOnly(binDir, nodeOnlyDir),
      },
      repoRoot,
    });

    expect(result.failed).toBe(true);

    const cursorFixture = readJsonFile(join(factoryHome, 'probe', 'cursor-agent.json')) as Record<
      string,
      unknown
    >;
    expect(cursorFixture.failed).toBe(false);

    const opencodeFixture = readJsonFile(join(factoryHome, 'probe', 'opencode.json')) as Record<
      string,
      unknown
    >;
    expect(opencodeFixture.failed).toBe(true);
    expect(String(opencodeFixture.error)).toContain('help output is missing expected flags');
  });

  test('skips cursor probe when account email is unresolved and records explicit fixture error', () => {
    const userHome = makeTempDir('factory-user-home-');
    const factoryHome = makeValidFactoryHome(userHome);
    const repoRoot = makeTempDir('factory-repo-root-');
    const binDir = join(userHome, 'bin');
    const nodeOnlyDir = createNodeOnlyPathDir();
    const cursorRunMarker = join(userHome, 'cursor-ran.txt');
    mkdirSync(binDir, { recursive: true });

    writeFakeCli(
      binDir,
      'agent',
      buildAgentCliScript({
        status: {
          exitCode: 1,
          stderrLines: ['status failed'],
        },
        beforeRun: `require('node:fs').writeFileSync(${JSON.stringify(cursorRunMarker)}, 'ran\\n', 'utf8');`,
        run: {
          stdoutLines: [JSON.stringify({ usage: { inputTokens: 1 }, cost: 0.2 })],
        },
      }),
    );
    writeFakeCli(
      binDir,
      'opencode',
      buildOpenCodeCliScript({
        run: {
          stdoutLines: [JSON.stringify({ usage: { outputTokens: 2 }, cost: 0.03 })],
        },
      }),
    );

    const { result } = runProbeWithCapturedOutput({
      env: {
        HOME: userHome,
        FACTORY_HOME: factoryHome,
        FACTORY_LIVE: '1',
        PATH: pathWithFakeBinOnly(binDir, nodeOnlyDir),
      },
      repoRoot,
    });

    expect(result.failed).toBe(true);
    expect(() => readFileSync(cursorRunMarker, 'utf8')).toThrow();

    const cursorFixture = readJsonFile(join(factoryHome, 'probe', 'cursor-agent.json')) as Record<
      string,
      unknown
    >;
    expect(cursorFixture.failed).toBe(true);
    expect(cursorFixture.error).toBe('account email unresolved; cannot redact');

    const opencodeFixture = readJsonFile(join(factoryHome, 'probe', 'opencode.json')) as Record<
      string,
      unknown
    >;
    expect(opencodeFixture.failed).toBe(false);
    expect(opencodeFixture.exitCode).toBe(0);
  });

  test('redacts values, including JSON-escaped forms, and skips short values', () => {
    const userHome = makeTempDir('factory-user-home-');
    const factoryHome = makeValidFactoryHome(userHome);
    const repoRoot = makeTempDir('factory-repo-root-');
    const binDir = join(userHome, 'bin');
    const nodeOnlyDir = createNodeOnlyPathDir();
    const secretToken = 'token-secret-value';
    const escapedSecret = 'contains\\slashes"and-quote';
    const accountEmail = 'dev@example.test';
    const firstName = 'Devon';
    const lastName = 'Cursor';
    const fakeUser = 'fac3-user';
    const shortValue = 'dev';
    const gitConfigKeyValue = 'git-config-key-0-value';
    mkdirSync(binDir, { recursive: true });

    writeFakeCli(
      binDir,
      'agent',
      buildAgentCliScript({
        status: {
          stdoutLines: [JSON.stringify({ userInfo: { email: accountEmail, firstName, lastName } })],
        },
        run: {
          stdoutLines: [
            `agent output ${userHome} ${fakeUser} ${accountEmail} ${firstName} ${lastName} ${secretToken} ${shortValue} ${gitConfigKeyValue}`,
            JSON.stringify({ escaped: escapedSecret }),
          ],
        },
      }),
    );
    writeFakeCli(
      binDir,
      'opencode',
      buildOpenCodeCliScript({
        run: {
          stdoutLines: [
            `opencode output ${userHome} ${fakeUser} ${accountEmail} ${secretToken}`,
            JSON.stringify({ escapedAgain: escapedSecret }),
          ],
        },
      }),
    );

    const { output } = runProbeWithCapturedOutput({
      env: {
        HOME: userHome,
        USER: fakeUser,
        FACTORY_HOME: factoryHome,
        FACTORY_LIVE: '1',
        API_TOKEN: secretToken,
        OPENCODE_SERVER_PASSWORD: escapedSecret,
        OPENCODE_AUTH: shortValue,
        GIT_CONFIG_KEY_0: gitConfigKeyValue,
        PATH: pathWithFakeBinOnly(binDir, nodeOnlyDir),
      },
      repoRoot,
    });
    expect(output).toContain('Total reported probe cost: unknown');

    const cursorSaved = readFileSync(join(factoryHome, 'probe', 'cursor-agent.json'), 'utf8');
    const opencodeSaved = readFileSync(join(factoryHome, 'probe', 'opencode.json'), 'utf8');
    expect(cursorSaved).not.toContain(userHome);
    expect(cursorSaved).not.toContain(fakeUser);
    expect(cursorSaved).not.toContain(accountEmail);
    expect(cursorSaved).not.toContain(firstName);
    expect(cursorSaved).not.toContain(lastName);
    expect(cursorSaved).not.toContain(secretToken);
    const jsonEscapedSecret = JSON.stringify(escapedSecret).slice(1, -1);
    expect(cursorSaved).not.toContain(jsonEscapedSecret);
    expect(opencodeSaved).toContain('\\"escapedAgain\\":\\"[REDACTED]\\"');
    expect(cursorSaved).toContain(shortValue);
    expect(cursorSaved).toContain(gitConfigKeyValue);
    expect(cursorSaved).toContain('[REDACTED]');
    const summary = readJsonFile(join(factoryHome, 'probe', 'summary.json')) as Record<string, unknown>;
    expect(summary.totalReportedCostUsd).toBe('unknown');
    expect(summary.skippedRedactionEnvNames).toEqual(['OPENCODE_AUTH']);
  });

  test('keeps real HOME for child CLIs, strips XDG/OPENCODE overrides, and uses sandbox cwd', () => {
    const userHome = makeTempDir('factory-user-home-');
    const factoryHome = makeValidFactoryHome(userHome);
    const repoRoot = makeTempDir('factory-repo-root-');
    const binDir = join(userHome, 'bin');
    const nodeOnlyDir = createNodeOnlyPathDir();
    mkdirSync(binDir, { recursive: true });

    writeFakeCli(
      binDir,
      'agent',
      buildAgentCliScript({
        status: {
          stdoutLines: [JSON.stringify({ userInfo: { email: 'dev@example.test' } })],
        },
        beforeStatus: `const fs = require('node:fs');
const path = require('node:path');
fs.writeFileSync(path.join(process.cwd(), 'agent-status-cwd-marker.txt'), 'ok\\n', 'utf8');`,
        beforeRun: `const path = require('node:path');
const fs = require('node:fs');
if (process.env.XDG_CONFIG_HOME || process.env.XDG_DATA_HOME || process.env.XDG_STATE_HOME || process.env.XDG_CACHE_HOME || process.env.OPENCODE_TOKEN || process.env.OPENCODE_SERVER_PASSWORD) {
  process.stderr.write('forbidden env leaked\\n');
  process.exit(9);
}
fs.writeFileSync(path.join(process.env.HOME, 'agent-home-marker.txt'), 'ok\\n', 'utf8');
fs.writeFileSync(path.join(process.cwd(), 'agent-cwd-marker.txt'), 'ok\\n', 'utf8');`,
        run: {
          stdoutLines: [JSON.stringify({ usage: { inputTokens: 1 }, cost: 0.01 })],
        },
      }),
    );
    writeFakeCli(
      binDir,
      'opencode',
      buildOpenCodeCliScript({
        beforeRun: `const path = require('node:path');
const fs = require('node:fs');
if (process.env.XDG_CONFIG_HOME || process.env.XDG_DATA_HOME || process.env.XDG_STATE_HOME || process.env.XDG_CACHE_HOME || process.env.OPENCODE_TOKEN || process.env.OPENCODE_SERVER_PASSWORD) {
  process.stderr.write('forbidden env leaked\\n');
  process.exit(9);
}
fs.writeFileSync(path.join(process.env.HOME, 'opencode-home-marker.txt'), 'ok\\n', 'utf8');
fs.writeFileSync(path.join(process.cwd(), 'opencode-cwd-marker.txt'), 'ok\\n', 'utf8');`,
        run: {
          stdoutLines: [JSON.stringify({ usage: { outputTokens: 2 }, cost: 0.01 })],
        },
      }),
    );

    const { result } = runProbeWithCapturedOutput({
      env: {
        HOME: userHome,
        FACTORY_HOME: factoryHome,
        FACTORY_LIVE: '1',
        XDG_CONFIG_HOME: '/tmp/not-allowed-config',
        XDG_DATA_HOME: '/tmp/not-allowed-data',
        XDG_STATE_HOME: '/tmp/not-allowed-state',
        XDG_CACHE_HOME: '/tmp/not-allowed-cache',
        OPENCODE_TOKEN: 'secret-opencode-token',
        OPENCODE_SERVER_PASSWORD: 'secret-opencode-password',
        PATH: pathWithFakeBinOnly(binDir, nodeOnlyDir),
      },
      repoRoot,
    });

    expect(result.failed).toBe(false);
    expect(readFileSync(join(userHome, 'agent-home-marker.txt'), 'utf8')).toContain('ok');
    expect(readFileSync(join(userHome, 'opencode-home-marker.txt'), 'utf8')).toContain('ok');
    expect(
      readFileSync(join(factoryHome, 'sandbox', 'probe-cursor-agent', 'agent-status-cwd-marker.txt'), 'utf8'),
    ).toContain('ok');
    expect(readFileSync(join(factoryHome, 'sandbox', 'probe-cursor-agent', 'agent-cwd-marker.txt'), 'utf8')).toContain('ok');
    expect(readFileSync(join(factoryHome, 'sandbox', 'probe-opencode', 'opencode-cwd-marker.txt'), 'utf8')).toContain('ok');
  });

  test('extracts usage from exact usage/tokens objects and avoids descending after cost key match', () => {
    const userHome = makeTempDir('factory-user-home-');
    const factoryHome = makeValidFactoryHome(userHome);
    const repoRoot = makeTempDir('factory-repo-root-');
    const binDir = join(userHome, 'bin');
    const nodeOnlyDir = createNodeOnlyPathDir();
    mkdirSync(binDir, { recursive: true });

    writeFakeCli(
      binDir,
      'agent',
      buildAgentCliScript({
        status: {
          stdoutLines: [JSON.stringify({ userInfo: { email: 'dev@example.test' } })],
        },
        run: {
          stdoutLines: [
            JSON.stringify({
              request: { max_tokens: 4096 },
              usage: { inputTokens: 7, outputTokens: 8 },
              total_cost_usd: 0.5,
              cost: { cost_usd: 0.9 },
            }),
          ],
        },
      }),
    );
    writeFakeCli(
      binDir,
      'opencode',
      buildOpenCodeCliScript({
        run: {
          stdoutLines: [
            JSON.stringify({
              inputTokens: 1234,
              tokens: { outputTokens: 2 },
              cost_usd: '0.25',
              cost: { nested: 99 },
            }),
          ],
        },
      }),
    );

    const { result } = runProbeWithCapturedOutput({
      env: {
        HOME: userHome,
        FACTORY_HOME: factoryHome,
        FACTORY_LIVE: '1',
        PATH: pathWithFakeBinOnly(binDir, nodeOnlyDir),
      },
      repoRoot,
    });

    expect(result.failed).toBe(false);
    const agentFixture = readJsonFile(join(factoryHome, 'probe', 'cursor-agent.json')) as Record<
      string,
      unknown
    >;
    expect(agentFixture.usage).toEqual({ inputTokens: 7, outputTokens: 8 });
    expect(agentFixture.cost).toBe(0.5);

    const opencodeFixture = readJsonFile(join(factoryHome, 'probe', 'opencode.json')) as Record<
      string,
      unknown
    >;
    expect(opencodeFixture.usage).toEqual({ outputTokens: 2 });
    expect(opencodeFixture.cost).toBe(0.25);
  });

  test('handles per-cli exceptions without aborting the other probe', () => {
    const userHome = makeTempDir('factory-user-home-');
    const factoryHome = makeValidFactoryHome(userHome);
    const repoRoot = makeTempDir('factory-repo-root-');
    const binDir = join(userHome, 'bin');
    const nodeOnlyDir = createNodeOnlyPathDir();
    mkdirSync(binDir, { recursive: true });
    mkdirSync(join(factoryHome, 'sandbox'), { recursive: true });
    writeFileSync(join(factoryHome, 'sandbox', 'probe-opencode'), 'blocking-file', 'utf8');

    writeFakeCli(
      binDir,
      'agent',
      buildAgentCliScript({
        status: {
          stdoutLines: [JSON.stringify({ userInfo: { email: 'dev@example.test' } })],
        },
        run: {
          stdoutLines: [JSON.stringify({ usage: { inputTokens: 1 }, cost: 0.01 })],
        },
      }),
    );
    writeFakeCli(
      binDir,
      'opencode',
      buildOpenCodeCliScript({
        run: {
          stdoutLines: [JSON.stringify({ usage: { outputTokens: 1 }, cost: 0.01 })],
        },
      }),
    );

    const { result } = runProbeWithCapturedOutput({
      env: {
        HOME: userHome,
        FACTORY_HOME: factoryHome,
        FACTORY_LIVE: '1',
        PATH: pathWithFakeBinOnly(binDir, nodeOnlyDir),
      },
      repoRoot,
    });

    expect(result.failed).toBe(true);
    const cursorFixture = readJsonFile(join(factoryHome, 'probe', 'cursor-agent.json')) as Record<
      string,
      unknown
    >;
    expect(cursorFixture.failed).toBe(false);

    const opencodeFixture = readJsonFile(join(factoryHome, 'probe', 'opencode.json')) as Record<
      string,
      unknown
    >;
    expect(opencodeFixture.failed).toBe(true);
    expect(String(opencodeFixture.error)).toContain('EEXIST');
  });

  test('marks cursor fixture failed when JSON payload has is_error true', () => {
    const userHome = makeTempDir('factory-user-home-');
    const factoryHome = makeValidFactoryHome(userHome);
    const repoRoot = makeTempDir('factory-repo-root-');
    const binDir = join(userHome, 'bin');
    const nodeOnlyDir = createNodeOnlyPathDir();
    mkdirSync(binDir, { recursive: true });

    writeFakeCli(
      binDir,
      'agent',
      buildAgentCliScript({
        status: {
          stdoutLines: [JSON.stringify({ userInfo: { email: 'dev@example.test' } })],
        },
        run: {
          stdoutLines: [JSON.stringify({ is_error: true, cost: 0.01 })],
        },
      }),
    );
    writeFakeCli(
      binDir,
      'opencode',
      buildOpenCodeCliScript({
        run: {
          stdoutLines: [JSON.stringify({ usage: { outputTokens: 1 }, cost: 0.01 })],
        },
      }),
    );

    const { result } = runProbeWithCapturedOutput({
      env: {
        HOME: userHome,
        FACTORY_HOME: factoryHome,
        FACTORY_LIVE: '1',
        PATH: pathWithFakeBinOnly(binDir, nodeOnlyDir),
      },
      repoRoot,
    });

    expect(result.failed).toBe(true);
    const cursorFixture = readJsonFile(join(factoryHome, 'probe', 'cursor-agent.json')) as Record<
      string,
      unknown
    >;
    expect(cursorFixture.failed).toBe(true);
  });

  test('records BudgetExceeded per CLI and prints exact total', () => {
    const userHome = makeTempDir('factory-user-home-');
    const factoryHome = makeValidFactoryHome(userHome);
    const repoRoot = makeTempDir('factory-repo-root-');
    const binDir = join(userHome, 'bin');
    const nodeOnlyDir = createNodeOnlyPathDir();
    mkdirSync(binDir, { recursive: true });

    writeFakeCli(
      binDir,
      'agent',
      buildAgentCliScript({
        status: {
          stdoutLines: [JSON.stringify({ userInfo: { email: 'dev@example.test' } })],
        },
        run: {
          stdoutLines: [JSON.stringify({ usage: { inputTokens: 4 }, cost: 1.2 })],
        },
      }),
    );
    writeFakeCli(
      binDir,
      'opencode',
      buildOpenCodeCliScript({
        run: {
          stdoutLines: [JSON.stringify({ usage: { outputTokens: 3 }, cost: 0.2 })],
        },
      }),
    );

    const { result, output } = runProbeWithCapturedOutput({
      env: {
        HOME: userHome,
        FACTORY_HOME: factoryHome,
        FACTORY_LIVE: '1',
        PATH: pathWithFakeBinOnly(binDir, nodeOnlyDir),
      },
      repoRoot,
    });

    expect(result.failed).toBe(true);
    expect(output).toContain('Total reported probe cost: $1.400000');

    const agentFixture = readJsonFile(join(factoryHome, 'probe', 'cursor-agent.json')) as Record<
      string,
      unknown
    >;
    expect(agentFixture.budgetExceeded).toBe(true);
    expect(agentFixture.error).toContain('Budget exceeded');
  });
});
