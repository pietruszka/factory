---
title: npm scripts
description: The only npm scripts in the factory repository.
---

# npm scripts

`package.json` defines three scripts. There is no `start`, `build`, `test`, or `lint` script, because there is no application.

| Script | Command | Purpose |
| --- | --- | --- |
| `docs:dev` | `vitepress dev docs` | Local dev server with reload |
| `docs:build` | `vitepress build docs` | Production static build |
| `docs:preview` | `vitepress preview docs` | Serve the production build locally |

Run them with npm from the repository root:

```sh
npm run docs:dev
npm run docs:build
npm run docs:preview
```

## `docs:dev`

Starts the VitePress dev server with `docs/` as the project root. The default port is `5173`. If that port is taken, VitePress picks another and prints it.

The site `base` is `/factory/`, so the home page is at `/factory/` on that origin, not at `/`.

Use this while editing. It is not the artifact that GitHub Pages serves.

## `docs:build`

Compiles Markdown and `docs/.vitepress/config.ts` into `docs/.vitepress/dist`.

The command fails when an internal link does not match a page. External links, including links to GitHub, are not fetched. A broken GitHub URL will not fail the build.

The output directory is gitignored. CI builds it fresh with `npm ci` followed by `npm run docs:build`.

## `docs:preview`

Serves `docs/.vitepress/dist`. Run `docs:build` first. If the output directory is missing, preview has nothing to serve.

The default port is `4173`. The home page is at `/factory/` on that origin, for the same reason as the dev server.

Pass VitePress arguments after `--`:

```sh
npm run docs:preview -- --port 8080
```

The `package.json` script itself does not pin a port. CI does not run preview.

## Dependency install

| Command | When |
| --- | --- |
| `npm ci` | CI, and a clean local install from the lockfile |
| `npm install` | After you change `package.json` dependencies |

The direct dev dependency is `vitepress` version `1.6.4`. `engines.node` asks for Node.js `>=20`. npm only enforces `engines` when `engine-strict` is enabled; it is not enabled here. The workflow still installs Node.js 22 so CI matches the version used to verify the build.
