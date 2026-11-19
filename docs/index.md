---
layout: home

hero:
  name: factory
  text: Documentation for pietruszka/factory
  tagline: A public repository with no application source. One page records the intended factory flow. The rest describe the files in the tree and how this site is published.
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
    details: The MVP requirements for a personal software factory, from a ticket or a PR to a draft the Developer merges. The CLI is not in this repository.
    link: /flow
    linkText: Read the flow
  - title: No application yet
    details: The first commit added a README whose only content is the heading "factory". There is no library, service, CLI, schema, or test suite.
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
The name "factory" refers to the personal software factory in [End-to-end flow](/flow). That page is the MVP requirements. This repository still has no application source, and those commands are not implemented here.
:::

This site is the documentation for the Git repository [pietruszka/factory](https://github.com/pietruszka/factory). It is not a guide to a framework or a library of that name. The product those requirements describe is [End-to-end flow](/flow).

| Fact | Value |
| --- | --- |
| Repository | Public GitHub repository `pietruszka/factory` |
| Default branch | `main` |
| Application source | None |
| License file | None |
| Package | `package.json` exists only to run this docs site |
| Public Pages URL | <https://pietruszka.github.io/factory/> |
| Product flow | [End-to-end flow](/flow). Requirements only. Not implemented in this repository |

That address is live. Pages is set to GitHub Actions, and the site is public. See [GitHub Pages workflow](/reference/pages-workflow).

## Who these pages are for

- Someone reading the intended factory flow. See [End-to-end flow](/flow). The CLI is not in this repository.
- Someone cloning the repository, who needs to know there is nothing to run except the docs site.
- Someone editing the docs, who needs the scripts, the config, and the Pages workflow.
- A future contributor adding application code, who should replace the architecture notes rather than invent a second source of truth.
