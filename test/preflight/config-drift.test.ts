import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';

import { preflight } from '../../src/preflight/preflight.js';
import { cleanupEventLogTest } from '../support/event-log.js';
import {
  agentAndSpend,
  NOTHING_STARTED,
  preflightFixture,
  refusal,
  refusalOf,
  type PreflightFixtureOptions,
} from '../support/preflight.js';

afterEach(cleanupEventLogTest);

/** Preflight on a dry run (no run id) of a repo built from `opts`. */
const drift = (opts: PreflightFixtureOptions) => {
  const fx = preflightFixture(opts);
  return { fx, result: refusalOf(preflight(fx.dryOptions())) };
};

describe('a config that no longer matches the repo', () => {
  test('when a configured gate command names a script that is missing from the repo, preflight fails with config_drift, names the config key, gives a next action, starts no agent, and spends nothing', async () => {
    const fx = preflightFixture({ scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' } });

    const error = await refusalOf(preflight(fx.options()));

    expect(error).toMatchObject(refusal('config_drift'));
    expect(error.message).toContain('gates.lint');
    expect(agentAndSpend(fx)).toEqual(NOTHING_STARTED);
  });

  test('when the configured package manager does not match the repo lockfile, preflight fails with config_drift and names package_manager', async () => {
    const { result } = drift({
      packageManager: 'pnpm',
      install: 'pnpm install',
      gates: { lint: 'pnpm run lint', typecheck: 'pnpm run typecheck', test: 'pnpm test' },
      lockfile: 'package-lock.json',
    });

    const error = await result;

    expect(error).toMatchObject(refusal('config_drift'));
    expect(error.message).toContain('package_manager');
  });

  test('when the repo has no lockfile at all, preflight fails with config_drift and names package_manager', async () => {
    const { result } = drift({ lockfile: null });

    const error = await result;

    expect(error).toMatchObject(refusal('config_drift'));
    expect(error.message).toContain('package_manager');
  });

  test('when the configured install command names a missing script, preflight fails with config_drift and names install', async () => {
    const { result } = drift({ install: 'npm run setup' });

    const error = await result;

    expect(error).toMatchObject(refusal('config_drift'));
    expect(error.message).toContain('install');
  });

  test('when the install command is a builtin of another package manager, preflight fails with config_drift and names install', async () => {
    const { result } = drift({ install: 'pnpm install' });

    const error = await result;

    expect(error).toMatchObject(refusal('config_drift'));
    expect(error.message).toContain('install');
  });

  test('when the gate scripts live in gates_cwd and are missing there, preflight fails with config_drift and names the gate', async () => {
    const { result } = drift({ gatesCwd: 'web', scripts: { typecheck: 'tsc --noEmit', test: 'vitest run' } });

    const error = await result;

    expect(error).toMatchObject(refusal('config_drift'));
    expect(error.message).toContain('gates.lint');
  });
});

describe('a command whose relative path leaves the repo', () => {
  test.each([
    ['gates.lint', { gates: { lint: '../outside.sh' } }],
    ['install', { install: '../outside.sh' }],
  ])('when the %s command path escapes the repo with ../, preflight fails with config_drift even when the file exists outside, names the config key, starts no agent, and spends nothing', async (key, opts) => {
    const fx = preflightFixture(opts);
    writeFileSync(join(fx.repoPath, '..', 'outside.sh'), '#!/bin/sh\n');

    const error = await refusalOf(preflight(fx.options()));

    expect(error).toMatchObject(refusal('config_drift'));
    expect(error.message).toContain(key);
    expect(agentAndSpend(fx)).toEqual(NOTHING_STARTED);
  });

  test('when a relative command path stays inside the repo and the file exists, preflight passes', async () => {
    const fx = preflightFixture({ gates: { lint: './tools/lint.sh' } });
    mkdirSync(join(fx.repoPath, 'tools'), { recursive: true });
    writeFileSync(join(fx.repoPath, 'tools', 'lint.sh'), '#!/bin/sh\n');

    await expect(preflight(fx.dryOptions())).resolves.toMatchObject({ ok: true });
  });
});

describe('a config that still matches the repo', () => {
  test('when scripts, lockfile and install command match, preflight passes', async () => {
    const fx = preflightFixture();

    await expect(preflight(fx.dryOptions())).resolves.toMatchObject({ ok: true });
  });

  test('when the scripts live in gates_cwd, preflight passes', async () => {
    const fx = preflightFixture({ gatesCwd: 'web' });

    await expect(preflight(fx.dryOptions())).resolves.toMatchObject({ ok: true });
  });

  test('a pnpm repo with a pnpm lockfile, a shorthand script gate and pnpm install passes', async () => {
    const fx = preflightFixture({
      packageManager: 'pnpm',
      lockfile: 'pnpm-lock.yaml',
      install: 'pnpm install --frozen-lockfile',
      gates: { lint: 'pnpm lint', typecheck: 'pnpm run typecheck', test: 'pnpm test' },
    });

    await expect(preflight(fx.dryOptions())).resolves.toMatchObject({ ok: true });
  });

  test('a yarn repo with a yarn lockfile and yarn run gates passes', async () => {
    const fx = preflightFixture({
      packageManager: 'yarn',
      lockfile: 'yarn.lock',
      install: 'yarn install --frozen-lockfile',
      gates: { lint: 'yarn lint', typecheck: 'yarn run typecheck', test: 'yarn test' },
    });

    await expect(preflight(fx.dryOptions())).resolves.toMatchObject({ ok: true });
  });

  test('npx in a gate command is accepted for an npm repo', async () => {
    const fx = preflightFixture({ gates: { lint: 'npx eslint .' } });

    await expect(preflight(fx.dryOptions())).resolves.toMatchObject({ ok: true });
  });

  test('gates.build and gates.e2e are not checked when they are not set', async () => {
    const fx = preflightFixture({ gates: { build: null, e2e: null } });

    await expect(preflight(fx.dryOptions())).resolves.toMatchObject({ ok: true });
  });

  test('when gates.build names a missing script, preflight fails with config_drift and names gates.build', async () => {
    const { result } = drift({ gates: { build: 'npm run build' } });

    const error = await result;

    expect(error).toMatchObject(refusal('config_drift'));
    expect(error.message).toContain('gates.build');
  });

  test('when gates.e2e names a missing script, preflight fails with config_drift and names gates.e2e', async () => {
    const { result } = drift({ gates: { e2e: 'npm run e2e' } });

    const error = await result;

    expect(error).toMatchObject(refusal('config_drift'));
    expect(error.message).toContain('gates.e2e');
  });

  test('when gates.build and gates.e2e name scripts that exist, preflight passes', async () => {
    const fx = preflightFixture({
      scripts: { lint: 'eslint .', typecheck: 'tsc --noEmit', test: 'vitest run', build: 'tsc', e2e: 'playwright test' },
      gates: { build: 'npm run build', e2e: 'npm run e2e' },
    });

    await expect(preflight(fx.dryOptions())).resolves.toMatchObject({ ok: true });
  });
});
