---
title: npm scripts
description: The only npm scripts in the factory repository.
---

# npm scripts

`package.json` defines these scripts. There is no `start` script.

| Script | Command | Purpose |
| --- | --- | --- |
| `typecheck` | `tsc --noEmit` | Strict TypeScript check of `src/`, `test/` and `scripts/` |
| `build` | `tsc -p tsconfig.build.json` | Compiles `src/` to `dist/` (git-ignored); `dist/src/cli/main.js` is the `factory` bin |
| `build:watch` | `npm run build -- --watch` | Same as `build`, leaves `tsc` running and recompiles when `src/` changes |
| `lint` | `eslint src test scripts && knip` | ESLint over `src/`, `test/` and `scripts/` (type-aware rules on `src/` only; clock and randomness ban (P-14) and no hard-coded home paths (NFR-33) on `src/`), then knip for unused exports and dependencies |
| `test` | `vitest run` | All tests |
| `test:l3` | `tsx scripts/run-layer.ts` | Only the `test/l3/` folder, with the time printed and a 120 s budget |
| `test:sample-gates` | `tsx scripts/sample-gates.ts` | Opt-in, needs network: installs the to-do sample in a temp folder and runs its gates. Not part of `test` or `test:l3`. See [Sandbox](/reference/sandbox) |
| `check` | `typecheck && lint && test && test:l3 && build && docs:build` | All quality gates in order; stops at the first failure |
| `sandbox:pack` | `tsx scripts/pack-todo-sandbox.ts` | Dev only: rebuilds the to-do sample zip and manifest from `scripts/sandbox/todo-app/`. See [Sandbox](/reference/sandbox) |
| `probe` | `tsx src/probe/probe.ts` | Live CLI probe (needs `FACTORY_LIVE`) |
| `preflight` | `tsx src/preflight/models.ts` | Model preflight |
| `docs:dev` | `vitepress dev docs` | Local dev server with reload |
| `docs:build` | `vitepress build docs` | Production static build |
| `docs:preview` | `vitepress preview docs` | Serve the production build locally |

Run them with npm from the repository root:

```sh
npm run check
npm run typecheck
npm run lint
npm test
npm run test:l3
npm run build
npm run build:watch
npm run docs:build
```

## `check`

Runs the gates in order: `typecheck`, `lint`, `test`, `test:l3`, `build`, `docs:build`. It stops at the first failure and exits with that gate's exit code. When every gate passes it exits 0. CI runs the same gates (without `docs:build`, which stays on the docs workflow) on `ubuntu-latest` and `macos-latest` for every pull request and every push to `main`.

## `build`

Compiles `src/` with `tsconfig.build.json` into `dist/`. `package.json` points `bin.factory` at `dist/src/cli/main.js`, so after a build `npm link` (run once, by hand) installs the `factory` command. Pass `-- --outDir <dir>` to build somewhere else. `dist/` is ignored by git, lint and tests. See [The factory command](/reference/cli).

## `build:watch`

Runs `npm run build -- --watch`: the same `tsc` command as `build`, with TypeScript’s `--watch` so edits under `src/` recompile into `dist/` without another manual build. Leave it running while you exercise the linked `factory` command.

## `lint`

Runs ESLint with `eslint.config.js` over `src/`, `test/` and `scripts/`, then knip. On `src/` ESLint uses typescript-eslint `recommendedTypeChecked` (type-aware) plus two project rules: outside `src/platform/deps.ts`, clock and randomness calls are errors ("use Deps (P-14)"), and string literals that hold a user-home path are errors outside `src/platform/paths.ts`. On `test/` and `scripts/` it uses non-type-aware `recommended` only; the Deps and home-path bans do not apply there. Formatting is not checked. Knip uses `knip.json` to fail on unused exports and unused dependencies (entries cover the CLI, scripts and tests; `test/support/resume-child.ts` is ignored because it is started as a child process). Details are in [VitePress config](/reference/configuration#factory-paths).

## `test`

Runs every test once with Vitest 5.1.2 on the `forks` pool, capped at two workers. Temp homes, the network guard and the L3 folder are described in [Testing](/reference/testing).

## `test:l3`

Runs `scripts/run-layer.ts`, which starts `vitest run test/l3/`, prints `L3 took N s` and exits non-zero when vitest fails or the run is over its budget. The budget is 120 s, printed as `L3 took 121 s, budget 120 s` on breach. When `test/l3/` has no `*.test.ts` file, it prints `test/l3/ has no test files` and exits 1 without starting vitest. See [Testing](/reference/testing#l3-tests-and-their-budget).

## `docs:dev`

Starts the VitePress dev server with `docs/` as the project root. The default port is `5173`. If that port is taken, VitePress picks another and prints it.

The site `base` is `/factory/`, so the home page is at `/factory/` on that origin, not at `/`.

Use this while editing. It is not the artifact that GitHub Pages serves.

## `docs:build`

Compiles Markdown and `docs/.vitepress/config.ts` into `docs/.vitepress/dist`.

The command fails when an internal link does not match a page. External links, including links to GitHub, are not fetched. A broken GitHub URL will not fail the build.

The output directory is gitignored. CI builds it fresh with `npm ci` followed by `npm run docs:build`.

## `docs:preview`

Serves `docs/.vitepress/dist`. Run `docs:build` first. If the output directory is missing, preview has nothing to serve.

The default port is `4173`. The home page is at `/factory/` on that origin, for the same reason as the dev server.

Pass VitePress arguments after `--`:

```sh
npm run docs:preview -- --port 8080
```

The `package.json` script itself does not pin a port. CI does not run preview.

## Dependency install

| Command | When |
| --- | --- |
| `npm ci` | CI, and a clean local install from the lockfile |
| `npm install` | After you change `package.json` dependencies |

Direct dev dependencies include `vitepress` at `1.6.4`, `mermaid` at `11.17.2`, `vitepress-plugin-mermaid` at `2.0.17`, `vitest` at `5.1.2`, `vite` at `6.4.6` (Vitest’s peer; VitePress keeps its own Vite 5), `tsx` at `4.23.15`, `typescript` at `5.9.3`, `@types/node` at `22.20.7`, `knip` at `6.49.0`, `eslint` at `9.39.5` and `typescript-eslint`. `engines.node` asks for Node.js `>=22.13`. npm only enforces `engines` when `engine-strict` is enabled; it is not enabled here. The workflow still installs Node.js 22 so CI matches the version used to verify the build.
