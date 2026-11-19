---
title: Getting started
description: Clone the factory repository and run the documentation site locally.
---

# Getting started

There is no application to install. The only commands in `package.json` build and serve this documentation site.

## Access

[pietruszka/factory](https://github.com/pietruszka/factory) is a public repository. `git clone` does not require a GitHub account. Pushing still requires write access.

## Prerequisites

- Git
- Node.js 20 or newer. The Pages workflow pins Node.js 22, which is the version used to verify `docs:build` locally.
- npm, which ships with Node.js.

npm is the package manager because the repository had no lockfile when these docs were added. Dependencies are locked in `package-lock.json`. Do not add a second lockfile.

## Clone and install

```sh
git clone https://github.com/pietruszka/factory.git
cd factory
npm ci
```

`npm ci` installs the tree from the lockfile and fails if `package.json` and `package-lock.json` disagree. Direct dev dependencies are `vitepress` at 1.6.4 (the latest stable 1.x release; VitePress 2 is still a prerelease and is not used here), `mermaid` at 11.17.2, and `vitepress-plugin-mermaid` at 2.0.17. The Mermaid packages render the diagrams on [End-to-end flow](/flow). GitHub renders those same fences without them.

`npm install` is the command to use when you change dependencies. Commit the updated lockfile with that change.

## Edit the site locally

```sh
npm run docs:dev
```

The dev server prints a local URL. Because `base` is `/factory/`, open the site under that path. On the default port that is `http://localhost:5173/factory/`.

The dev server reloads when you save a Markdown file under `docs/`. It does not deploy anywhere.

## Build and preview the production site

```sh
npm run docs:build
npm run docs:preview
```

`docs:build` writes static files to `docs/.vitepress/dist` and exits with an error if an internal link has no matching page. `docs:preview` serves that directory. On the default port, open `http://localhost:4173/factory/`.

Both `docs/.vitepress/dist` and `docs/.vitepress/cache` are listed in `.gitignore`. Leave them untracked.

## Where to edit

| Change | File |
| --- | --- |
| Page content | `docs/**/*.md` |
| Title, nav, sidebar, search, edit link, base path | `docs/.vitepress/config.ts` |
| Install and scripts | `package.json` and `package-lock.json` |
| Publish pipeline | `.github/workflows/docs.yml` |
| GitHub landing page | `README.md` |

Guide and reference pages have an "Edit this page on GitHub" link. It opens the editor on `main` for people who can push to the repository. The link is not a public edit form. The home page uses the home layout, which does not render that link. Edit `docs/index.md` directly for home-page changes.

## Next

Read [Architecture](/architecture) for the file tree and the publishing pipeline. The intended product flow is [End-to-end flow](/flow). Script flags and ports are in [npm scripts](/reference/scripts).
