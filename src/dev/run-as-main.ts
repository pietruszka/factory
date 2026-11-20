import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export function runAsMain(moduleUrl: string, run: () => void): void {
  const modulePath = fileURLToPath(moduleUrl);
  const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
  if (!invokedPath || pathToFileURL(invokedPath).href !== pathToFileURL(modulePath).href) {
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
