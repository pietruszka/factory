---
title: Factory config (FAC-14)
description: The global and per-repo config files, their keys, how they merge, the config hash, repo matching, the YAML guards and the errors.
---

# Factory config (FAC-14)

This page describes the factory's own config: one global file and one file per repo, both under the factory home. It is not the [VitePress config](/reference/configuration). The role-to-model section is described on [Model IDs by role](/reference/models).

The code is `src/config/`. The public functions are `loadGlobalConfig({ env })` and `loadConfig({ env, repoPath, originUrl? })`. Neither writes anything. There is no `factory config` command yet.

## Files

| File | Purpose |
| --- | --- |
| `<home>/config.yaml` | Global settings. Required. |
| `<home>/repos/<name>.yaml` | One file per repo. Chosen by its `match`, not by its name. |

`<home>` comes from `resolveFactoryPaths` (see [Configuration](/reference/configuration)): `$FACTORY_HOME`, or `~/.factory`. Only those two kinds of file are read. Other extensions and sub-folders under `repos/` are ignored (`repos/<repo>/agents/` is not read yet). A `config.yaml` or `.factory/config.yaml` inside the work repo is never read.

If `config.yaml` is missing, loading is refused with `config_missing`. The error names the path. Create the file, or run `npm run dev:init -- <throwaway-folder>` to make a throwaway home with a starter file.

Every file in `repos/` is parsed and validated on each load, so a broken file for one repo also stops loading for the others.

## Keys

A file that holds only a `models:` section, as `dev:init` writes it, is valid. Unknown keys are refused.

### Settings in either file

| Key | Type | Default | Notes |
| --- | --- | --- | --- |
| `version` | `1` | `1` | |
| `models` | map | none | The FAC-6 role-to-model section. Not defaulted here. |
| `caps.<flow>.usd` | number > 0 | A 5, E 6, F 2, H 2 | Flows are `A`, `E`, `F`, `H`. |
| `caps.<flow>.minutes` | number > 0 | A 30, E 45, F 15, H 15 | |
| `caps.<flow>.fix_loops` | integer >= 0 | 2 | |
| `rate_table` | map | `{}` | Model id to `inputPer1M`, `outputPer1M`, `cacheReadPer1M`, `cacheWritePer1M` (number or null). |
| `secrets` | map | `{}` | Names only. See below. |
| `inspector.host` | string | `127.0.0.1` | |
| `inspector.port` | integer 0..65535 | `0` | |
| `dev_harness.repeats` | integer >= 1 | `3` | |
| `base_branch` | string | none | Required in the merged result. |
| `package_manager` | `npm`, `pnpm` or `yarn` | none | Required in the merged result. |
| `install` | string | none | One command. Required in the merged result. |
| `gates.lint`, `gates.typecheck`, `gates.test` | string | none | Required in the merged result. |
| `gates.build` | string | none | Optional. |
| `gates.e2e` | string or `null` | none | Optional. |
| `protected_globs`, `forbidden_globs`, `snapshot_ignore`, `pr_labels` | list of strings | `[]` | |
| `role_write_globs.<role>` | list of strings | `{}` | Roles are `planner`, `builder`, `reviewer`, `visionJudge`. |
| `risk_tiers.<tier>` | list of strings | `{}` | |
| `ui.dev_server`, `ui.url`, `ui.port`, `ui.viewports` | string, http(s) URL, integer 1..65535, list of `{ name, width, height }` | none | `ui` is optional. When set, all four keys are required. |
| `gates_cwd` | relative path, no `..` | `.` | |
| `timing_sensitive_repeats` | integer >= 1 | `3` | |
| `timing_sensitive_globs` | list of strings | `[]` | |

### Only in a repo file

| Key | Notes |
| --- | --- |
| `match.origin` | A git origin URL. Set `origin`, `path` or both. |
| `match.path` | An absolute path to the repo. |

`match` selects the file. It is not part of the merged config or its hash.

### Secrets

`secrets` maps a name to where the value lives, never to the value:

```yaml
secrets:
  github_token:
    env: GITHUB_TOKEN
  deploy_key:
    keychain: example-item
```

Each entry is exactly one of `env` (an environment variable name) or `keychain` (an item name).

## Merge

Order: defaults, then the global file, then the repo file, then validation, then the hash.

- Objects (`caps`, `ui`, `gates`, `risk_tiers`, `role_write_globs`, `secrets`, `rate_table`, `inspector`, `dev_harness`, `models`) merge key by key. The repo file wins.
- Lists (`protected_globs`, `forbidden_globs`, `snapshot_ignore`, `timing_sensitive_globs`, `pr_labels`, `ui.viewports`) are replaced as a whole when the repo file sets them. They are never appended.
- `null` in the repo file replaces a global value (for example `gates.e2e: null`).

Each file is also validated on its own, so a bad value in the global file is refused even when the repo file overrides it.

## Hash

`loadConfig` returns `hash: { algorithm: 'sha256', digest }`. The digest is the SHA-256, in lowercase hex, of the canonical JSON of the merged and validated config: UTF-8, keys sorted recursively, no insignificant whitespace. Comments and key order in the YAML files do not change it. Moving a value from one file to the other, with the same merged result, does not change it either.

## Repo matching

1. A file matches by origin when its `match.origin` and the repo's origin normalise to the same `host/path`.
2. If no file matches by origin, a file matches by path when its `match.path` and the repo path resolve to the same absolute path. Symlinks are followed. Case is ignored on macOS.
3. An origin match wins over a path match.
4. Two files that match at the same level are refused with `repo_config_ambiguous`. The message names both files.
5. No match is refused with `repo_config_missing`. The error names `<home>/repos/<repo-folder-name>.yaml` as the file to create, with `match.origin` or `match.path`.

The origin comes from `originUrl` when the caller passes it (`null` means no origin). Otherwise it is read with `git remote get-url origin` in the repo path. A repo with no origin can still match by path.

Normalising an origin: `https://`, `http://`, `ssh://`, `git@host:path` and a bare `host/path` are accepted. The scheme and host are lower-cased. Userinfo, the ports 443 and 22, a trailing `.git` and trailing slashes are dropped. The path keeps its case. Both `https://github.com/example-org/example-frontend.git` and `git@github.com:example-org/example-frontend.git` become `github.com/example-org/example-frontend`.

## YAML guards

All config goes through one wrapper, `readYamlConfig`, built on the `yaml` package pinned to 2.9.1. It parses YAML 1.2 with the core schema and refuses:

- a file over 1 MiB (1,048,576 bytes), checked before parsing
- bytes that are not valid UTF-8
- aliases and merge keys (`<<`)
- custom tags such as `!!js/function`
- duplicate keys and non-string keys
- keys named `__proto__`, `constructor` or `prototype`
- any YAML syntax error

## Secrets are refused

Two checks run on every file after parsing and before the other validation:

- A key whose name contains `TOKEN`, `SECRET`, `PASSWORD`, `PASS`, `AUTH`, `CREDENTIAL` or `API_KEY` (any case; `-` and `_` are the same) is refused. The `secrets` key and the entry names directly under it are exempt.
- A string value that holds a known token prefix at the start of a word (`ghp_`, `gho_`, `ghu_`, `ghs_`, `github_pat_`, `sk-`, `AKIA`, `xoxb-`, `xoxp-`, `xoxa-`) or a PEM private-key header is refused everywhere, including under `secrets` and inside gate command strings.

The error never prints the value.

## Errors

Every error is a `FactoryError` with exit code 2. `where` is `<file>:<line>`, or only the file or folder when no line applies. `next` says what to do.

| Code | When |
| --- | --- |
| `yaml_invalid` | A YAML guard above, or a syntax error. |
| `config_invalid` | An unknown key, a missing required key, or an invalid value. The message names the key. For a missing key the line is 1. |
| `config_secret` | A secret-looking key or value. |
| `config_missing` | `<home>/config.yaml` does not exist. |
| `repo_config_missing` | No file in `repos/` matches the repo. |
| `repo_config_ambiguous` | More than one file matches the repo. |

## Not in this ticket

Gate-command existence and `config_drift` checks, role prompt files, writing config, a `factory config` command, and renaming `models:`.
