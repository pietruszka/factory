import { afterEach, describe, expect, test } from 'vitest';

import { createFakeDeps } from '../support/fake-deps.js';
import { createFakeProcessTable, createMacosProcessTable } from '../../src/ports/process-table.js';
import { createMacosPlatform } from '../../src/ports/platform.js';
import { createMacosSpawner } from '../../src/ports/spawner.js';
import { cleanupTempHomes, makeTempHome } from '../support/temp-home.js';

afterEach(cleanupTempHomes);

describe('a fake ProcessTable', () => {
  test('can report that a recorded pid no longer matches its command', async () => {
    const table = createFakeProcessTable();
    table.record({ pid: 4242, command: 'example-worker --print', startedAt: 1000 });

    await expect(table.stillMatches(4242, 'example-worker --print')).resolves.toBe(true);
    table.plantRecycledPid(4242, 'some-other-program');

    await expect(table.stillMatches(4242, 'example-worker --print')).resolves.toBe(false);
    expect(table.list()).toEqual([{ pid: 4242, command: 'example-worker --print', startedAt: 1000 }]);
  });
});

describe('the macOS Spawner and ProcessTable', () => {
  test('exist and are testable without starting a real worker CLI', async () => {
    const processTable = createMacosProcessTable();
    const spawner = createMacosSpawner({ processTable, deps: createFakeDeps({ start: 5000 }) });

    const child = await spawner.spawn({ command: '/usr/bin/true', args: [], cwd: makeTempHome() });
    const result = await child.exit;

    expect(child.pid).toBeGreaterThan(0);
    expect(result).toEqual({ code: 0, signal: null });
    expect(processTable.list()).toEqual([
      { pid: child.pid, command: '/usr/bin/true', startedAt: 5000 },
    ]);
  });
});

describe('the macOS Spawner environment and output', () => {
  test('forwards the request env to the child and captures its stdout and stderr', async () => {
    const processTable = createMacosProcessTable();
    const spawner = createMacosSpawner({ processTable, deps: createFakeDeps() });
    const cwd = makeTempHome();

    const child = await spawner.spawn({
      command: '/usr/bin/env',
      args: [],
      cwd,
      env: { PWD: cwd, EXAMPLE_FLAG: '1' },
    });
    const output = await child.output;

    expect(output?.stdout.split('\n')).toEqual(expect.arrayContaining([`PWD=${cwd}`, 'EXAMPLE_FLAG=1']));
    expect(output?.stderr).toBe('');
  });
});

describe('the macOS Spawner killTree', () => {
  const setup = () => {
    const processTable = createMacosProcessTable();
    const spawner = createMacosSpawner({ processTable, deps: createFakeDeps() });
    return { processTable, spawner };
  };

  test('kills a running child whose pid still matches its command', async () => {
    const { spawner } = setup();
    const child = await spawner.spawn({ command: '/bin/sleep', args: ['30'] });

    await expect(spawner.killTree(child.pid, '/bin/sleep 30')).resolves.toBe('killed');

    await expect(child.exit).resolves.toEqual({ code: null, signal: 'SIGKILL' });
  });

  test('leaves a pid alone when it no longer matches the command, as after pid reuse', async () => {
    const { spawner } = setup();
    const child = await spawner.spawn({ command: '/bin/sleep', args: ['30'] });

    await expect(spawner.killTree(child.pid, 'some-other-program')).resolves.toBe('pid_reused');

    await expect(spawner.killTree(child.pid, '/bin/sleep 30')).resolves.toBe('killed');
    await child.exit;
  });

  test('reports a child that already exited as gone', async () => {
    const { spawner } = setup();
    const child = await spawner.spawn({ command: '/usr/bin/true', args: [] });
    await child.exit;

    await expect(spawner.killTree(child.pid, '/usr/bin/true')).resolves.toBe('gone');
  });
});

describe('the macOS Platform with an injected command runner', () => {
  test('reads a keychain item with security find-generic-password and never starts the real tool', async () => {
    const seen: Array<{ command: string; args: readonly string[] }> = [];
    const platform = createMacosPlatform({
      run: async (command, args) => {
        seen.push({ command, args });
        return { stdout: 'ghp_EXAMPLE_NOT_A_REAL_TOKEN\n', exitCode: 0 };
      },
    });

    await expect(platform.keychain.get('example-item')).resolves.toBe('ghp_EXAMPLE_NOT_A_REAL_TOKEN');
    expect(seen).toEqual([
      {
        command: 'security',
        args: ['find-generic-password', '-w', '-s', 'example-item'],
      },
    ]);
  });

  test('writes the clipboard through pbcopy with the text on stdin', async () => {
    const seen: Array<{ command: string; input: string | undefined }> = [];
    const platform = createMacosPlatform({
      run: async (command, _args, input) => {
        seen.push({ command, input });
        return { stdout: '', exitCode: 0 };
      },
    });

    await platform.clipboard.write('example text');

    expect(seen).toEqual([{ command: 'pbcopy', input: 'example text' }]);
  });
});
