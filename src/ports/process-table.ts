import { runCommand, type RunCommand } from './run-command.js';

export interface ProcessRecord {
  pid: number;
  command: string;
  startedAt: number;
}

export interface ProcessTable {
  record(entry: ProcessRecord): void;
  list(): readonly ProcessRecord[];
  /** True when the pid still runs the command it was recorded with (false for a recycled pid). */
  stillMatches(pid: number, command: string): Promise<boolean>;
}

export interface FakeProcessTable extends ProcessTable {
  /** Makes the pid report a different command, as if the OS had recycled it. */
  plantRecycledPid(pid: number, otherCommand: string): void;
}

export function createFakeProcessTable(): FakeProcessTable {
  const records = new Map<number, ProcessRecord>();
  const recycled = new Map<number, string>();
  return {
    record: (entry) => {
      records.set(entry.pid, entry);
    },
    list: () => [...records.values()],
    stillMatches: (pid, command) =>
      Promise.resolve((recycled.get(pid) ?? records.get(pid)?.command) === command),
    plantRecycledPid: (pid, otherCommand) => {
      recycled.set(pid, otherCommand);
    },
  };
}

/** Process table that asks `ps` which command a pid runs now. */
export function createPosixProcessTable(options: { run?: RunCommand } = {}): ProcessTable {
  const run = options.run ?? runCommand;
  const records = new Map<number, ProcessRecord>();
  return {
    record: (entry) => {
      records.set(entry.pid, entry);
    },
    list: () => [...records.values()],
    stillMatches: async (pid, command) => {
      const { stdout, exitCode } = await run('ps', ['-o', 'command=', '-p', String(pid)]);
      return exitCode === 0 && stdout.trim() === command;
    },
  };
}
