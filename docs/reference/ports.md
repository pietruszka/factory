---
title: Ports (FAC-18)
description: The five ports through which the core reaches outside systems, their recording fakes and macOS implementations, the write allow-list, resolveSecret, the unsupported_os refusal and what is deferred.
---

# Ports (FAC-18)

The core reaches outside systems only through ports: small interfaces in `src/ports/`. Tests use the fakes; macOS uses the real implementations. It is a library: there is no `factory` command for it. Later tickets call it (the worker runtime and `factory kill`).

| Port | What it is for | Fake | macOS implementation |
| --- | --- | --- | --- |
| `TicketSource` | Read a ticket: `fetchTicket(key)`. No write method. | `createRecordingTicketSource` | Not yet (see Deferred) |
| `CodeHost` | `fetchPullRequest`, `push`, `openDraftPr`. | `createRecordingCodeHost` | Not yet (see Deferred) |
| `Spawner` | Start a child in its own process group; kill that tree. | `createFakeSpawner` | `createMacosSpawner` |
| `ProcessTable` | Record `{ pid, command, startedAt }`; say whether a pid still runs its command. | `createFakeProcessTable` | `createMacosProcessTable` |
| `Platform` | OS name, clipboard, keychain. | `createFakePlatform` | `createMacosPlatform` |

`Deps` (clock, timers, ids) stays the separate seam from [Testing](/reference/testing) and is not part of `Platform`.

## Recording fakes

Each fake records every call in `calls`. Reads return what the test scripted.

- `createRecordingTicketSource({ tickets })` returns the ticket for a key and records `{ method: 'fetchTicket', key }`. An unscripted key throws.
- `createRecordingCodeHost({ pullRequests })` returns the pull request for `owner/repo#number`.

### Write allow-list

`push` and `openDraftPr` are writes. The default allow-list is empty, so a write is recorded and then throws `write_not_allowed` (exit 2). The test fails at the call. A test that expects a write calls `host.allow('push')` first. The call is recorded either way.

```ts
const host = createRecordingCodeHost({});
host.allow('push');
await host.push({ repo: 'example-org/example-frontend', branch: 'feat/FE-123-example' });
// host.openDraftPr(...) still throws write_not_allowed
```

## Spawner and ProcessTable

`Spawner.spawn({ command, args, cwd? })` starts the child detached, so it leads its own process group, and records `{ pid, command, startedAt }` in the process table. `command` in the record is the program and its arguments joined by spaces. `startedAt` comes from `Deps.now()`.

`Spawner.killTree(pid, command)` returns one of:

| Result | When |
| --- | --- |
| `gone` | The pid no longer exists. |
| `pid_reused` | The pid exists but `ProcessTable.stillMatches(pid, command)` is false. Nothing is killed. |
| `killed` | Descendants got `SIGKILL` first, deepest first, then the parent. |

The macOS process table asks `ps -o command= -p <pid>`. The fake table lets a test call `plantRecycledPid(pid, otherCommand)` so `stillMatches` turns false.

The fake spawner starts nothing. It records `requests` and `kills`, and hands out ascending pids.

## Platform

`Platform` has `os`, `clipboard.read/write` and `keychain.get(item)`. `keychain.get` returns `undefined` for an item that does not exist.

| | `createFakePlatform({ os?, keychain?, clipboard? })` | `createMacosPlatform({ run? })` |
| --- | --- | --- |
| Keychain | A map; records `keychainReads` | `security find-generic-password -w -s <item>` |
| Clipboard | A string; records `clipboardWrites` | `pbpaste`, and `pbcopy` with the text on stdin |

`run` is a `RunCommand`. Tests inject one and never reach the real tools. Default tests use `createFakePlatform`; nothing in `npm test` reads the real keychain or the clipboard.

## Supported systems

`assertSupportedPlatform(os)` throws `unsupported_os` (exit 2) for anything but `darwin`. `next` says to run Factory on macOS. `runCli` calls it first, with `opts.os ?? process.platform`, so on Linux and Windows no command runs, not even `version`.

## Secrets

Config stores where a secret lives (`secrets.<name>.env` or `.keychain`), never the value. See [Factory config](/reference/factory-config#secrets).

`resolveSecret({ env, platform, config, name })` in `src/config/resolve-secret.ts` is the only reader of those values:

- An `env` entry is read from the `env` object it is given, never from `process.env` directly.
- A `keychain` entry is read through `platform.keychain.get`.
- A name that is not configured, or a value that is missing or empty, throws `secret_missing` (exit 2). The error names the secret and where it should live. It never holds a value.

`HOME` and `FACTORY_HOME` are not secrets. Paths still come from `resolveFactoryPaths(env)`.

## The static scan

A test in `test/ports/` scans every file in `src/`. Outside `src/ports/`, a file fails the scan when it:

- calls `gh`, `acli`, `security`, `pbcopy` or `pbpaste`, or starts a command string with them;
- spawns `agent`, `cursor-agent`, `opencode` or `copilot`.

Local `git` is allowed. So are the spawn sites that existed before this ticket: `src/config/load.ts`, `src/worktree/git.ts`, `src/worktree/install.ts`, `src/preflight/models.ts`, `src/probe/probe.ts`, `src/probe/runners.ts` and `src/cli/version-check.ts`. They stay as they are.

## Errors

| Code | Exit | When |
| --- | --- | --- |
| `unsupported_os` | 2 | `assertSupportedPlatform` on a system that is not macOS. |
| `secret_missing` | 2 | `resolveSecret` found no value. |
| `write_not_allowed` | 2 | A recording fake got a write that is not on its allow-list. |
| `spawn_failed` | 2 | The macOS spawner could not start the command. |
| `clipboard_failed` | 2 | `pbcopy` or `pbpaste` exited with an error. |

## Deferred

Not in this ticket: live `acli` and `gh` adapters (they come with intake and draft pull requests), the `factory kill` command and run state wiring, the worker runtime, the screenshot, pixel-diff and region-judge ports, and moving git, install, preflight, probe and version-check onto `Spawner`. File `chmod` also stays outside `Platform`.
