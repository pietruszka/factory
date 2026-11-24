---
title: Architecture
description: What is in the factory repository, and how the documentation site is built.
---

# Architecture

::: info
[End-to-end flow](/flow) is the intended product, taken from the MVP requirements. The sections below describe this repository's current contents. The docs pipeline is not the full product architecture.
:::

## What the repository contains

The repository holds the TypeScript `factory` CLI (M1 foundation), its tests, agent instructions, and this VitePress site.

```text
.
├── .agents/skills/               # project agent skills (factory-change, factory-test, factory-docs)
├── .github/workflows/docs.yml    # build, and deploy to GitHub Pages
├── AGENTS.md                     # always-on instructions for coding agents on this repo
├── README.md                     # GitHub landing page; points here
├── package.json                  # CLI build, gates, docs scripts, sandbox helpers
├── src/
│   ├── adapters/                 # worker CLI output parsers
│   ├── cli/                      # factory commands (version, help, status, kill, resume, clean, dev-*)
│   ├── config/                   # factory and repo config loaders
│   ├── cost/                     # caps and usage
│   ├── dev/                      # throwaway FACTORY_HOME guards
│   ├── event-log/                # SQLite event log
│   ├── kill/ · resume/ · status/ # command implementations
│   ├── platform/                 # Deps, paths, errors
│   ├── ports/                    # outside-system seams + recording fakes
│   ├── preflight/                # config drift and toolchain checks
│   ├── probe/                    # CLI probe harness
│   ├── retention/                # factory clean
│   ├── run-folder/ · run-state/  # run artefacts and state machine
│   ├── sandbox/                  # sample to-do unpack
│   ├── worker-runtime/           # worker steps + fake worker
│   ├── worktree/                 # git worktree manager
│   └── write-scope/              # role write scopes
├── test/                         # Vitest suite (L3 under test/l3/)
├── scripts/                      # L3 runner, sample gates, sandbox pack
└── docs/                         # this site (VitePress, base /factory/)
    ├── agent-runbook.md          # sandbox-only agent debug loop (M1)
    ├── flow.md                   # MVP requirements (not a code map)
    ├── architecture.md
    └── reference/                # CLI, ports, testing, run-state, …
```

Generated directories `docs/.vitepress/cache` and `docs/.vitepress/dist` appear after a local build. They are not part of the source tree.

## Agent instructions

Coding agents that change this repository should follow root [AGENTS.md](https://github.com/pietruszka/factory/blob/main/AGENTS.md) and the skills under `.agents/skills/`. That `AGENTS.md` is for work **on** the repo; it is not the product-runtime file named in [End-to-end flow](/flow). Sandbox debugging of the factory itself uses the [Agent runbook](/agent-runbook).

## What is not here

These are absent. Do not document them as if they existed. [End-to-end flow](/flow) records the requirements for the full factory product. It is not a map of every command in that page:

- A license file (`LICENSE` / `COPYING`)
- A stated copyright holder
- Issue templates
- CI other than `.github/workflows/docs.yml`
- A GitHub repository description, homepage, or topics
- A published package on npm
- Flow A/E/F/H run commands (`factory plan`, `factory run`, `factory approve`, …) — not in M1

`README.md` is the GitHub project landing page. It links into `docs/` and does not repeat these pages. The canonical copy of the longer guide is this site.

## Documentation pipeline

```text
docs/**/*.md  +  docs/.vitepress/config.ts
        │
        ▼
npm run docs:build     (vitepress build docs)
        │
        ▼
docs/.vitepress/dist   (static HTML, CSS, JS)
        │
        ▼
actions/upload-pages-artifact
        │
        ▼
actions/deploy-pages
        │
        ▼
https://pietruszka.github.io/factory/
```

The build runs in GitHub Actions on every push to `main`, and when someone starts the workflow by hand. Pull requests that touch the docs only build. They do not deploy. Details and the one-time Pages setting are in [GitHub Pages workflow](/reference/pages-workflow).

## Concepts

### Source and output

Authors edit Markdown. VitePress compiles it to a static site. The published site has no server-side app and no database. Search is a local index built into the pages, not a hosted search service.

### Project-site base path

GitHub user sites are served at `https://<user>.github.io/`. Project sites are served at `https://<user>.github.io/<repository>/`. This repository is a project site, so `base` in the VitePress config is `/factory/`. Every root-relative link in the config is prefixed with that path at build time. Setting `base` to `/` would make CSS and page links point at the wrong host path.

The dev server still prints a localhost origin. Append `/factory/` when you open it. See [Getting started](/getting-started).

### Edit links

`themeConfig.editLink` points at `https://github.com/pietruszka/factory/edit/main/docs/:path`. `:path` is the page path inside `docs/`, so this page's link edits `docs/architecture.md`. The pattern for the home page would be `docs/index.md`, but the home layout does not render the link.

### Last updated

`lastUpdated: true` asks VitePress to read each page's last git commit. The build job checks out the full history (`fetch-depth: 0`) so those dates are available in CI. A page that has never been committed has no date, which is expected while writing it locally.

### Reference coverage

The [reference](/reference/cli) section documents the shipped CLI and library surfaces (commands, ports, testing, run state, and related tickets). Commands named only in [End-to-end flow](/flow) and listed under “Not in M1” in the [Agent runbook](/agent-runbook) are requirements, not code in this tree.
