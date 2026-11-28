import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** True when `moduleUrl` is the process entry point, also through a symlink `npm link` creates. */
export function isMainModule(moduleUrl: string, argv1: string | undefined = process.argv[1]): boolean {
  return argv1 !== undefined && realpathSync(argv1) === realpathSync(fileURLToPath(moduleUrl));
}

export function runAsMain(moduleUrl: string, run: () => void): void {
  if (!isMainModule(moduleUrl)) {
    return;
  }

  try {
    run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
