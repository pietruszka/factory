import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { loadConfig } from '../../src/config/load.js';
import { flowCaps } from '../../src/cost/caps.js';
import { startRun } from '../../src/run-state/start.js';
import { runInput } from '../support/event-log.js';
import { cleanupRunStateTest, runStateFixture, type RunStateFixture } from '../support/run-state.js';

afterEach(cleanupRunStateTest);

const REPO_KEYS = ['base_branch: main', 'package_manager: npm', 'install: make install-deps', 'gates:', '  lint: npm run lint', '  typecheck: npm run typecheck', '  test: npm test'];

/** The merged config of `example-frontend`, loaded from the temp factory home. `override` is extra repo YAML. */
function frontendConfig(state: RunStateFixture, override = '') {
  if (override !== '') {
    writeFileSync(
      join(state.fx.sb.home, 'repos', 'example-frontend.yaml'),
      [`match:`, `  path: ${state.fx.repo.path}`, ...REPO_KEYS, override, ''].join('\n'),
    );
  }
  return loadConfig({ env: state.fx.sb.env, repoPath: state.fx.repo.path, originUrl: null }).config;
}

/** A second repo with no override, matched by origin so no checkout is needed. */
function otherConfig(state: RunStateFixture) {
  mkdirSync(join(state.fx.sb.home, 'repos'), { recursive: true });
  writeFileSync(
    join(state.fx.sb.home, 'repos', 'example-other.yaml'),
    ['match:', '  origin: https://example.com/example-org/example-other.git', ...REPO_KEYS, ''].join('\n'),
  );
  return loadConfig({
    env: state.fx.sb.env,
    repoPath: '/tmp/example-other',
    originUrl: 'https://example.com/example-org/example-other.git',
  }).config;
}

/** Starts a run of `flow` under the given config and returns its stored `cap_usd_effective`. */
function startedCap(state: RunStateFixture, config: ReturnType<typeof frontendConfig>, flow: string, ticket: string) {
  startRun(
    state.context,
    runInput({ run_id: `run-${flow}-${ticket}`, ticket, flow, base_commit: state.fx.repo.baseCommit }),
    { caps: config.caps },
  );
  return state.rows('SELECT cap_usd_effective FROM runs WHERE run_id = ?', `run-${flow}-${ticket}`)[0]?.cap_usd_effective;
}

describe('flow default caps, overridable per repo', () => {
  test('a flow A run with no override has cap_usd_effective of 5 and a 30 minute wall-clock cap', () => {
    const state = runStateFixture();
    const config = frontendConfig(state);

    expect(startedCap(state, config, 'A', 'FE-201')).toBe(5);
    expect(flowCaps(config.caps, 'A')).toEqual({ usd: 5, minutes: 30 });
  });

  test('a flow E run with no override has cap_usd_effective of 6 and a 45 minute wall-clock cap', () => {
    const state = runStateFixture();
    const config = frontendConfig(state);

    expect(startedCap(state, config, 'E', 'FE-202')).toBe(6);
    expect(flowCaps(config.caps, 'E')).toEqual({ usd: 6, minutes: 45 });
  });

  test('a flow F or H run with no override has cap_usd_effective of 2 and a 15 minute wall-clock cap', () => {
    const state = runStateFixture();
    const config = frontendConfig(state);

    expect(startedCap(state, config, 'F', 'FE-203')).toBe(2);
    expect(startedCap(state, config, 'H', 'FE-204')).toBe(2);
    expect(flowCaps(config.caps, 'F')).toEqual({ usd: 2, minutes: 15 });
    expect(flowCaps(config.caps, 'H')).toEqual({ usd: 2, minutes: 15 });
  });

  test('a per-repo caps override replaces the default for that repo only', () => {
    const state = runStateFixture();
    const overridden = frontendConfig(state, ['caps:', '  A:', '    usd: 8', '    minutes: 50', '    fix_loops: 2'].join('\n'));
    const other = otherConfig(state);

    expect(startedCap(state, overridden, 'A', 'FE-205')).toBe(8);
    expect(flowCaps(overridden.caps, 'A')).toEqual({ usd: 8, minutes: 50 });
    expect(startedCap(state, other, 'A', 'FE-206')).toBe(5);
    expect(flowCaps(other.caps, 'A')).toEqual({ usd: 5, minutes: 30 });
  });
});
