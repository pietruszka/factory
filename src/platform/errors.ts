export interface FactoryErrorInit {
  /** Stable machine-readable code, for example `protected_folder`. */
  code: string;
  /** What went wrong. */
  message: string;
  /** Where it went wrong: a path, a setting or a command. */
  where: string;
  /** The next action the user can take. */
  next: string;
  /** The same next action as a runnable command, for the `--json` envelope, for example `factory help`. */
  nextCommand?: string;
  /** Process exit code: 2 refused or wrong use, 4 internal error. */
  exitCode: number;
}

/** Error with a stable code, where it happened, a next action and an exit code. */
export class FactoryError extends Error {
  readonly code: string;
  readonly where: string;
  readonly next: string;
  readonly nextCommand: string | undefined;
  readonly exitCode: number;

  constructor(init: FactoryErrorInit) {
    super(init.message);
    this.name = 'FactoryError';
    this.code = init.code;
    this.where = init.where;
    this.next = init.next;
    this.nextCommand = init.nextCommand;
    this.exitCode = init.exitCode;
  }
}
