import { EXIT_CODES } from './exit-codes.js';
import { CliOutputSchema, type CliOutput } from './schemas.js';

/** Injected writers, so the CLI core never touches the real process streams. */
export interface CliIo {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const internalErrorEnvelope = (command: string, message: string): CliOutput => ({
  schema_version: 1,
  command,
  ok: false,
  exit_code: EXIT_CODES.internal,
  message,
  errors: [{ code: 'internal_error', message }],
  next_command: null,
});

/** Human text for an envelope: the message, then where and what to do next for the first error. */
function humanText(envelope: CliOutput): string {
  const lines = [envelope.message];
  const first = envelope.errors[0];
  if (first?.where) lines.push(`Where: ${first.where}`);
  if (first?.next) lines.push(`Next: ${first.next}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Validates the envelope and prints it. In `--json` mode stdout holds only the JSON document and
 * the human message goes to stderr; otherwise the message goes to stdout (ok) or stderr (error).
 * An envelope that fails its own schema is replaced by an `internal_error` envelope (exit 4).
 * Returns the exit code to use.
 */
export function printOutput(envelope: CliOutput, io: CliIo, json: boolean): number {
  const parsed = CliOutputSchema.safeParse(envelope);
  const checked = parsed.success
    ? parsed.data
    : internalErrorEnvelope(
        typeof envelope.command === 'string' ? envelope.command : '',
        'Internal error: the command produced output that does not match the output schema.',
      );

  if (json) {
    io.stdout(`${JSON.stringify(checked)}\n`);
    io.stderr(humanText(checked));
  } else if (checked.ok) {
    io.stdout(humanText(checked));
  } else {
    io.stderr(humanText(checked));
  }
  return checked.exit_code;
}
