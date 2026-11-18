---
title: VitePress config
description: What docs/.vitepress/config.ts sets, and why.
---

# VitePress config

Site configuration is `docs/.vitepress/config.ts`. That file is the source of truth. This page lists the options it sets so a reader can see why they are there. It does not describe every VitePress option.

The config is TypeScript, imported through `defineConfig` from `vitepress`. `package.json` sets `"type": "module"`, and VitePress loads `config.ts` itself. There is no separate compile step.

## Site options

| Option | Value | Why |
| --- | --- | --- |
| `title` | `factory` | Browser title and nav label. Matches the repository name. |
| `description` | See the config file | Used in the page meta description. States that there is no application source. |
| `lang` | `en-US` | Pages are written in English. |
| `base` | `/factory/` | GitHub Pages project site. Must start and end with `/`. |
| `lastUpdated` | `true` | Shows the last git commit date on each page. Needs full git history in CI. |
| `sitemap.hostname` | `https://pietruszka.github.io/factory/` | VitePress 1.6.4 writes page paths relative to this hostname and does not insert `base` itself. The trailing slash is required so `architecture.html` stays under `/factory/`. |

`cleanUrls` is left at the default, `false`. Page URLs end in `.html` (the home page is the directory index). GitHub Pages does not rewrite extensionless paths for this site.

No custom theme, logo, or head tags are configured. The default VitePress theme is the UI.

## Theme options

| Option | Behavior |
| --- | --- |
| `nav` | Top links: Getting started, Architecture, and a Reference menu. |
| `sidebar` | Same pages, grouped into Guide and Reference, on every content page. |
| `search.provider` | `local`. The index is built into the static site. No Algolia key and no external search service. |
| `editLink.pattern` | `https://github.com/pietruszka/factory/edit/main/docs/:path` |
| `editLink.text` | `Edit this page on GitHub` |
| `socialLinks` | One GitHub icon, linking to the repository. |
| `footer.message` | `No license file is present in this repository.` |
| `outline.level` | Headings from `h2` through `h3` in the right-hand outline. |

The default theme shows the footer on pages without a sidebar. The home page shows it. Guide and reference pages show the sidebar instead.

`editLink` opens GitHub's editor for people who can push to the repository. `:path` is relative to `docs/`.

## Navigation and new pages

Adding a Markdown file under `docs/` creates a route. Local search indexes that page from its headings and text, with or without a menu entry. Update the `nav` and `sidebar` arrays in `docs/.vitepress/config.ts` when the page should appear in those menus.

Use root-relative links such as `/getting-started` in config and in Markdown. Do not prefix them with `/factory/`; VitePress adds `base` during the build.

Internal links are checked by `docs:build`. A link to a page you removed will fail the build.

## Options that were not set

- `srcDir` other than the default. The CLI is invoked as `vitepress <command> docs`, so `docs/` is the project root.
- `outDir`. Output stays at `docs/.vitepress/dist`, which is what the workflow uploads.
- `ignoreDeadLinks`. Dead internal links should fail the build.
- Algolia, Carbon ads, and i18n locales. Nothing in the repository calls for them.
- A favicon or logo. None was provided with the repository.

`docs/.vitepress/theme/index.ts` extends the default theme only to fill the `not-found` slot. `docs/404.md` sets the document title for a missing route. VitePress does not render that file's body: the app container in `404.html` is empty, and the theme shows its not-found view instead. The slot keeps the default not-found view and adds links to Getting started and Architecture. Other routes use the default theme unchanged.
