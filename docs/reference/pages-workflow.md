---
title: GitHub Pages workflow
description: How the factory docs are built and deployed to GitHub Pages.
---

# GitHub Pages workflow

Publishing is `.github/workflows/docs.yml`. The workflow builds the VitePress site and, except on pull requests, deploys `docs/.vitepress/dist` to GitHub Pages.

## One-time setup

This is already done. Pages uses GitHub Actions (`build_type: workflow`). The public site is the URL in the next section.

If the source is changed later, set **Settings → Pages → Build and deployment → Source** back to **GitHub Actions**. The workflow cannot do that.

::: info Visibility
`pietruszka/factory` is a public repository owned by a user account, and the published site is public.

A privately published Pages site, readable only by people with repository access, requires a GitHub Enterprise Cloud organization. This repository is not in an organization. GitHub Pro can publish Pages from a private repository, but that site is still public. Making this repository private would not hide these docs.
:::

## Public URL

After a successful public deploy the project site is:

<https://pietruszka.github.io/factory/>

That is the public Pages URL. `base` is `/factory/` and `sitemap.hostname` is `https://pietruszka.github.io/factory/` so the built links match it. The workflow does not deploy to a custom domain. No custom domain is configured on the repository.

The deploy job records the URL GitHub actually assigned on the `github-pages` environment. For this repository that should be the public URL above. A privately published site, which this user-owned repository cannot create, uses a different host. If the assigned URL ever differs, change `base` and `sitemap.hostname` to match it. Leaving them pointed at `pietruszka.github.io/factory/` would publish links and a sitemap for the wrong origin.

## When it runs

| Event | Build | Deploy |
| --- | --- | --- |
| Push to `main` | Yes | Yes |
| `workflow_dispatch` (Actions tab, or the API) | Yes | Yes |
| Pull request that changes `docs/**`, `package.json`, `package-lock.json`, or `.github/workflows/docs.yml` | Yes | No |
| Pull request that does not touch those paths | No | No |

Pushes to `main` are not path-filtered. A push that only changes `README.md` still builds and deploys the docs.

## Permissions

Permissions are set per job. A scope that a job does not list is not granted.

| Job | Permission | Access | Used for |
| --- | --- | --- | --- |
| `build` | `contents` | read | Checkout |
| `build` | `actions` | write | Upload the Pages artifact (`actions/upload-artifact` inside `actions/upload-pages-artifact`) |
| `deploy` | `contents` | read | `actions/configure-pages` token |
| `deploy` | `pages` | write | Create the GitHub Pages deployment |
| `deploy` | `id-token` | write | OIDC token that `actions/deploy-pages` sends with the deployment |

`pages: write` and `id-token: write` are not on the build job. That job installs dependencies and runs VitePress. The workflow does not request write access to repository contents. It does not push commits. Checkout sets `persist-credentials: false`, so the Git credential is not left in the job for `npm ci` or the VitePress build. `fetch-depth: 0` still downloads the history VitePress reads locally for `lastUpdated`.

## Jobs

### `build`

Runs on `ubuntu-latest`.

1. Checkout with `fetch-depth: 0` and `persist-credentials: false`, so `lastUpdated` can read commit dates without keeping a Git credential.
2. Install Node.js 22 and cache npm from `package-lock.json`.
3. `npm ci`
4. `npm run docs:build`
5. On events other than `pull_request`: `actions/upload-pages-artifact` with `path: docs/.vitepress/dist`.

Pull requests stop after the build. They do not upload a Pages artifact, so a docs PR can pass before Pages has been enabled.

### `deploy`

Runs only when the event is not a pull request, and only after `build` succeeds.

It is bound to the GitHub environment named `github-pages`. That environment name is required by GitHub Pages. The job runs `actions/configure-pages`, then `actions/deploy-pages`. The deployment step prints the published URL as the environment URL. `configure-pages` does not change `base`; the VitePress config already sets it.

## Concurrency

Publishing events (`push` to `main`, and `workflow_dispatch`) use the group `pages` with `cancel-in-progress: false`. One of those runs proceeds at a time. A newer publish waits. An in-progress deploy is not cancelled, because cancelling it can leave Pages mid-publish.

A pull request uses the group `pages-pr-<number>` and cancels an older run of that same pull request. It is not in the `pages` group, so it cannot replace a publish that is waiting behind an active deploy. GitHub cancels a pending run when a new run joins the same group, even when `cancel-in-progress` is false. That is why the groups are separate.

## Actions

| Action | Role |
| --- | --- |
| `actions/checkout` | Clone the repository |
| `actions/setup-node` | Install Node.js 22 and cache npm |
| `actions/configure-pages` | Read Pages configuration in the deploy job |
| `actions/upload-pages-artifact` | Archive the already-built `docs/.vitepress/dist` and upload that archive |
| `actions/deploy-pages` | Publish that artifact |

`actions/upload-pages-artifact` does not create a `.nojekyll` file and does not build the site. The directory passed as `path` is the VitePress output from `docs:build`. GitHub Actions Pages serves that artifact directly. It does not run Jekyll over it.

## What the workflow does not do

- It does not set the Pages source. That is the manual step above.
- It does not deploy pull request previews.
- It does not publish any directory other than `docs/.vitepress/dist`.
- It does not run tests. The suite is under `test/` and runs in CI.
