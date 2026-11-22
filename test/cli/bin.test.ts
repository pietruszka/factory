import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, test } from 'vitest';

import { makeTempHome } from '../support/temp-home.js';

const repoRoot = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8')) as {
  version?: string;
  bin?: Record<string, string>;
};

let outDir = '';
let home = '';
let buildResult: ReturnType<typeof spawnSync>;

// The build goes to a temp folder, never to the repo's dist/. `npm link` is never run.
beforeAll(() => {
  outDir = realpathSync.native(mkdtempSync(join(tmpdir(), 'factory-test-build-')));
  home = makeTempHome();
  buildResult = spawnSync('npm', ['run', 'build', '--silent', '--', '--outDir', outDir], {
    cwd: repoRoot,
    encoding: 'utf8',
    env: { ...process.env, HOME: home },
  });
  if (buildResult.status === 0) {
    // The built files need what the repo root gives them: ESM mode, the version, and zod.
    copyFileSync(join(repoRoot, 'package.json'), join(outDir, 'package.json'));
    symlinkSync(join(repoRoot, 'node_modules'), join(outDir, 'node_modules'), 'dir');
  }
}, 120_000);

afterAll(() => {
  rmSync(outDir, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
});

const builtEntry = () => join(outDir, 'src', 'cli', 'main.js');

describe('installable factory command', () => {
  test('package.json has bin.factory pointing at a file that npm run build produces', () => {
    const bin = pkg.bin?.factory;

    expect(bin).toBe('dist/src/cli/main.js');
    expect(buildResult.status, String(buildResult.stderr)).toBe(0);
    // The temp build mirrors dist/: the same path below the out dir.
    expect(existsSync(join(outDir, String(bin).replace(/^dist\//, '')))).toBe(true);
  });

  test('after npm run build into a temp out dir, node <out>/src/cli/main.js --version prints the package.json version and exits 0', () => {
    const result = spawnSync(process.execPath, [builtEntry(), '--version'], {
      encoding: 'utf8',
      env: { ...process.env, HOME: home },
    });

    expect(result.status).toBe(0);
    expect(pkg.version).toBeTruthy();
    expect(result.stdout.trim()).toContain(String(pkg.version));
  });

  test('the built entry starts with a #!/usr/bin/env node line', () => {
    const firstLine = readFileSync(builtEntry(), 'utf8').split('\n')[0];

    expect(firstLine).toBe('#!/usr/bin/env node');
  });
});
