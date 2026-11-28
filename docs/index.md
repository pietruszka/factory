---
layout: home

hero:
  name: factory
  text: Documentation for pietruszka/factory
  tagline: A public repository for the factory command line tool, a TypeScript project with a test suite. One page records the intended factory flow. The rest describe the files in the tree and how this site is published.
  actions:
    - theme: brand
      text: Getting started
      link: /getting-started
    - theme: alt
      text: End-to-end flow
      link: /flow
    - theme: alt
      text: Architecture
      link: /architecture

features:
  - title: Intended product flow
    details: The MVP requirements for a personal software factory, from a ticket or a PR to a draft the Developer merges. Full Flow A/E/F/H is not built yet; M1 proves the foundation.
    link: /flow
    linkText: Read the flow
  - title: M1 CLI and platform layer
    details: The `factory` command ships version, help, status, kill, resume, clean, and dev harness commands, with a `--json` envelope and fixed exit codes. Ports, Deps, run state and tests sit under it.
    link: /architecture
    linkText: See what is in the tree
  - title: Docs are Markdown in this repo
    details: Pages live under docs/ and are built with VitePress 1.6.4. Local search runs in the browser. There is no separate docs host or CMS.
    link: /reference/configuration
    linkText: Site configuration
  - title: Published from main
    details: GitHub Actions builds the site on every push to main and deploys it with the official GitHub Pages actions. The project-site base path is /factory/.
    link: /reference/pages-workflow
    linkText: Publishing workflow
---

## Current state

::: info
The name "factory" refers to the personal software factory in [End-to-end flow](/flow). That page is the MVP requirements. This repository holds the factory command line tool. M1 ships the foundation CLI (`version`, `help`, `status`, `kill`, `resume`, `clean`, `dev-init`, `dev-approve`) plus platform, ports and run-state. Flow A/E/F/H commands such as `factory run` and `factory approve` are not implemented yet.
:::

This site is the documentation for the Git repository [pietruszka/factory](https://github.com/pietruszka/factory). It is not a guide to a framework or a library of that name. The product those requirements describe is [End-to-end flow](/flow).

| Fact | Value |
| --- | --- |
| Repository | Public GitHub repository `pietruszka/factory` |
| Default branch | `main` |
| Application source | `src/`: platform, ports and the M1 `factory` CLI. See [CLI](/reference/cli) |
| Agent instructions | Root `AGENTS.md`, `CONTEXT.md`, `GLOSSARY.md` and `.agents/skills/` |
| License file | None |
| Package | `package.json` builds the CLI (`npm run build`, `bin.factory`), runs the gates and builds this docs site |
| Public Pages URL | <https://pietruszka.github.io/factory/> |
| Product flow | [End-to-end flow](/flow). Requirements; M1 foundation is in the tree |

That address is live. Pages is set to GitHub Actions, and the site is public. See [GitHub Pages workflow](/reference/pages-workflow).

## Who these pages are for

- Someone reading the intended factory flow. See [End-to-end flow](/flow). M1 foundation exists; full flows do not.
- Someone cloning the repository, who needs the build, lint and test commands. See [npm scripts](/reference/scripts).
- Someone editing the docs, who needs the scripts, the config, and the Pages workflow.
- A coding agent or contributor changing application code: follow root `AGENTS.md`, `CONTEXT.md` and `GLOSSARY.md`, and keep [Architecture](/architecture) aligned with the tree.

