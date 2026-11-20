export interface FakeCliReplay {
  exitCode?: number;
  stdoutLines?: string[];
  stderrLines?: string[];
}

export function renderReplayScript(replay: FakeCliReplay = {}): string {
  const stdoutLines = replay.stdoutLines ?? [];
  const stderrLines = replay.stderrLines ?? [];
  const exitCode = replay.exitCode ?? 0;
  return [
    ...stdoutLines.map((line) => `process.stdout.write(${JSON.stringify(`${line}\n`)});`),
    ...stderrLines.map((line) => `process.stderr.write(${JSON.stringify(`${line}\n`)});`),
    `process.exit(${exitCode});`,
  ].join('\n');
}
