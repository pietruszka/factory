import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { loadConfig, loadGlobalConfig } from '../../src/config/load.js';
import { DEFAULT_MODELS, renderModelsSectionYaml } from '../../src/config/models.js';
import { FactoryError } from '../../src/platform/errors.js';
import { cleanupTempHomes, makeTempHome } from '../support/temp-home.js';

afterEach(cleanupTempHomes);

const ORIGIN = 'https://github.com/example-org/example-frontend.git';

const REQUIRED_REPO = [
  'base_branch: main',
  'package_manager: npm',
  'install: npm ci',
  'gates:',
  '  lint: npm run lint',
  '  typecheck: npm run typecheck',
  '  test: npm test',
];

/** A repo file with only the required keys. Extra lines are appended. */
function repoText(...extra: string[]): string {
  return [`match:`, `  origin: ${ORIGIN}`, ...REQUIRED_REPO, ...extra, ''].join('\n');
}

interface Sandbox {
  env: NodeJS.ProcessEnv;
  home: string;
  repoPath: string;
  globalFile: string;
  repoFile: (name?: string) => string;
  writeGlobal: (text: string) => void;
  writeRepo: (text: string, name?: string) => string;
}

/** A temp HOME, a factory home inside it, and an empty folder standing in for the work repo. */
function sandbox(): Sandbox {
  const tmp = makeTempHome();
  const home = join(tmp, 'factory-home');
  const repoPath = join(tmp, 'work', 'example-frontend');
  mkdirSync(join(home, 'repos'), { recursive: true });
  mkdirSync(repoPath, { recursive: true });
  const globalFile = join(home, 'config.yaml');
  const repoFile = (name = 'example-frontend.yaml'): string => join(home, 'repos', name);
  return {
    env: { HOME: tmp, FACTORY_HOME: home },
    home,
    repoPath,
    globalFile,
    repoFile,
    writeGlobal: (text) => writeFileSync(globalFile, text, 'utf8'),
    writeRepo: (text, name) => {
      writeFileSync(repoFile(name), text, 'utf8');
      return repoFile(name);
    },
  };
}

/** Loads with an injected origin so these tests need no git. */
function load(box: Sandbox, originUrl: string | null = ORIGIN): ReturnType<typeof loadConfig> {
  return loadConfig({ env: box.env, repoPath: box.repoPath, originUrl });
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

describe('loadConfig required fields', () => {
  test('a valid global file plus a valid repo file returns every setting', () => {
    const box = sandbox();
    box.writeGlobal(
      ['version: 1', 'inspector:', '  port: 7777', '', renderModelsSectionYaml(DEFAULT_MODELS), ''].join('\n'),
    );
    box.writeRepo(
      [
        'match:',
        `  origin: ${ORIGIN}`,
        'base_branch: main',
        'package_manager: pnpm',
        'install: pnpm install --frozen-lockfile',
        'gates:',
        '  lint: pnpm lint',
        '  typecheck: pnpm typecheck',
        '  test: pnpm test',
        '  build: pnpm build',
        '  e2e: pnpm e2e',
        'protected_globs: ["package.json", ".github/**"]',
        'forbidden_globs: ["**/.env*"]',
        'role_write_globs:',
        '  builder: ["src/**", "test/**"]',
        'risk_tiers:',
        '  high: ["src/auth/**"]',
        'snapshot_ignore: ["**/*.map"]',
        'pr_labels: ["factory"]',
        'ui:',
        '  dev_server: pnpm dev',
        '  url: http://127.0.0.1:5173',
        '  port: 5173',
        '  viewports:',
        '    - { name: desktop, width: 1280, height: 800 }',
        '    - { name: phone, width: 390, height: 844 }',
        'gates_cwd: packages/web',
        'timing_sensitive_repeats: 5',
        'timing_sensitive_globs: ["**/*.timing.test.ts"]',
        'caps:',
        '  A: { usd: 4, minutes: 20, fix_loops: 1 }',
        '  E: { usd: 7, minutes: 50, fix_loops: 3 }',
        '  F: { usd: 1, minutes: 10, fix_loops: 0 }',
        '  H: { usd: 3, minutes: 25, fix_loops: 2 }',
        '',
      ].join('\n'),
    );

    const { config } = load(box);

    expect(config).toEqual({
      version: 1,
      models: DEFAULT_MODELS,
      rate_table: {},
      secrets: {},
      inspector: { host: '127.0.0.1', port: 7777 },
      dev_harness: { repeats: 3 },
      base_branch: 'main',
      package_manager: 'pnpm',
      install: 'pnpm install --frozen-lockfile',
      gates: {
        lint: 'pnpm lint',
        typecheck: 'pnpm typecheck',
        test: 'pnpm test',
        build: 'pnpm build',
        e2e: 'pnpm e2e',
      },
      protected_globs: ['package.json', '.github/**'],
      forbidden_globs: ['**/.env*'],
      role_write_globs: { builder: ['src/**', 'test/**'] },
      risk_tiers: { high: ['src/auth/**'] },
      snapshot_ignore: ['**/*.map'],
      pr_labels: ['factory'],
      ui: {
        dev_server: 'pnpm dev',
        url: 'http://127.0.0.1:5173',
        port: 5173,
        viewports: [
          { name: 'desktop', width: 1280, height: 800 },
          { name: 'phone', width: 390, height: 844 },
        ],
      },
      gates_cwd: 'packages/web',
      timing_sensitive_repeats: 5,
      timing_sensitive_globs: ['**/*.timing.test.ts'],
      caps: {
        A: { usd: 4, minutes: 20, fix_loops: 1 },
        E: { usd: 7, minutes: 50, fix_loops: 3 },
        F: { usd: 1, minutes: 10, fix_loops: 0 },
        H: { usd: 3, minutes: 25, fix_loops: 2 },
      },
    });
  });

  test('unset caps become the default caps', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText());

    expect(load(box).config.caps).toEqual({
      A: { usd: 5, minutes: 30, fix_loops: 2 },
      E: { usd: 6, minutes: 45, fix_loops: 2 },
      F: { usd: 2, minutes: 15, fix_loops: 2 },
      H: { usd: 2, minutes: 15, fix_loops: 2 },
    });
  });

  test('unset timing_sensitive_repeats is 3 and unset gates_cwd is "."', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText());

    const { config } = load(box);

    expect(config.timing_sensitive_repeats).toBe(3);
    expect(config.gates_cwd).toBe('.');
  });

  test('a global file that is only a models section loads', () => {
    const box = sandbox();
    box.writeGlobal(renderModelsSectionYaml(DEFAULT_MODELS));
    box.writeRepo(repoText());

    expect(loadGlobalConfig({ env: box.env }).config).toEqual({ models: DEFAULT_MODELS });
    expect(load(box).config.models).toEqual(DEFAULT_MODELS);
  });

  test('an unknown key is refused', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText('surprise: 1'));

    const error = refusal(() => load(box));

    expect(error.code).toBe('config_invalid');
    expect(error.message).toContain('surprise');
  });

  test.each(['bun', 'Npm', ''])('package_manager "%s" is refused', (value) => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText().replace('package_manager: npm', `package_manager: "${value}"`));

    const error = refusal(() => load(box));

    expect(error.code).toBe('config_invalid');
    expect(error.message).toContain('package_manager');
  });

  test.each(['npm', 'pnpm', 'yarn'])('package_manager %s is accepted', (value) => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText().replace('package_manager: npm', `package_manager: ${value}`));

    expect(load(box).config.package_manager).toBe(value);
  });

  test('e2e may be omitted or null', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');

    box.writeRepo(repoText());
    expect(load(box).config.gates.e2e).toBeUndefined();

    box.writeRepo(repoText().replace('  test: npm test', '  test: npm test\n  e2e: null'));
    expect(load(box).config.gates.e2e).toBeNull();
  });

  test('a missing required gate command is refused', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText().replace('  test: npm test\n', ''));

    const error = refusal(() => load(box));

    expect(error.code).toBe('config_invalid');
    expect(error.message).toContain('gates.test');
  });

  test.each(['0', '-1', '1.5', '"3"'])('timing_sensitive_repeats %s is refused', (value) => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText(`timing_sensitive_repeats: ${value}`));

    const error = refusal(() => load(box));

    expect(error.code).toBe('config_invalid');
    expect(error.message).toContain('timing_sensitive_repeats');
  });

  test('timing_sensitive_repeats of 1 is accepted', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText('timing_sensitive_repeats: 1'));

    expect(load(box).config.timing_sensitive_repeats).toBe(1);
  });

  const UI_LINES = (port: string): string[] => [
    'ui:',
    '  dev_server: npm run dev',
    '  url: http://127.0.0.1:5173',
    `  port: ${port}`,
    '  viewports: []',
  ];

  test.each(['0', '65536', '80.5', '"80"'])('ui.port %s is refused', (value) => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText(...UI_LINES(value)));

    const error = refusal(() => load(box));

    expect(error.code).toBe('config_invalid');
    expect(error.message).toContain('ui.port');
  });

  test.each(['1', '65535'])('ui.port %s is accepted', (value) => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText(...UI_LINES(value)));

    expect(load(box).config.ui?.port).toBe(Number(value));
  });

  test('secrets entries are only env or keychain names', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');

    box.writeRepo(repoText('secrets:', '  deploy_key:', '    keychain: example-item', '  ci:', '    env: CI_VALUE'));
    expect(load(box).config.secrets).toEqual({
      deploy_key: { keychain: 'example-item' },
      ci: { env: 'CI_VALUE' },
    });

    for (const entry of ['    value: abc', '    env: A_NAME\n    keychain: item', '    env: not a name']) {
      box.writeRepo(repoText('secrets:', '  deploy_key:', entry));
      const error = refusal(() => load(box));
      expect(error.code).toBe('config_invalid');
      expect(error.message).toContain('secrets.deploy_key');
    }
  });
});

describe('loadConfig error locations', () => {
  test('an invalid cap names the repo file, the key, the line and a next action', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    const file = box.writeRepo(
      [
        'match:',
        `  origin: ${ORIGIN}`,
        ...REQUIRED_REPO,
        'caps:',
        '  A:',
        '    usd: -1',
        '    minutes: 30',
        '    fix_loops: 2',
        '',
      ].join('\n'),
    );

    const error = refusal(() => load(box));

    expect(error.code).toBe('config_invalid');
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain('caps.A.usd');
    expect(error.where).toBe(`${file}:12`);
    expect(error.next.length).toBeGreaterThan(0);
  });

  test('a typo in a global key names config.yaml, the key and the line', () => {
    const box = sandbox();
    box.writeGlobal(['version: 1', 'inspector:', '  hots: 127.0.0.1', ''].join('\n'));
    box.writeRepo(repoText());

    const error = refusal(() => load(box));

    expect(error.code).toBe('config_invalid');
    expect(error.message).toContain('inspector.hots');
    expect(error.where).toBe(`${box.globalFile}:3`);
  });

  test('a YAML syntax error names the file and the line', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    const file = box.writeRepo(['match:', `  origin: ${ORIGIN}`, 'base_branch: main', 'install:', '\tbad: 1', ''].join('\n'));

    const error = refusal(() => load(box));

    expect(error.code).toBe('yaml_invalid');
    expect(error.where).toBe(`${file}:5`);
    expect(error.next.length).toBeGreaterThan(0);
  });

  test('a missing required key names the file and the key, with line 1 when the key is absent', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    const file = box.writeRepo(repoText().replace('base_branch: main\n', ''));

    const error = refusal(() => load(box));

    expect(error.code).toBe('config_invalid');
    expect(error.message).toContain('base_branch');
    expect(error.where).toBe(`${file}:1`);
    expect(error.next.length).toBeGreaterThan(0);
  });
});

const FAKE_TOKEN = 'ghp_EXAMPLE_NOT_A_REAL_TOKEN';

describe('loadConfig secret refusal', () => {
  test('a key api_token in the repo file is refused with its file, key and line', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    const file = box.writeRepo(repoText('api_token: not-a-real-value'));

    const error = refusal(() => load(box));

    expect(error.code).toBe('config_secret');
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain('api_token');
    expect(error.message).not.toContain('not-a-real-value');
    expect(error.where).toBe(`${file}:${3 + REQUIRED_REPO.length}`);
    expect(error.next.length).toBeGreaterThan(0);
  });

  test.each(['API_KEY', 'api-key', 'apiKey', 'my_password', 'AuthHeader', 'credentials', 'client_secret'])(
    'a key named %s is refused',
    (key) => {
      const box = sandbox();
      box.writeGlobal('version: 1\n');
      box.writeRepo(repoText(`${key}: x`));

      expect(refusal(() => load(box)).code).toBe('config_secret');
    },
  );

  test('a secret-looking key in the global file names config.yaml', () => {
    const box = sandbox();
    box.writeGlobal(['version: 1', 'inspector:', '  auth_token: x', ''].join('\n'));
    box.writeRepo(repoText());

    const error = refusal(() => load(box));

    expect(error.code).toBe('config_secret');
    expect(error.where).toBe(`${box.globalFile}:3`);
  });

  test('a value starting with ghp_ in any string field is refused', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');

    for (const extra of [`pr_labels: [${FAKE_TOKEN}]`, `gates_cwd: ${FAKE_TOKEN}`, `base_branch: ${FAKE_TOKEN}`]) {
      box.writeRepo(repoText(extra).replace('base_branch: main\n', ''));
      const error = refusal(() => load(box));
      expect(error.code).toBe('config_secret');
      expect(error.message).not.toContain(FAKE_TOKEN);
    }
  });

  test.each([
    'gho_EXAMPLE_NOT_A_REAL_TOKEN',
    'ghu_EXAMPLE_NOT_A_REAL_TOKEN',
    'ghs_EXAMPLE_NOT_A_REAL_TOKEN',
    'github_pat_EXAMPLE_NOT_A_REAL_TOKEN',
    'sk-EXAMPLE-NOT-A-REAL-KEY',
    'AKIAEXAMPLENOTREAL00',
    'xoxb-EXAMPLE-NOT-REAL',
    'xoxp-EXAMPLE-NOT-REAL',
    'xoxa-EXAMPLE-NOT-REAL',
  ])('a value starting with %s is refused', (value) => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText(`pr_labels: ["${value}"]`));

    expect(refusal(() => load(box)).code).toBe('config_secret');
  });

  test('a PEM private-key header in a string field is refused', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');

    for (const header of ['-----BEGIN PRIVATE KEY-----', '-----BEGIN RSA PRIVATE KEY-----']) {
      box.writeRepo(repoText(`pr_labels: ["${header}"]`));
      expect(refusal(() => load(box)).code).toBe('config_secret');
    }
  });

  test('secrets.github_token.env: GITHUB_TOKEN is allowed', () => {
    const box = sandbox();
    box.writeGlobal(['version: 1', 'secrets:', '  github_token:', '    env: GITHUB_TOKEN', ''].join('\n'));
    box.writeRepo(repoText());

    expect(load(box).config.secrets).toEqual({ github_token: { env: 'GITHUB_TOKEN' } });
  });

  test('secrets.github_token.env holding a token value is refused', () => {
    const box = sandbox();
    box.writeGlobal(['version: 1', 'secrets:', '  github_token:', `    env: ${FAKE_TOKEN}`, ''].join('\n'));
    box.writeRepo(repoText());

    const error = refusal(() => load(box));

    expect(error.code).toBe('config_secret');
    expect(error.where).toBe(`${box.globalFile}:4`);
  });

  test('a literal token in a gate command string is refused', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText().replace('lint: npm run lint', `lint: npm run lint -- --token ${FAKE_TOKEN}`));

    const error = refusal(() => load(box));

    expect(error.code).toBe('config_secret');
    expect(error.message).toContain('gates.lint');
  });

  test('ordinary words that contain a token prefix are not refused', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText().replace('install: npm ci', 'install: npx task-runner install --risk-level low'));

    expect(load(box).config.install).toBe('npx task-runner install --risk-level low');
  });
});

describe('loadConfig repo matching', () => {
  const NAMED = 'github.com/example-org/example-frontend';

  function boxWithRepoFile(match: string[]): Sandbox {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(['match:', ...match, ...REQUIRED_REPO, ''].join('\n'));
    return box;
  }

  test.each([
    ['https with .git', 'https://github.com/example-org/example-frontend.git'],
    ['scp form', 'git@github.com:example-org/example-frontend.git'],
    ['trailing slash', 'https://github.com/example-org/example-frontend/'],
    ['ssh scheme', 'ssh://git@github.com/example-org/example-frontend.git'],
    ['http scheme', 'http://github.com/example-org/example-frontend'],
    ['upper-case host', 'https://GitHub.com/example-org/example-frontend.git'],
  ])('an origin written as %s matches a file with match.origin %s', (_label, originUrl) => {
    const box = boxWithRepoFile([`  origin: ${NAMED}`]);

    expect(load(box, originUrl).files.repo).toBe(box.repoFile());
  });

  test('a match.origin written as an scp URL matches an https origin', () => {
    const box = boxWithRepoFile(['  origin: git@github.com:example-org/example-frontend.git']);

    expect(load(box, 'https://github.com/example-org/example-frontend').files.repo).toBe(box.repoFile());
  });

  test('when origin does not match, the resolved absolute path in match.path does', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(['match:', `  path: ${join(box.repoPath, '.')}`, ...REQUIRED_REPO, ''].join('\n'));

    expect(load(box, 'https://github.com/example-org/some-other-repo.git').files.repo).toBe(box.repoFile());
    expect(load(box, null).files.repo).toBe(box.repoFile());
  });

  test('origin match wins when both could apply to different files', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    // Sorted first, so file order cannot explain the result.
    box.writeRepo(['match:', `  path: ${box.repoPath}`, ...REQUIRED_REPO, ''].join('\n'), 'a-by-path.yaml');
    box.writeRepo(['match:', `  origin: ${ORIGIN}`, ...REQUIRED_REPO, ''].join('\n'), 'z-by-origin.yaml');

    expect(load(box).files.repo).toBe(box.repoFile('z-by-origin.yaml'));
  });

  test('two repo files that match the same origin are refused as ambiguous, naming both', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText(), 'first.yaml');
    box.writeRepo(repoText(), 'second.yaml');

    const error = refusal(() => load(box));

    expect(error.code).toBe('repo_config_ambiguous');
    expect(error.exitCode).toBe(2);
    expect(error.message).toContain(box.repoFile('first.yaml'));
    expect(error.message).toContain(box.repoFile('second.yaml'));
    expect(error.next.length).toBeGreaterThan(0);
  });

  test('two repo files that match the same path are refused as ambiguous', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    for (const name of ['first.yaml', 'second.yaml']) {
      box.writeRepo(['match:', `  path: ${box.repoPath}`, ...REQUIRED_REPO, ''].join('\n'), name);
    }

    expect(refusal(() => load(box, null)).code).toBe('repo_config_ambiguous');
  });

  test('no matching file is refused and names the file to create', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText().replace('example-frontend', 'example-other'));

    const error = refusal(() => load(box));

    expect(error.code).toBe('repo_config_missing');
    expect(error.exitCode).toBe(2);
    expect(error.next).toContain(box.repoFile());
    expect(error.next).toContain('match.origin');
    expect(error.next).toContain('match.path');
  });

  test('a missing repos folder is a missing-file refusal', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    const env = { HOME: box.env.HOME, FACTORY_HOME: join(box.home, 'no-repos-here') };
    mkdirSync(env.FACTORY_HOME, { recursive: true });
    writeFileSync(join(env.FACTORY_HOME, 'config.yaml'), 'version: 1\n');

    const error = refusal(() => loadConfig({ env, repoPath: box.repoPath, originUrl: ORIGIN }));

    expect(error.code).toBe('repo_config_missing');
  });

  test('a repo with no origin and no matching match.path is a missing-file refusal', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(['match:', '  path: /tmp/example-elsewhere', ...REQUIRED_REPO, ''].join('\n'));

    expect(refusal(() => load(box, null)).code).toBe('repo_config_missing');
  });

  test('with no injected originUrl the origin is read from the repo git config', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText());
    const gitEnv = { PATH: process.env.PATH, HOME: box.env.HOME, GIT_CONFIG_NOSYSTEM: '1' };
    execFileSync('git', ['init', '-q'], { cwd: box.repoPath, env: gitEnv });
    execFileSync('git', ['remote', 'add', 'origin', 'git@github.com:example-org/example-frontend.git'], {
      cwd: box.repoPath,
      env: gitEnv,
    });

    const loaded = loadConfig({ env: box.env, repoPath: box.repoPath });

    expect(loaded.files.repo).toBe(box.repoFile());
  });

  test('a global url.insteadOf rewrite does not change the origin loadConfig reads', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText());
    writeFileSync(
      join(box.env.HOME!, '.gitconfig'),
      '[url "https://evil.example/"]\n\tinsteadOf = https://github.com/\n',
      'utf8',
    );
    const gitEnv = {
      PATH: process.env.PATH,
      HOME: box.env.HOME,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
    };
    execFileSync('git', ['init', '-q'], { cwd: box.repoPath, env: gitEnv });
    execFileSync('git', ['remote', 'add', 'origin', ORIGIN], { cwd: box.repoPath, env: gitEnv });

    const loaded = loadConfig({ env: box.env, repoPath: box.repoPath });

    expect(loaded.files.repo).toBe(box.repoFile());
  });

  test('a git repo with no origin and no injected originUrl is a missing-file refusal', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText());
    execFileSync('git', ['init', '-q'], {
      cwd: box.repoPath,
      env: { PATH: process.env.PATH, HOME: box.env.HOME, GIT_CONFIG_NOSYSTEM: '1' },
    });

    expect(refusal(() => loadConfig({ env: box.env, repoPath: box.repoPath })).code).toBe('repo_config_missing');
  });
});

describe('loadConfig merge and hash', () => {
  const GLOBAL_CAP = ['version: 1', 'caps:', '  A:', '    usd: 9', '    minutes: 31', '    fix_loops: 1', ''].join('\n');

  test('a cap set only in the global file is used', () => {
    const box = sandbox();
    box.writeGlobal(GLOBAL_CAP);
    box.writeRepo(repoText());

    expect(load(box).config.caps.A).toEqual({ usd: 9, minutes: 31, fix_loops: 1 });
  });

  test('the same cap in the repo file replaces the global value, other fields stay', () => {
    const box = sandbox();
    box.writeGlobal(GLOBAL_CAP);
    box.writeRepo(repoText('caps:', '  A:', '    usd: 3'));

    expect(load(box).config.caps.A).toEqual({ usd: 3, minutes: 31, fix_loops: 1 });
  });

  test('a repo array replaces the global array rather than appending', () => {
    const box = sandbox();
    box.writeGlobal(['version: 1', 'protected_globs: ["global-a/**", "global-b/**"]', ''].join('\n'));

    box.writeRepo(repoText());
    expect(load(box).config.protected_globs).toEqual(['global-a/**', 'global-b/**']);

    box.writeRepo(repoText('protected_globs: ["repo-only/**"]'));
    expect(load(box).config.protected_globs).toEqual(['repo-only/**']);
  });

  test('a repo value of null replaces a global string', () => {
    const box = sandbox();
    box.writeGlobal(['version: 1', 'gates:', '  e2e: npm run e2e', ''].join('\n'));
    box.writeRepo(repoText().replace('  test: npm test', '  test: npm test\n  e2e: null'));

    expect(load(box).config.gates.e2e).toBeNull();
  });

  test('the returned config includes a sha256 hash, and two loads of the same merged config have the same hash', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText());

    const first = load(box).hash;
    const second = load(box).hash;

    expect(first.algorithm).toBe('sha256');
    expect(first.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toEqual(first);
  });

  test('the hash is the sha256 of the merged config as sorted-key canonical JSON', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText());
    const { config, hash } = load(box);

    const sorted = (value: unknown): unknown =>
      Array.isArray(value)
        ? value.map(sorted)
        : value !== null && typeof value === 'object'
          ? Object.fromEntries(
              Object.entries(value)
                .sort(([a], [b]) => (a < b ? -1 : 1))
                .map(([key, inner]) => [key, sorted(inner)]),
            )
          : value;

    expect(hash.digest).toBe(createHash('sha256').update(JSON.stringify(sorted(config)), 'utf8').digest('hex'));
  });

  test('changing a comment or the key order in YAML does not change the hash', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText('pr_labels: [factory]'));
    const before = load(box).hash.digest;

    box.writeGlobal('# a comment\nversion: 1\n');
    box.writeRepo(
      [
        '# another comment',
        'pr_labels: [factory]',
        'gates:',
        '  test: npm test # inline',
        '  typecheck: npm run typecheck',
        '  lint: npm run lint',
        'install: npm ci',
        'package_manager: npm',
        'base_branch: main',
        'match:',
        `  origin: ${ORIGIN}`,
        '',
      ].join('\n'),
    );

    expect(load(box).hash.digest).toBe(before);
  });

  test('changing a merged value does change the hash', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText());
    const before = load(box).hash.digest;

    box.writeRepo(repoText().replace('install: npm ci', 'install: npm install'));

    expect(load(box).hash.digest).not.toBe(before);
  });

  test('the hash is over the merged object, not a single source file', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText('pr_labels: [factory]'));
    const before = load(box).hash.digest;

    // Same merged config, the setting now comes from the global file.
    box.writeGlobal('version: 1\npr_labels: [factory]\n');
    box.writeRepo(repoText());
    expect(load(box).hash.digest).toBe(before);

    // The repo file is unchanged by this edit, but the merged config is not.
    box.writeGlobal('version: 1\npr_labels: [other]\n');
    expect(load(box).hash.digest).not.toBe(before);
  });
});

describe('loadConfig file locations', () => {
  function snapshot(root: string): string[] {
    const entries: string[] = [];
    const walk = (dir: string): void => {
      for (const name of readdirSync(dir).sort()) {
        const full = join(dir, name);
        const stat = statSync(full);
        entries.push(`${full}:${stat.isDirectory() ? 'dir' : stat.size}:${stat.mtimeMs}`);
        if (stat.isDirectory()) {
          walk(full);
        }
      }
    };
    walk(root);
    return entries;
  }

  test('loadConfig reads <home>/config.yaml and <home>/repos/*.yaml only', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText());
    // Look-alikes that must not be read: other folders, other extensions, a nested agents folder.
    mkdirSync(join(box.home, 'elsewhere'), { recursive: true });
    writeFileSync(join(box.home, 'elsewhere', 'example-frontend.yaml'), repoText(), 'utf8');
    writeFileSync(join(box.home, 'repos', 'notes.txt'), 'match: [', 'utf8');
    writeFileSync(join(box.home, 'repos', 'copy.yml'), repoText(), 'utf8');
    mkdirSync(join(box.home, 'repos', 'example-frontend', 'agents'), { recursive: true });
    writeFileSync(join(box.home, 'repos', 'example-frontend', 'agents', 'planner.yaml'), 'match: [', 'utf8');

    const loaded = load(box);

    expect(loaded.files).toEqual({ global: box.globalFile, repo: box.repoFile() });
  });

  test('a config.yaml or .factory/config.yaml placed inside the repo path is ignored', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText());
    writeFileSync(join(box.repoPath, 'config.yaml'), 'base_branch: [', 'utf8');
    mkdirSync(join(box.repoPath, '.factory'), { recursive: true });
    writeFileSync(join(box.repoPath, '.factory', 'config.yaml'), 'base_branch: from-the-repo\n', 'utf8');

    expect(load(box).config.base_branch).toBe('main');
  });

  test('with FACTORY_HOME set, files under the default home of that HOME are not read', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText());
    const defaultHome = join(box.env.HOME as string, '.factory');
    mkdirSync(join(defaultHome, 'repos'), { recursive: true });
    writeFileSync(join(defaultHome, 'config.yaml'), 'version: 1\n', 'utf8');
    writeFileSync(
      join(defaultHome, 'repos', 'example-frontend.yaml'),
      repoText().replace('base_branch: main', 'base_branch: from-default-home'),
      'utf8',
    );

    expect(load(box).config.base_branch).toBe('main');
  });

  test('with no FACTORY_HOME the files come from <HOME>/.factory', () => {
    const box = sandbox();
    const defaultHome = join(box.env.HOME as string, '.factory');
    mkdirSync(join(defaultHome, 'repos'), { recursive: true });
    writeFileSync(join(defaultHome, 'config.yaml'), 'version: 1\n', 'utf8');
    writeFileSync(join(defaultHome, 'repos', 'example-frontend.yaml'), repoText(), 'utf8');

    const loaded = loadConfig({ env: { HOME: box.env.HOME }, repoPath: box.repoPath, originUrl: ORIGIN });

    expect(loaded.files.global).toBe(join(defaultHome, 'config.yaml'));
  });

  test('a missing config.yaml is refused, naming the path and the next action', () => {
    const box = sandbox();
    box.writeRepo(repoText());

    const error = refusal(() => load(box));

    expect(error.code).toBe('config_missing');
    expect(error.exitCode).toBe(2);
    expect(error.where).toBe(box.globalFile);
    expect(error.next).toContain('dev:init');
    expect(refusal(() => loadGlobalConfig({ env: box.env })).code).toBe('config_missing');
  });

  test('resolving and loading creates no folder and writes nothing', () => {
    const box = sandbox();
    box.writeGlobal('version: 1\n');
    box.writeRepo(repoText());
    const root = box.env.HOME as string;
    const before = snapshot(root);

    load(box);
    loadGlobalConfig({ env: box.env });

    expect(snapshot(root)).toEqual(before);
  });
});
