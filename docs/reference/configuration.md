---
title: VitePress config
description: What docs/.vitepress/config.ts sets, and why.
---

# VitePress config

This page is about the documentation site. For the factory's own config files, see [Factory config](/reference/factory-config).

Site configuration is `docs/.vitepress/config.ts`. That file is the source of truth. This page lists the options it sets so a reader can see why they are there. It does not describe every VitePress option.

The config is TypeScript, imported through `defineConfig` from `vitepress`, then passed through `withMermaid` from `vitepress-plugin-mermaid`. `package.json` sets `"type": "module"`, and VitePress loads `config.ts` itself. There is no separate compile step.

`withMermaid` turns `mermaid` fences into diagrams in the browser. [End-to-end flow](/flow) is the page that uses them. GitHub renders the same fences natively. No `mermaid` theme override is set, so the diagrams use Mermaid's default theme. `mermaid` is pinned to 11.17.2 because the plugin accepts Mermaid 10 or 11.

`docs/.vitepress/theme/mermaid.css` resets the line-height and margin of paragraphs inside Mermaid HTML labels. Without that reset, `.vp-doc p` makes the label taller than the box Mermaid measured, and the last line is clipped. The Markdown fences are unchanged, so GitHub's renderer is unaffected.

## Site options

| Option | Value | Why |
| --- | --- | --- |
| `title` | `factory` | Browser title and nav label. Matches the repository name. |
| `description` | See the config file | Used in the page meta description. Describes the factory command line tool, the site and Pages publishing. |
| `lang` | `en-US` | Pages are written in English. |
| `base` | `/factory/` | GitHub Pages project site. Must start and end with `/`. |
| `lastUpdated` | `true` | Shows the last git commit date on each page. Needs full git history in CI. |
| `sitemap.hostname` | `https://pietruszka.github.io/factory/` | VitePress 1.6.4 writes page paths relative to this hostname and does not insert `base` itself. The trailing slash is required so `architecture.html` stays under `/factory/`. |

`cleanUrls` is left at the default, `false`. Page URLs end in `.html` (the home page is the directory index). GitHub Pages does not rewrite extensionless paths for this site.

No custom theme, logo, or head tags are configured. The default VitePress theme is the UI.

## Theme options

| Option | Behavior |
| --- | --- |
| `nav` | Top links: Getting started, Flow, Architecture, and a Reference menu. |
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

## Factory paths

`resolveFactoryPaths(env, opts?)` in `src/platform/paths.ts` is the only place that decides where the factory keeps files (D-39). It reads `HOME` and `FACTORY_HOME` from the `env` it is given. It creates no folder and writes nothing. Code outside `src/platform/paths.ts` must not write home paths as string literals; `npm run lint` rejects string literals that contain a user-home path, a `/home/<name>` path or a literal `~/.factory`.

| Field | Default (`FACTORY_HOME` unset) | With `FACTORY_HOME=<fh>` |
| --- | --- | --- |
| `home` | `<HOME>/.factory` | `<fh>` |
| `privateHome` | `<HOME>/.factory-private` | `<fh>-private` (a sibling of `home`, D-15) |
| `cacheRoot` | `<HOME>/.cache/factory` | `<fh>/cache` |
| `worktreesRoot` | `<cacheRoot>/worktrees` | `<fh>/cache/worktrees` |
| `sandboxRoot` | `<cacheRoot>/sandbox` | `<fh>/cache/sandbox` |
| `runsRoot` | `<home>/runs` | same rule, under `<fh>` |
| `dbPath` | `<home>/factory.db` | same rule, under `<fh>` |
| `configPath` | `<home>/config.yaml` | same rule, under `<fh>` |
| `reposDir` | `<home>/repos` | same rule, under `<fh>` |
| `baselineReportsDir` | `<home>/sandbox/baseline-reports` | same rule, under `<fh>` |

Rules:

- **Cache folder (D-39).** Worktrees and the sandbox live in the cache root, not under the home. Config, `factory.db`, run folders and baseline reports stay under the home. The tables, pragmas and errors of `factory.db` are on [Event log](/reference/event-log). The worktree layout, modes and errors are on [Worktrees](/reference/worktrees). The to-do sample app that the generator builds in `sandboxRoot`, and `factory dev-init --sample`, are on [Sandbox and dev-init](/reference/sandbox); `baselineReportsDir` is not moved by either.
- **`FACTORY_HOME`.** Must be an absolute path. A leading `~/` is expanded against `HOME`. A relative value is refused with code `factory_home_relative`. An empty value counts as unset.
- **`XDG_CACHE_HOME` is ignored.** The cache root never depends on it.
- **Protected folders.** `home`, `cacheRoot`, `worktreesRoot` and `sandboxRoot` are each checked. A path at or inside `<HOME>/Documents`, `<HOME>/Desktop` or `<HOME>/Downloads` is refused with code `protected_folder`. The check follows symlinks, so a link outside those folders that points into them is refused too. On macOS the comparison ignores case. `<HOME>/Documentsx` is not a protected folder. The error's `where` is the path as given, and its `next` names `~/.cache/factory`.

### Errors

Path errors are `FactoryError` values (`src/platform/errors.ts`) with `code`, `message` (what), `where`, `next` (the next action) and `exitCode`.

| Code | Exit code | Meaning |
| --- | --- | --- |
| `factory_home_relative` | 2 | `FACTORY_HOME` is not an absolute path |
| `protected_folder` | 2 | A factory folder is inside Documents, Desktop or Downloads |
| `real_home_in_test` | 4 | A test resolved paths while `HOME` was the real user home (see below) |

### Testing notes

- Every test sets `HOME` to a fresh temp folder (`makeTempHome()` in `test/support/temp-home.ts`) and passes it in `env`.
- `PathOptions.platform` overrides `process.platform`, so the macOS case rule is testable on any OS. `PathOptions.realHome` overrides the real home the guard compares against.
- `test/setup/real-home.ts` runs before every test file (see `setupFiles` in `vitest.config.ts`). It stores the real user home under `Symbol.for('factory.realHome')`. When `resolveFactoryPaths` is called with a `HOME` equal to that value, it throws `real_home_in_test`, so a test can never resolve the real `~/.factory`, `~/.factory-private` or `~/.cache/factory`. Outside tests the key is unset and the guard does nothing.

### Clock and randomness

`src/platform/deps.ts` defines `Deps` (`now`, `sleep`, `setTimer`, `clearTimer`, `newId`, `random`) and `createSystemDeps()`. Outside `src/platform/deps.ts`, `npm run lint` bans `Date.now`, `new Date` in any form, `setTimeout`, `setInterval`, `Math.random` and `crypto.randomUUID`, with the message "use Deps (P-14)". Files under `test/` are exempt. `test/support/fake-deps.ts` gives a fake clock with `advance(ms)`, sequential ids (`r_0001`, `r_0002`) and a seeded `random()`.
