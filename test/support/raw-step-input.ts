export interface ProbeFixtureInput {
  stdout?: unknown;
  stderr?: unknown;
  exitCode?: unknown;
  timedOut?: unknown;
  cliVersion?: unknown;
}

export interface RawStepInputFixture {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  timedOut: boolean;
  cliVersion: string;
}

function toStringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function toExitCodeOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) ? value : null;
}

export function toRawStepInput(input: ProbeFixtureInput): RawStepInputFixture {
  return {
    stdout: toStringOrEmpty(input.stdout),
    stderr: toStringOrEmpty(input.stderr),
    exitCode: toExitCodeOrNull(input.exitCode),
    timedOut: input.timedOut === true,
    cliVersion: toStringOrEmpty(input.cliVersion),
  };
}
