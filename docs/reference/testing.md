---
title: Testing
description: How tests stay isolated (temp homes, network guard, no real CLI) and the L3 time budget.
---

# Testing

Tests run with Vitest. Every test file sits under `test/` and ends in `.test.ts`. Test titles are plain behaviour names, grouped with `describe` blocks. `npm test` runs all of them.

## Temp homes

Tests never touch the real `~/.factory`, `~/.factory-private` or `~/.cache/factory`. A global hook in `test/setup/real-home.ts` gives every test a fresh temp folder as `HOME` (and `USERPROFILE`) and restores and removes it afterwards. Tests that need a specific layout build it with `makeTempHome()` from `test/support/temp-home.ts`.

`test/setup/real-home.ts` records the real home once, before the per-test override. `resolveFactoryPaths` fails with `real_home_in_test` when a test resolves paths that point into the real home's factory folders, through `HOME`, `FACTORY_HOME` or a symlink.

Docs and fixtures use `<tmp>`-style placeholders, never a user-home path. A repo scan fails on any such path in `src/`, `test/` or `docs/`.

## Network guard

`test/setup/network-block.ts` runs before every test file (`setupFiles` in `vitest.config.ts`). It throws "Network access blocked in tests." for any host other than `localhost`, `127.0.0.1` and `::1`. It covers `fetch`, `net`, `tls`, `http`, `https`, `http2` (through `net` and `tls`), UDP (`dgram` `connect` and `send`) and DNS lookups. The DNS guard lets the wildcard bind addresses `0.0.0.0` and `::` through `dns.lookup` only, because Node resolves them when a UDP socket binds implicitly; the destination checks still refuse non-local hosts.

## No real CLI

A static test scans `test/` and fails when a file starts `agent`, `cursor-agent` or `opencode` with `spawn`, `exec` or `fork`. The only place that may stand in for those CLIs is `test/support/fake-cli.ts`.

The scripted fake worker for pipeline tests is described in [Worker runtime](/reference/worker-runtime#fake-worker).

Tests use the recording fakes for outside systems, and a second static scan keeps the rest of `src/` from calling `gh`, `acli`, `security`, `pbcopy` or `pbpaste`. See [Ports](/reference/ports).

## L3 tests and their budget

Pipeline tests that drive the factory with the fake worker live in `test/l3/`. None exist yet. `npm test` runs them with everything else; `npm run test:l3` runs only that folder and checks its time.

| Command | Runs |
| --- | --- |
| `npm test` | All tests, including `test/l3/` |
| `npm run test:l3` | Only `test/l3/` (`vitest run test/l3/ --passWithNoTests`) |

`test:l3` prints the time it took, for example `L3 took 12 s`. The budget is 120 s: on breach it prints `L3 took 121 s, budget 120 s` and exits 1. While `test/l3/` holds no test, `test:l3` passes with zero tests.
