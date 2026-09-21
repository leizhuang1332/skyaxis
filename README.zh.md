# skyaxis

[English](README.md) | 中文

skyaxis 包当前以骨架形式发布：通过 `cordis.patch.yml` 与 dsh profile 机制挂载，仅暴露 host 与浏览器的 loader 入口，不注册任何业务行为。包名与 npm 身份已保留，后续迭代可在不重新注册插件的前提下把实现补回同一行。

- 在 dsh web profile 中以 `skyaxis` 挂载（见 `cordis.patch.yml`）。
- Host 入口：`src/index.ts` 导出 `apply`（空操作）与空的 `inject` 列表。
- 浏览器入口：`src/client/index.ts` 导出 `apply`（空操作）与空的 `inject` 列表。
- 不挂载任何 HTTP 路由、账本、调度器或界面。

## 安装

安装聚合包或单独安装本包，然后重启 `dsh web`：

```sh
dsh plugin --profile web add @lz/skyaxis@latest
```

本地开发安装：

```sh
git clone https://github.com/lz/skyaxis.git
cd skyaxis
pnpm install
pnpm build
dsh plugin --profile web add link:$(pwd)/packages/skyaxis
```

## 构建与测试

需要 Node 20 或更高版本及官方 NPM SDK 包；不使用 DSH 源码 checkout。

```sh
pnpm --filter @lz/skyaxis typecheck
pnpm --filter @lz/skyaxis test
pnpm --filter @lz/skyaxis build
```

骨架构建下 `pnpm test` 面对空的 `tests/` 目录直接退出通过。
