# factory

Public repository. It now contains early factory source code and documentation. The initial commit added this file with only a heading.

Documentation for the repository and for the docs site itself is in [`docs/`](docs/index.md).

- Install and local preview: [Getting started](docs/getting-started.md)
- Intended product flow (requirements; the CLI is not in this repo): [End-to-end flow](docs/flow.md)
- What the tree contains: [Architecture](docs/architecture.md)
- Published site: <https://pietruszka.github.io/factory/>

```sh
npm ci
npm run docs:dev
```

Open the URL printed by VitePress. The path is `/factory/`. When port 5173 is free, that URL is `http://localhost:5173/factory/`.
