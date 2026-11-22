const TOOLS = 'gh|acli|security|pbcopy|pbpaste|agent|cursor-agent|opencode|copilot';

// A spawn-style call whose first argument is one of the outside tools.
const SPAWN_OF_TOOL = new RegExp(
  `\\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\\s*\\(\\s*['"\`](?:${TOOLS})['"\`\\s]`,
);

// A command string that starts with an outside tool, for example a shell line passed to `sh -c`.
const COMMAND_STRING = /['"`](?:gh |acli |security find-generic-password|pbcopy\b|pbpaste\b)/;

/**
 * Returns the paths (keys of `sources`) that call `gh`, `acli`, `security`, `pbcopy` or `pbpaste`,
 * or spawn a worker CLI, skipping every path in `allowedPaths`. Pure: callers read the files.
 */
export function findPortOffenders(
  sources: Record<string, string>,
  allowedPaths: readonly string[],
): string[] {
  return Object.entries(sources)
    .filter(([path]) => !allowedPaths.includes(path))
    .filter(([, source]) => SPAWN_OF_TOOL.test(source) || COMMAND_STRING.test(source))
    .map(([path]) => path);
}
