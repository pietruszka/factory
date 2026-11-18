---
title: Architecture
description: What is in the factory repository, and how the documentation site is built.
---

# Architecture

::: info TODO
The repository name is `factory`. No file, commit message, or GitHub description defines a product, domain, or runtime behind that name. When application code is added, replace the sections below with the real components and how they depend on each other. The docs pipeline is not the product architecture.
:::

## What the repository contains

Before this documentation was added, the repository was a single commit whose only file was `README.md`, containing the heading `factory` and nothing else. There is still no application source.

After the docs site, the tracked tree is:

```text
.
├── .github/workflows/docs.yml    # build, and deploy to GitHub Pages
├── .gitignore                    # node_modules and VitePress output
├── README.md                     # GitHub landing page; points here
├── package.json                  # docs:dev, docs:build, docs:preview
├── package-lock.json             # npm lockfile for VitePress
└── docs/
    ├── index.md                  # home page
    ├── getting-started.md
    ├── architecture.md
    ├── 404.md                    # document title for a missing route
    ├── reference/
    │   ├── scripts.md
    │   ├── configuration.md
    │   └── pages-workflow.md
    └── .vitepress/
        ├── config.ts             # site config, including base: /factory/
        └── theme/index.ts        # not-found slot on the default theme
```

Generated directories `docs/.vitepress/cache` and `docs/.vitepress/dist` appear after a local build. They are not part of the source tree.

## What is not here

These are absent. Do not document them as if they existed:

- Application or library source (`src/`, packages, binaries)
- Tests
- A license file (`LICENSE` / `COPYING`)
- A stated copyright holder
- `AGENTS.md`, issue templates, or other contributor docs
- CI other than `.github/workflows/docs.yml`
- A GitHub repository description, homepage, or topics
- A published package on npm

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

### Pages that are intentionally missing

There is no API reference, CLI reference, or configuration reference for an application, because none of those exist. The reference section documents the docs toolchain only: [npm scripts](/reference/scripts), [VitePress config](/reference/configuration), and the [Pages workflow](/reference/pages-workflow).
