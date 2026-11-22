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
    details: The MVP requirements for a personal software factory, from a ticket or a PR to a draft the Developer merges. Only the CLI shell is built so far.
    link: /flow
    linkText: Read the flow
  - title: CLI shell and platform layer
    details: The `factory` command has `version` and `help`, a `--json` envelope and fixed exit codes. Paths, the Deps port, lint rules and a test suite sit under it.
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
The name "factory" refers to the personal software factory in [End-to-end flow](/flow). That page is the MVP requirements. This repository holds the factory command line tool. So far it has only the shell: version and help commands, a consistent `--json` output and exit codes. The run commands from that page are not implemented yet.
:::

This site is the documentation for the Git repository [pietruszka/factory](https://github.com/pietruszka/factory). It is not a guide to a framework or a library of that name. The product those requirements describe is [End-to-end flow](/flow).

| Fact | Value |
| --- | --- |
| Repository | Public GitHub repository `pietruszka/factory` |
| Default branch | `main` |
| Application source | `src/`: platform layer and the `factory` CLI shell (`version`, `help`). See [CLI](/reference/cli) |
| License file | None |
| Package | `package.json` builds the CLI (`npm run build`, `bin.factory`), runs the gates and builds this docs site |
| Public Pages URL | <https://pietruszka.github.io/factory/> |
| Product flow | [End-to-end flow](/flow). Requirements; only the M1 foundation is being built |

That address is live. Pages is set to GitHub Actions, and the site is public. See [GitHub Pages workflow](/reference/pages-workflow).

## Who these pages are for

- Someone reading the intended factory flow. See [End-to-end flow](/flow). Only the CLI shell exists so far.
- Someone cloning the repository, who needs the build, lint and test commands. See [npm scripts](/reference/scripts).
- Someone editing the docs, who needs the scripts, the config, and the Pages workflow.
- A future contributor adding application code, who should replace the architecture notes rather than invent a second source of truth.
