---
layout: home

hero:
  name: factory
  text: Documentation for pietruszka/factory
  tagline: A public repository with no application source. These pages describe the files that are actually in the tree, and how this site is built and published.
  actions:
    - theme: brand
      text: Getting started
      link: /getting-started
    - theme: alt
      text: Architecture
      link: /architecture

features:
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

::: info TODO
Nothing in the repository defines what the name "factory" refers to. Treat it as a repository name, not as a product description, until the owner states otherwise.
:::

This site is the documentation for the Git repository [pietruszka/factory](https://github.com/pietruszka/factory). It is not a guide to a framework or a library of that name.

| Fact | Value |
| --- | --- |
| Repository | Public GitHub repository `pietruszka/factory` |
| Default branch | `main` |
| Application source | None |
| License file | None |
| Package | `package.json` exists only to run this docs site |
| Public Pages URL | <https://pietruszka.github.io/factory/> |

That address is live. Pages is set to GitHub Actions, and the site is public. See [GitHub Pages workflow](/reference/pages-workflow).

## Who these pages are for

- Someone cloning the repository, who needs to know there is nothing to run except the docs site.
- Someone editing the docs, who needs the scripts, the config, and the Pages workflow.
- A future contributor adding application code, who should replace the architecture notes rather than invent a second source of truth.
