# factory

Public repository for the factory command line tool (M1 foundation) and its documentation.

Documentation for the repository and for the docs site itself is in [`docs/`](docs/index.md).

Coding agents: follow [`AGENTS.md`](AGENTS.md), [`CONTEXT.md`](CONTEXT.md), [`GLOSSARY.md`](GLOSSARY.md) and the skills under [`.agents/skills/`](.agents/skills/).

- Install and local preview: [Getting started](docs/getting-started.md)
- Intended product flow (requirements): [End-to-end flow](docs/flow.md)
- What the tree contains: [Architecture](docs/architecture.md)
- Published site: <https://pietruszka.github.io/factory/>

```sh
npm ci
npm run docs:dev
```

Open the URL printed by VitePress. The path is `/factory/`. When port 5173 is free, that URL is `http://localhost:5173/factory/`.
