// Static scan: tests never start a real model CLI. The only file allowed to
// name one is test/support/fake-cli.ts.
const SPAWN_OF_MODEL_CLI =
  /\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(\s*['"`](?:agent|cursor-agent|opencode)\b/;

/**
 * Returns the paths (keys of `sources`) whose text spawns `agent`, `cursor-agent` or `opencode`,
 * skipping every path in `allowedPaths`. Pure: callers read the files.
 */
export function findModelSpawnOffenders(
  sources: Record<string, string>,
  allowedPaths: readonly string[],
): string[] {
  return Object.entries(sources)
    .filter(([path]) => !allowedPaths.includes(path))
    .filter(([, source]) => SPAWN_OF_MODEL_CLI.test(source))
    .map(([path]) => path);
}
