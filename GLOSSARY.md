# Glossary

Words for this factory. The requirements page uses the same words in [docs/flow.md](docs/flow.md#glossary).

**Run**:
One pass over a ticket, from preflight until `passed` or a stop status.

**Step**:
One worker call inside a run. A finished step is not started again when the run continues.

**Phase**:
Where a run sits while it is still going: `preflight`, `routing`, `planning`, `awaiting_approval`, `building`, `gating`, `verifying`, `reviewing`, `opening_pr`.

**Flow**:
The kind of work. A is a small story, E a bug, F a read-only review, H a small chore.

**Cap**:
The dollar limit and the wall-clock limit on one run. Hitting either stops the run.

**Worktree**:
The git checkout the run edits, under the cache root, from a pinned base commit. The work repo's own checkout stays untouched.

**Run folder**:
The folder under the factory home that holds the plan, evidence, prompts and report for one repo and ticket.

**Write scope**:
The worktree paths a role may change. A change outside them is put back.

**Breach**:
A step that wrote outside its write scope. The run stops, cannot be resumed, and the process exits 3.

**Port**:
A small interface through which the core reaches an outside system. The interfaces live in `src/ports/`.

**Fake**:
The test double for a port. It records every call, and a write is refused until the test allows it.

**L3**:
A pipeline test under `test/l3/` that drives the factory with the fake worker. The budget is 120 seconds.

**Dev home**:
A throwaway factory home, marked `.factory-dev-home` and selected with `FACTORY_HOME`. It is never the real `~/.factory`.

**Sandbox**:
The to-do sample unpacked under the cache root by `factory dev-init --sample`. It is not a work repo.
