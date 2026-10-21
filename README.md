# skyaxis

English | [中文](README.zh.md)

skyaxis is a deepseek-harness (DSH) plugin for AI coding visualization and single-person workflow management: it turns in-session progress, cross-session output, and requirement-level workflow and artifacts into objects that can be seen at a glance, traced back, pushed forward, and ruled on. It mounts through `cordis.patch.yml` and the DSH profile mechanism and stays strictly observe-only towards the DSH host.

Current surfaces (dual-face plugin):

- **Host face**: self-managed yaml ledgers (`repos.yaml`, `requirements.yaml`, workspace bindings) with atomic writes and optimistic locking, plus HTTP endpoints registered via `connection.fetch.register`.
- **Browser face**: requirement management (list + detail page with overview / workspace / AI workbench seats), PRD document management, repo pool, and requirement↔repo linking.
- **AI workbench**: six-stage rail seat (P1a skeleton; the data plane — dual ledgers, artifact files, hard gates — is gated on [decision 0005](docs/decisions/0005-AI工作台治理决策-产物独立文件存储与分级级联清理.md)).

## Install

Install the aggregate package or this package alone, then restart `dsh web`:

```sh
dsh plugin --profile web add @lz/skyaxis@latest
```

For local development:

```sh
git clone https://github.com/lz/skyaxis.git
cd skyaxis
pnpm install
pnpm build
dsh plugin --profile web add link:$(pwd)/packages/skyaxis
```

## Build and test

Node 20 or newer and the official NPM SDK packages are required; no DSH source checkout is used.

```sh
pnpm --filter @lz/skyaxis typecheck
pnpm --filter @lz/skyaxis test
pnpm --filter @lz/skyaxis build
```

The regression baseline is 1191 tests (vitest).
