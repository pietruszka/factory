import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';

import { DEFAULT_MODELS, renderModelsSectionYaml } from '../../src/config/models.js';
import { DEV_HOME_MARKER } from '../../src/dev/home.js';
import { loadOpenCodeModelIds, runModelsPreflight, runPreflight } from '../../src/preflight/models.js';

describe('runModelsPreflight', () => {
  test('passes when all checks pass and accepts injected CLI model lists', () => {
    const result = runModelsPreflight(
      {
        planner: { cli: 'cursor-agent', model: 'gpt-5.3-codex-high', family: 'gpt' },
        builder: { cli: 'cursor-agent', model: 'gpt-5.3-codex-high', family: 'gpt' },
        reviewer: { cli: 'cursor-agent', model: 'claude-opus-5-5-high', family: 'claude' },
        visionJudge: {
          cli: null,
          model: 'claude-opus-5-5-high',
          family: 'claude',
          note: 'still open',
        },
      },
      async () => ({
        'cursor-agent': ['gpt-5.3-codex-high', 'claude-opus-5-5-high'],
      }),
    );

    return expect(result).resolves.toEqual({ ok: true, errors: [] });
  });

  test('fails when an injected CLI list does not accept a configured model id', () => {
    const result = runModelsPreflight(
      {
        planner: { cli: 'cursor-agent', model: 'gpt-5.3-codex-high', family: 'gpt' },
        builder: { cli: 'cursor-agent', model: 'gpt-5.3-codex-high', family: 'gpt' },
        reviewer: { cli: 'cursor-agent', model: 'claude-opus-5-5-high', family: 'claude' },
        visionJudge: {
          cli: null,
          model: 'claude-opus-5-5-high',
          family: 'claude',
          note: 'still open',
        },
      },
      async () => ({
        'cursor-agent': ['gpt-5.3-codex-high'],
      }),
    );

    return expect(result).resolves.toEqual({
      ok: false,
      errors: expect.arrayContaining([
        expect.objectContaining({
          code: 'model_not_accepted_by_cli',
          role: 'reviewer',
        }),
      ]),
    });
  });
});

describe('runPreflight', () => {
  test('uses pipefail command and includes stderr when agent models command fails', async () => {
    const factoryHome = mkdtempSync(join(tmpdir(), 'factory-preflight-'));
    writeFileSync(join(factoryHome, 'config.yaml'), `${renderModelsSectionYaml(DEFAULT_MODELS)}\n`, 'utf8');
    writeFileSync(join(factoryHome, DEV_HOME_MARKER), 'test marker\n', 'utf8');

    const run = runPreflight({
      FACTORY_HOME: factoryHome,
      PATH: '/bin',
    });
    await expect(run).rejects.toThrow(/set -o pipefail; agent models \| cat/);
    await expect(run).rejects.toThrow(/not found|command not found/);
  });

  test('looks up opencode models with a pipefail command when a role uses opencode', async () => {
    const factoryHome = mkdtempSync(join(tmpdir(), 'factory-preflight-'));
    const models = {
      ...DEFAULT_MODELS,
      builder: { cli: 'opencode', model: 'cursor-acp/gpt-5.3-codex-high', family: 'gpt' },
    };
    writeFileSync(join(factoryHome, 'config.yaml'), `${renderModelsSectionYaml(models)}\n`, 'utf8');
    writeFileSync(join(factoryHome, DEV_HOME_MARKER), 'test marker\n', 'utf8');

    const fakeBin = mkdtempSync(join(tmpdir(), 'factory-fake-bin-'));
    const agentPath = join(fakeBin, 'agent');
    writeFileSync(
      agentPath,
      [
        '#!/bin/sh',
        'echo "Available models:"',
        'echo "gpt-5.3-codex-high - GPT 5.3 Codex High"',
        'echo "claude-opus-5-5-high - Claude Opus 5.5"',
        'echo "Tip: Use --model <id> to select a model"',
        '',
      ].join('\n'),
      'utf8',
    );
    chmodSync(agentPath, 0o755);

    const run = runPreflight({
      FACTORY_HOME: factoryHome,
      PATH: `${fakeBin}:/bin`,
    });
    await expect(run).rejects.toThrow(/set -o pipefail; opencode models \| cat/);
    await expect(run).rejects.toThrow(/not found|command not found/);
  });
});

describe('loadOpenCodeModelIds', () => {
  function fakeOpenCode(script: string): { env: NodeJS.ProcessEnv; stateDir: string } {
    const fakeBin = mkdtempSync(join(tmpdir(), 'factory-fake-bin-'));
    const stateDir = mkdtempSync(join(tmpdir(), 'factory-fake-state-'));
    const path = join(fakeBin, 'opencode');
    writeFileSync(path, `#!/bin/sh\nSTATE=${stateDir}\n${script}\n`, 'utf8');
    chmodSync(path, 0o755);
    return { env: { PATH: `${fakeBin}:/bin:/usr/bin`, HOME: stateDir }, stateDir };
  }

  test('polls the background service until the wanted cursor-acp ids appear', () => {
    const { env, stateDir } = fakeOpenCode(
      [
        'echo "$@" >> "$STATE/args"',
        'pwd >> "$STATE/cwd"',
        'n=$(cat "$STATE/n" 2>/dev/null || echo 0); n=$((n+1)); echo $n > "$STATE/n"',
        'echo cursor-acp/composer-2.5',
        'if [ $n -ge 3 ]; then echo cursor-acp/gpt-5.3-codex-high; fi',
      ].join('\n'),
    );
    const ids = loadOpenCodeModelIds(env, ['cursor-acp/gpt-5.3-codex-high'], { attempts: 5, delayMs: 1 });
    expect(ids).toContain('cursor-acp/gpt-5.3-codex-high');
    expect(readFileSync(join(stateDir, 'n'), 'utf8').trim()).toBe('3');
    const args = readFileSync(join(stateDir, 'args'), 'utf8');
    expect(args).not.toMatch(/--standalone|--auto/);
    expect(readFileSync(join(stateDir, 'cwd'), 'utf8')).not.toMatch(/\/(Documents|Desktop|Downloads)(\/|$)/m);
  });

  test('returns the last list after the attempts run out', () => {
    const { env } = fakeOpenCode('echo cursor-acp/composer-2.5');
    const ids = loadOpenCodeModelIds(env, ['cursor-acp/gpt-5.3-codex-high'], { attempts: 2, delayMs: 1 });
    expect(ids).toEqual(['cursor-acp/composer-2.5']);
  });

  test('throws with stderr when the service fails', () => {
    const { env } = fakeOpenCode('echo "ClientError: UnexpectedStatus: 500" >&2; exit 1');
    expect(() => loadOpenCodeModelIds(env, [], { attempts: 1, delayMs: 1 })).toThrow(/UnexpectedStatus: 500/);
  });
});
