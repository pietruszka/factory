---
title: GitHub Pages workflow
description: How the factory docs are built and deployed to GitHub Pages.
---

# GitHub Pages workflow

Publishing is `.github/workflows/docs.yml`. The workflow builds the VitePress site and, except on pull requests, deploys `docs/.vitepress/dist` to GitHub Pages.

## One-time setup

A repository admin has to do this once. The workflow cannot do it:

1. Open the repository **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.

Until that source is selected, `actions/deploy-pages` has no Pages site to publish to.

::: warning Private repository
`pietruszka/factory` is private. GitHub Pages for a private repository requires a paid plan (GitHub Pro, GitHub Team, or GitHub Enterprise Cloud). On a free plan the deploy job fails even when the workflow file is correct.

Pages visibility (public on the internet, or limited to people with access to the repository) is a setting on that same Pages screen. This repository does not choose it in code. The workflow does not make the repository public.
:::

## Expected URL

After a successful deploy the project site is:

<https://pietruszka.github.io/factory/>

That path matches `base: '/factory/'` in the VitePress config. The workflow does not deploy to a custom domain. No custom domain is configured on the repository.

## When it runs

| Event | Build | Deploy |
| --- | --- | --- |
| Push to `main` | Yes | Yes |
| `workflow_dispatch` (Actions tab, or the API) | Yes | Yes |
| Pull request that changes `docs/**`, `package.json`, `package-lock.json`, or `.github/workflows/docs.yml` | Yes | No |
| Pull request that does not touch those paths | No | No |

Pushes to `main` are not path-filtered. A push that only changes `README.md` still builds and deploys the docs.

## Permissions

The workflow token is limited to:

| Permission | Access | Used for |
| --- | --- | --- |
| `contents` | read | Checkout |
| `pages` | write | Upload the site and create the deployment |
| `id-token` | write | Authenticate the deploy to GitHub Pages |

The workflow does not request write access to repository contents. It does not push commits.

## Jobs

### `build`

Runs on `ubuntu-latest`.

1. Checkout with `fetch-depth: 0`, so `lastUpdated` can read commit dates.
2. Install Node.js 22 and cache npm from `package-lock.json`.
3. `npm ci`
4. `npm run docs:build`
5. On events other than `pull_request`: `actions/configure-pages`, then `actions/upload-pages-artifact` with `path: docs/.vitepress/dist`.

Pull requests stop after the build. They do not call the Pages actions, so a docs PR can pass before Pages has been enabled.

### `deploy`

Runs only when the event is not a pull request, and only after `build` succeeds.

It is bound to the GitHub environment named `github-pages`. That environment name is required by GitHub Pages. The job runs `actions/deploy-pages`, which prints the published URL as the environment URL.

## Concurrency

```yaml
concurrency:
  group: pages
  cancel-in-progress: false
```

One run in the `pages` group proceeds at a time. A newer run waits. An in-progress production deploy is not cancelled, because cancelling it can leave Pages mid-publish. A pull-request build uses the same group, so it waits on a deploy rather than interrupting it.

## Actions

| Action | Role |
| --- | --- |
| `actions/checkout` | Clone the repository |
| `actions/setup-node` | Install Node.js 22 and cache npm |
| `actions/configure-pages` | Read Pages configuration before upload |
| `actions/upload-pages-artifact` | Upload `docs/.vitepress/dist` as the Pages artifact |
| `actions/deploy-pages` | Publish that artifact |

`actions/upload-pages-artifact` adds an empty `.nojekyll` file to the artifact so GitHub Pages does not run Jekyll over the VitePress output.

## What the workflow does not do

- It does not set the Pages source. That is the manual step above.
- It does not deploy pull request previews.
- It does not publish any directory other than `docs/.vitepress/dist`.
- It does not run tests. There are no tests in the repository.
