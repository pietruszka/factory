import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';

import { runGit } from '../../src/worktree/git.js';
import { cleanupTempHomes, makeTempHome } from '../support/temp-home.js';

afterEach(cleanupTempHomes);

const USER_NAME = 'factory-git-profile-user';

function writeGlobalConfig(home: string, body: string): void {
  writeFileSync(join(home, '.gitconfig'), body, 'utf8');
}

function initRepo(home: string): string {
  const repo = join(home, 'repo');
  mkdirSync(repo);
  execFileSync('git', ['init', '-q'], {
    cwd: repo,
    env: { PATH: process.env.PATH, HOME: home, GIT_CONFIG_NOSYSTEM: '1' },
  });
  return repo;
}

describe('runGit profiles', () => {
  test('user reads user.name from the global git config; isolated does not', () => {
    const home = makeTempHome();
    writeGlobalConfig(home, `[user]\n\tname = ${USER_NAME}\n`);
    const repo = initRepo(home);
    const env = { PATH: process.env.PATH, HOME: home };

    expect(runGit(env, repo, ['config', '--get', 'user.name'], { profile: 'user' })).toEqual({
      ok: true,
      stdout: USER_NAME,
      stderr: '',
    });
    expect(runGit(env, repo, ['config', '--get', 'user.name'], { profile: 'isolated' }).ok).toBe(false);
  });

  test('isolated does not run a post-checkout hook from the global hooks path', () => {
    const home = makeTempHome();
    const hooks = join(home, 'hooks');
    const marker = join(home, 'hook-ran');
    mkdirSync(hooks);
    writeFileSync(join(hooks, 'post-checkout'), `#!/bin/sh\necho ran > "${marker}"\n`, 'utf8');
    chmodSync(join(hooks, 'post-checkout'), 0o755);
    writeGlobalConfig(home, `[core]\n\thooksPath = ${hooks}\n`);
    const repo = initRepo(home);
    const env = { PATH: process.env.PATH, HOME: home };
    writeFileSync(join(repo, 'file.txt'), 'x\n', 'utf8');
    execFileSync('git', ['-c', 'user.email=dev@example.test', '-c', 'user.name=dev', 'add', 'file.txt'], {
      cwd: repo,
      env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
    });
    execFileSync(
      'git',
      ['-c', 'user.email=dev@example.test', '-c', 'user.name=dev', 'commit', '-q', '-m', 'init'],
      {
        cwd: repo,
        env: { ...env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' },
      },
    );

    const result = runGit(env, repo, ['checkout', '--quiet', 'HEAD'], { profile: 'isolated' });

    expect(result.ok).toBe(true);
    expect(existsSync(marker)).toBe(false);
  });
});
