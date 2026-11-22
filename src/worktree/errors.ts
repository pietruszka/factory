import { FactoryError } from '../platform/errors.js';

/** Every refusal of this module: wrong use or an environment that cannot host the worktree, exit code 2. */
export function refuse(code: string, message: string, where: string, next: string): FactoryError {
  return new FactoryError({ code, message, where, next, exitCode: 2 });
}
