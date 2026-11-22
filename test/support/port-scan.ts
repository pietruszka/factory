const TOOLS = 'gh|acli|security|pbcopy|pbpaste|agent|cursor-agent|opencode|copilot';

// A spawn-style call whose first argument is one of the outside tools.
const SPAWN_OF_TOOL = new RegExp(
  `\\b(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\\s*\\(\\s*['"\`](?:${TOOLS})['"\`\\s]`,
);

// A command string that starts with an outside tool, for example a shell line passed to `sh -c`.
const COMMAND_STRING = /['"`](?:gh |acli |security find-generic-password|pbcopy\b|pbpaste\b)/;

// A module specifier that is one of the outside tools or a subpath of it (`gh`, `gh/lib`).
// `security` is not a package here: only its `find-generic-password` command string is refused.
const IMPORT_SPECIFIER = `['"\`](?:gh|acli|pbcopy|pbpaste|agent|cursor-agent|opencode|copilot)(?:/[^'"\`]*)?['"\`]`;

// `import x from 'tool'`, `import 'tool'`, `import('tool')` and `require('tool')`.
const IMPORT_OF_TOOL = new RegExp(
  `(?:\\bfrom\\s*|\\bimport\\s*\\(?\\s*|\\brequire\\s*\\(\\s*)${IMPORT_SPECIFIER}`,
);

/**
 * Returns the paths (keys of `sources`) that call or import `gh`, `acli`, `security`, `pbcopy` or
 * `pbpaste`, or spawn or import a worker CLI, skipping every path in `allowedPaths`. Pure: callers read the files.
 */
export function findPortOffenders(
  sources: Record<string, string>,
  allowedPaths: readonly string[],
): string[] {
  return Object.entries(sources)
    .filter(([path]) => !allowedPaths.includes(path))
    .filter(
      ([, source]) =>
        SPAWN_OF_TOOL.test(source) || COMMAND_STRING.test(source) || IMPORT_OF_TOOL.test(source),
    )
    .map(([path]) => path);
}
