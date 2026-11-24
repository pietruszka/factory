---
name: factory-test
description: >-
  Write or change factory Vitest tests, fixtures, fakes, L3 pipeline tests, or
  test setup. Use when editing test/, adding contract cases, or fixing isolation
  failures (home, network, real CLI).
---

# factory-test

How tests stay isolated. Details: [Testing](../../../docs/reference/testing.md), [Ports](../../../docs/reference/ports.md).

## Isolation rules

- Never touch real `~/.factory`, `~/.factory-private`, or `~/.cache/factory`. Use the temp `HOME` from setup, or `makeTempHome()`.
- Docs and fixtures use `<tmp>`-style placeholders, never a user-home path.
- Network is blocked except localhost. Do not add fetches to remote hosts in tests.
- Do not spawn real `agent`, `cursor-agent`, or `opencode`. Use `test/support/fake-cli.ts` and the scripted fake worker.

## Fakes and time

- Outside systems: recording fakes from `src/ports/` (`createRecordingCodeHost`, `createFakeSpawner`, …). Allow writes explicitly when a test expects them.
- Drive time and ids through injected `Deps`, not real waits or `Date.now`.

## Layout

- Files under `test/`, names end in `.test.ts`. Titles are plain behaviour names.
- Pipeline / fake-worker scenarios go in `test/l3/` (120 s budget via `npm run test:l3`).
- Sample install gates are opt-in (`npm run test:sample-gates`), not part of `npm test`.

## After changing tests

- `npm test`. If you touched L3, also `npm run test:l3`.
