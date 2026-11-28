---
title: Sandbox and factory dev-init (FAC-28)
description: The to-do sample app (a checked-in zip of a Vite + React + TypeScript repo with tags todo-v0, todo-v1 and todo-v2) that factory dev-init --sample unpacks under the cache sandbox folder, how unpacking stays safe, how the zip is packed, and the opt-in sample gates.
---

# Sandbox and factory dev-init (FAC-28)

The dev harness needs a small app to run the factory against. It is a Vite + React + TypeScript to-do list, kept in the factory repo as a **zip of its own git repository**. `factory dev-init --sample <tag>` unpacks that zip under the cache folder. The unpacked repo is local, has no remote and is never pushed.

## What the factory checkout may hold (D-17 / D-19 narrowing)

The architecture said the factory repo holds no sample app, only a generator. Revision 2 of FAC-28 narrows that, with no new decision number:

- **Allowed:** the fixture zip, its pack inputs (source files and the input `package-lock.json`), the dev-only pack script, and a SHA manifest. They are recorded fixtures, like the others under `test/fixtures/`.
- **Not allowed:** an unpacked sample tree. No sample `.git`, no sample `node_modules` and no `baseline-reports` folder anywhere in the checkout. A test walks the checkout to check this.

| What | Where |
| --- | --- |
| Fixture zip | `test/fixtures/sandbox/todo-app.zip` (marked `binary` in `.gitattributes`) |
| Manifest | `test/fixtures/sandbox/todo-app.manifest.json` |
| Pack inputs | `scripts/sandbox/todo-app/` (`base/` is `todo-v0`; `v1/` and `v2/` hold the files that replace earlier ones; `lock-toolchain.json` names the Node and npm that made the lockfile) |
| Pack script | `scripts/pack-todo-sandbox.ts`, run as `npm run sandbox:pack` |
| Opt-in gates | `scripts/sample-gates.ts`, run as `npm run test:sample-gates` |
| Unpack code | `unpackTodoSandbox` in `src/sandbox/todo-sandbox.ts`, `unzipSafely` in `src/sandbox/unzip.ts` |

The zip must not hold `node_modules`, `dist`, coverage output, reports or `.DS_Store`. The budget is 512 KiB; the plan allows raising it to 1 MiB in this ticket if the lockfile needs it. The zip is well under 512 KiB.

## Where the sample lives

At `<sandboxRoot>/todo-app`, from `resolveFactoryPaths` ([Configuration](/reference/configuration)):

| `FACTORY_HOME` | Path |
| --- | --- |
| unset | `~/.cache/factory/sandbox/todo-app` |
| set to `<fh>` | `<fh>/cache/sandbox/todo-app` |

Baseline reports stay where they were: `<home>/sandbox/baseline-reports`. Unpacking does not move that folder into the cache root and writes no report.

## The repo

A local git repo on branch `main` with no remote. It has `package.json` (`engines.node` is `>=22.13`), a committed npm `package-lock.json` (no yarn or pnpm lockfile), and three annotated tags, each on its own commit:

| Tag | Content |
| --- | --- |
| `todo-v0` | A working app: add a todo, tick it, list the todos. `npm run lint` (ESLint), `npm run typecheck` (`tsc --noEmit`) and `npm test` (Vitest with Testing Library) all pass. Starter for a feature ticket. |
| `todo-v1` | `todo-v0` plus one planted bug: `toggleTodo` compares the id with the row index, so ticking a todo ticks the row below it. Lint and typecheck pass; two unit tests fail (the `todo-v0` tests for toggling, unchanged). Starter for a bug-fix ticket. |
| `todo-v2` | `todo-v1` plus a visible UI delta: the heading colour is nearly white on the white page. The bug stays and the same unit tests fail. Nothing in the unit tests sees the delta. The factory has no visual check yet. |

Every commit and tag has the author and committer `Factory Sandbox <factory-sandbox@example.invalid>` and a fixed date (one per tag, recorded in the manifest, with a non-UTC offset). The repo holds no real name, email, home path or token.

### Manifest and stability

The manifest holds the zip's sha256, the identity, one date per tag, each annotated-tag object id and the commit it points at, and the Node and npm versions that made the lockfile. Default tests open the committed zip and check all of it. The zip carries no `.git/index` (it holds machine-specific file data); unpacking rebuilds the index from `HEAD`.

Two unpacks, in separate temp homes or in the same place, give the same files, tags, commit ids and tag ids. When `todo-app` already exists, the unpack deletes it and unpacks again, so a checked-out tag, stray files or a changed file never survive. The new tree is unpacked beside the target (`todo-app.unpacking`) and moved into place, so a failed unpack leaves no half-written sandbox. After a run, `HEAD` is detached at the requested tag; `main` points at `todo-v2`.

## Unpack safety

`unzipSafely({ zipPath, destRoot })` is a small in-repo extractor (no zip dependency). It checks and inflates every entry, and verifies size and CRC, before it writes the first file. It refuses:

- absolute paths, a drive letter, `..` segments, empty or `.` segments, backslashes and NUL bytes in a name;
- any entry that is not a regular file or folder (symlinks and every other type), encrypted entries, and compression other than stored or deflate;
- a name that appears twice, or a file used as a folder;
- more than 64 MiB declared in total;
- a `destRoot` that is a symlink, or a folder inside it that is one.

A refusal is a `FactoryError` (exit 2) with the bad entry name in `where`, and nothing is written outside `destRoot`. Files get fixed modes (0644, or 0755 when the zip marks them executable).

## Default tests stay offline

`npm test` and `npm run test:l3` never run `npm ci` or `npm install` in the sample and need no network. They unpack the zip, check the manifest, the config, the refusals and the extractor, and read `package.json` and the lockfile from git without installing. Unpacking runs only local `git` in a temp folder. `npm run test:sample-gates` and `npm run sandbox:pack` are not called by `test`, `test:l3` or `scripts/run-layer.ts`, and `L3_BUDGET_SECONDS` stays 120.

### `npm run test:sample-gates` (opt-in, needs network)

Unpacks the sample into a fresh temp folder (never a real factory home or cache), runs one `npm ci` there, and runs the sample's gates:

- `todo-v0`: lint, typecheck and unit tests must pass.
- `todo-v1` and `todo-v2`: lint and typecheck must pass and the unit tests must fail (the planted bug).

It prints one line per gate with the time and exits 1 if any result differs from the expectation. A cold install can take one to three minutes, which is why this is not under the 120 s L3 budget.

### `npm run sandbox:pack` (dev only)

Rebuilds the zip and manifest from `scripts/sandbox/todo-app/` with no network and no install: it copies the inputs, commits and tags with the fixed identity and dates, drops the index and logs, writes a fixed `.git/config`, and writes a zip with sorted entries, fixed times and fixed modes. The same inputs give the same bytes. `--out <dir>` writes elsewhere.

To change the sample's dependencies: edit `base/package.json`, regenerate `base/package-lock.json` once with `npm install --package-lock-only` in a temp folder (needs network), update `lock-toolchain.json`, then run the pack. Lockfile, zip and manifest change together.

### Refusals

All are `FactoryError` with exit 2.

| Code | When |
| --- | --- |
| `sample_unknown` | The name is not `todo-v0`, `todo-v1` or `todo-v2`. `where` names it and `next` lists the known tags. Nothing is written. |
| `protected_folder` | The resolved home, cache, sandbox or `todo-app` path is at or inside `~/Documents`, `~/Desktop` or `~/Downloads`, symlinks followed. Nothing is written there. |
| `sandbox_symlink` | The cache folder, the sandbox folder or `todo-app` is a symbolic link, or the unzip destination is. The link and its target are left alone. |
| `zip_unsafe` | An entry breaks a rule under [Unpack safety](#unpack-safety). |
| `sample_fixture_missing` | The zip is not found next to the checkout. |

## `factory dev-init --sample <tag>`

```sh
factory dev-init /tmp/example-factory-home
FACTORY_HOME=/tmp/example-factory-home factory dev-init --sample todo-v0
```

`factory dev-init <path>` creates a throwaway home with the dev-home marker and a starter `config.yaml`, and nothing else; it does not unpack the sample. A path and `--sample` together are refused. `dev-init --sample` then:

1. Refuses unless `FACTORY_HOME` is set to an existing home that has the dev-home marker.
2. Unpacks the zip and checks out the tag (detached HEAD). It does not install anything.
3. Writes `<home>/repos/todo-app.yaml` with `match.path` set to the absolute sample path (no `match.origin`), `base_branch: main`, `package_manager: npm`, `install: npm ci`, and `gates.lint`, `gates.typecheck` and `gates.test` as the sample's npm scripts. The file is rewritten on every run.

`loadConfig({ env, repoPath: <sample path> })` then matches that file by path ([Factory config](/reference/factory-config)).

The command starts no agent. It does not call preflight, `markStaleRuns`, `killRun`, `resumeRun` or `factory clean`, and it writes nothing under `sandbox/baseline-reports`.

| Code | When |
| --- | --- |
| `sample_required` | No path and no `--sample`. |
| `invalid_usage` | A path and `--sample` together. |
| `sample_unknown` | As above. |
| `dev_home_required` | `FACTORY_HOME` is unset. Nothing is written under the default home or cache. |
| `dev_home_invalid` | Creating a home fails the home rules, or `--sample` is aimed at a home that does not exist, has no marker, or is the default or a private folder. |
| `protected_folder`, `sandbox_symlink`, `zip_unsafe` | As above. |

`--json` prints the envelope with `data.sample`, `data.sandbox_path` and `data.repo_config`.
