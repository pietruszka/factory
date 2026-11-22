import { spawn } from 'node:child_process';

/** Runs one command with an optional stdin text. Injected so tests never reach the real tools. */
export type RunCommand = (
  command: string,
  args: readonly string[],
  input?: string,
) => Promise<{ stdout: string; exitCode: number }>;

/** Exit code reported when the command could not be started (the shell's "not found"). */
const NOT_STARTED = 127;

/** The real runner: fixed argument list, no shell. Default tests inject a fake instead. */
export const runCommand: RunCommand = (command, args, input) =>
  new Promise((resolve) => {
    const child = spawn(command, [...args], { stdio: ['pipe', 'pipe', 'ignore'] });
    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.on('error', () => resolve({ stdout: '', exitCode: NOT_STARTED }));
    child.on('close', (code) => resolve({ stdout, exitCode: code ?? 1 }));
    // A command that exits before reading stdin makes the write fail; its exit code still tells.
    child.stdin.on('error', () => undefined);
    child.stdin.end(input ?? '');
  });
