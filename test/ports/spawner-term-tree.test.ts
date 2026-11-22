import { afterEach, describe, expect, test, vi } from 'vitest';

import {
  createFakeProcessTable,
  createMacosProcessTable,
  type FakeProcessTable,
  type ProcessTable,
} from '../../src/ports/process-table.js';
import type { RunCommand } from '../../src/ports/run-command.js';
import { createMacosSpawner } from '../../src/ports/spawner.js';
import { createFakeDeps } from '../support/fake-deps.js';
import { cleanupTempHomes, makeTempHome } from '../support/temp-home.js';
import { isAlive } from '../support/worker-runtime.js';

afterEach(() => {
  vi.restoreAllMocks();
  cleanupTempHomes();
});

const COMMAND = 'example-worker --print';

/** `ps -A -o pid=,ppid=` text for a root (5000) with children 5001 and 5003, and a grandchild 5002 under 5001. */
const PS_TREE = ['5000 1', '5001 5000', '5002 5001', '5003 5000'].join('\n');

const fakePs: RunCommand = async () => ({ stdout: PS_TREE, exitCode: 0 });

/** Records every signal sent through `process.kill` without sending it; signal 0 reports the pid as alive. */
function interceptSignals(): Array<{ pid: number; signal: string | number | undefined }> {
  const sent: Array<{ pid: number; signal: string | number | undefined }> = [];
  vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
    if (signal !== 0) sent.push({ pid, signal });
    return true;
  });
  return sent;
}

/** A macOS Spawner over a fake process table and a fake `ps`, so the tree is made of pids nobody owns. */
function treeSetup(wrap: (table: FakeProcessTable) => ProcessTable = (table) => table) {
  const processTable = createFakeProcessTable();
  processTable.record({ pid: 5000, command: COMMAND, startedAt: 0 });
  const spawner = createMacosSpawner({ processTable: wrap(processTable), deps: createFakeDeps(), run: fakePs });
  return { spawner, processTable };
}

describe('termTree and killTree walk the tree children first', () => {
  test('termTree sends SIGTERM to the deepest descendant first and the parent last, and killTree sends SIGKILL in the same order', async () => {
    const sent = interceptSignals();
    const { spawner } = treeSetup();

    await expect(spawner.termTree(5000, COMMAND)).resolves.toBe('killed');
    expect(sent).toEqual([
      { pid: 5002, signal: 'SIGTERM' },
      { pid: 5001, signal: 'SIGTERM' },
      { pid: 5003, signal: 'SIGTERM' },
      { pid: 5000, signal: 'SIGTERM' },
    ]);

    sent.length = 0;
    await expect(spawner.killTree(5000, COMMAND)).resolves.toBe('killed');
    expect(sent).toEqual([
      { pid: 5002, signal: 'SIGKILL' },
      { pid: 5001, signal: 'SIGKILL' },
      { pid: 5003, signal: 'SIGKILL' },
      { pid: 5000, signal: 'SIGKILL' },
    ]);
  });
});

describe('the macOS termTree', () => {
  const sleeper = async () => {
    const spawner = createMacosSpawner({ processTable: createMacosProcessTable(), deps: createFakeDeps() });
    const child = await spawner.spawn({ command: '/bin/sleep', args: ['30'], cwd: makeTempHome() });
    return { spawner, child };
  };

  test('stops a running child that still matches its command with SIGTERM, not SIGKILL', async () => {
    const { spawner, child } = await sleeper();

    await expect(spawner.termTree(child.pid, '/bin/sleep 30')).resolves.toBe('killed');

    await expect(child.exit).resolves.toEqual({ code: null, signal: 'SIGTERM' });
  });

  test('reports a child that already exited as gone', async () => {
    const spawner = createMacosSpawner({ processTable: createMacosProcessTable(), deps: createFakeDeps() });
    const child = await spawner.spawn({ command: '/usr/bin/true', args: [], cwd: makeTempHome() });
    await child.exit;

    await expect(spawner.termTree(child.pid, '/usr/bin/true')).resolves.toBe('gone');
  });

  test('when the recorded pid no longer matches the recorded command, termTree and killTree return pid_reused and the fake or macOS spawner sends no signal', async () => {
    const { spawner, child } = await sleeper();

    const term = await spawner.termTree(child.pid, 'some-other-program');
    const kill = await spawner.killTree(child.pid, 'some-other-program');

    expect({ term, kill }).toEqual({ term: 'pid_reused', kill: 'pid_reused' });
    expect(isAlive(child.pid)).toBe(true);
    // The child is still ours: stop it with its real command.
    await expect(spawner.killTree(child.pid, '/bin/sleep 30')).resolves.toBe('killed');
    await child.exit;
  });

  test('a recycled pid in the fake process table gets no signal from termTree or killTree', async () => {
    const sent = interceptSignals();
    const { spawner, processTable } = treeSetup();
    processTable.plantRecycledPid(5000, 'some-other-program');

    const term = await spawner.termTree(5000, COMMAND);
    const kill = await spawner.killTree(5000, COMMAND);

    expect({ term, kill }).toEqual({ term: 'pid_reused', kill: 'pid_reused' });
    expect(sent).toEqual([]);
  });

  test('the macOS termTree, like killTree, asks ProcessTable.stillMatches before signalling and refuses a pid whose command no longer matches', async () => {
    const order: string[] = [];
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal !== 0) order.push(`${String(signal)} ${pid}`);
      return true;
    });
    const { spawner, processTable } = treeSetup((inner) => ({
      ...inner,
      stillMatches: async (pid, command) => {
        order.push(`stillMatches ${pid} ${command}`);
        return inner.stillMatches(pid, command);
      },
    }));

    const matching = await spawner.termTree(5000, COMMAND);
    expect(matching).toBe('killed');
    expect(order.slice(0, 2)).toEqual([`stillMatches 5000 ${COMMAND}`, 'SIGTERM 5002']);

    order.length = 0;
    processTable.plantRecycledPid(5000, 'some-other-program');
    await expect(spawner.termTree(5000, COMMAND)).resolves.toBe('pid_reused');
    expect(order).toEqual([`stillMatches 5000 ${COMMAND}`]);
  });
});
