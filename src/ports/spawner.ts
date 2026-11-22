import { spawn } from 'node:child_process';

import type { Deps } from '../platform/deps.js';
import { FactoryError } from '../platform/errors.js';
import type { ProcessTable } from './process-table.js';
import { runCommand, type RunCommand } from './run-command.js';

export interface SpawnRequest {
  command: string;
  args: readonly string[];
  cwd?: string;
  /** Added to the parent's environment for the child; a key given here wins. */
  env?: Readonly<Record<string, string>>;
}

export interface SpawnedProcess {
  pid: number;
  exit: Promise<{ code: number | null; signal: string | null }>;
  /** Everything the child wrote to stdout and stderr, once both pipes closed. Absent when not captured. */
  output?: Promise<{ stdout: string; stderr: string }>;
}

export interface Spawner {
  /** Starts a child in its own process group and records it in the process table. */
  spawn(request: SpawnRequest): Promise<SpawnedProcess>;
  /** Kills children first, then the parent, only when the pid still matches the command. */
  killTree(pid: number, command: string): Promise<'killed' | 'pid_reused' | 'gone'>;
}

export interface FakeSpawner extends Spawner {
  readonly requests: readonly SpawnRequest[];
  readonly kills: ReadonlyArray<{ pid: number; command: string }>;
}

/** The command text recorded in the process table: the program and its arguments. */
const commandLine = (request: SpawnRequest): string => [request.command, ...request.args].join(' ');

export interface FakeSpawnReply {
  stdout?: string;
  stderr?: string;
  code?: number;
}

/**
 * A Spawner that starts nothing: it records requests and hands out ascending pids.
 * `reply` scripts what each child wrote and its exit code; the default is silent success.
 */
export function createFakeSpawner(options: { reply?: (request: SpawnRequest) => FakeSpawnReply } = {}): FakeSpawner {
  const requests: SpawnRequest[] = [];
  const kills: Array<{ pid: number; command: string }> = [];
  let nextPid = 1000;
  return {
    requests,
    kills,
    spawn: async (request) => {
      requests.push(request);
      const reply = options.reply?.(request) ?? {};
      return {
        pid: nextPid++,
        exit: Promise.resolve({ code: reply.code ?? 0, signal: null }),
        output: Promise.resolve({ stdout: reply.stdout ?? '', stderr: reply.stderr ?? '' }),
      };
    },
    killTree: async (pid, command) => {
      kills.push({ pid, command });
      return 'killed';
    },
  };
}

/** Pids of every descendant of `root`, deepest first, from `ps -A -o pid=,ppid=` text. */
function descendantsDeepestFirst(psOutput: string, root: number): number[] {
  const childrenOf = new Map<number, number[]>();
  for (const line of psOutput.split('\n')) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid === undefined || ppid === undefined || Number.isNaN(pid) || Number.isNaN(ppid)) continue;
    childrenOf.set(ppid, [...(childrenOf.get(ppid) ?? []), pid]);
  }
  const visit = (pid: number): number[] =>
    (childrenOf.get(pid) ?? []).flatMap((child) => [...visit(child), child]);
  return visit(root);
}

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
};

const signalIgnoringGone = (pid: number): void => {
  try {
    process.kill(pid, 'SIGKILL');
  } catch {
    // Already exited between listing and killing.
  }
};

/**
 * macOS Spawner. Each child leads its own process group. `killTree` sends SIGKILL to the
 * descendants first, then the parent, and only when the pid still runs the recorded command.
 */
export function createMacosSpawner(options: {
  processTable: ProcessTable;
  deps: Deps;
  run?: RunCommand;
}): Spawner {
  const { processTable, deps } = options;
  const run = options.run ?? runCommand;
  return {
    spawn: (request) =>
      new Promise((resolve, reject) => {
        const child = spawn(request.command, [...request.args], {
          cwd: request.cwd,
          env: { ...process.env, ...request.env },
          detached: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        });
        const chunks: { stdout: string[]; stderr: string[] } = { stdout: [], stderr: [] };
        child.stdout.setEncoding('utf8').on('data', (text: string) => chunks.stdout.push(text));
        child.stderr.setEncoding('utf8').on('data', (text: string) => chunks.stderr.push(text));
        const output = new Promise<{ stdout: string; stderr: string }>((done) =>
          child.once('close', () => done({ stdout: chunks.stdout.join(''), stderr: chunks.stderr.join('') })),
        );
        child.once('error', (error) =>
          reject(
            new FactoryError({
              code: 'spawn_failed',
              message: `Could not start ${request.command}: ${error.message}.`,
              where: request.command,
              next: 'check that the command is installed and the folder exists',
              exitCode: 2,
            }),
          ),
        );
        child.once('spawn', () => {
          const pid = child.pid as number;
          processTable.record({ pid, command: commandLine(request), startedAt: deps.now() });
          resolve({
            pid,
            exit: new Promise((done) =>
              child.once('exit', (code, signal) => done({ code, signal })),
            ),
            output,
          });
        });
      }),
    killTree: async (pid, command) => {
      if (!isAlive(pid)) return 'gone';
      if (!(await processTable.stillMatches(pid, command))) return 'pid_reused';
      const table = await run('ps', ['-A', '-o', 'pid=,ppid=']);
      for (const descendant of descendantsDeepestFirst(table.stdout, pid)) signalIgnoringGone(descendant);
      signalIgnoringGone(pid);
      return 'killed';
    },
  };
}
