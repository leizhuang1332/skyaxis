# skyaxis

English | [中文](README.zh.md)

The skyaxis package is shipped as a skeleton build: it mounts through `cordis.patch.yml` and the DSH profile mechanism, exposes the host and browser loader entries, and registers no business behaviour. The package name and npm identity are reserved so future iterations can drop the implementation back into the same row without re-registering the plugin.

- Mounts as `skyaxis` in the dsh web profile (see `cordis.patch.yml`).
- Host entry: `src/index.ts` exports `apply` (no-op) and an empty `inject` list.
- Browser entry: `src/client/index.ts` exports `apply` (no-op) and an empty `inject` list.
- No HTTP routes, no ledger, no scheduler, no UI surfaces.

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

`pnpm test` runs against an empty `tests/` directory in the skeleton build and exits clean.
