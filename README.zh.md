# skyaxis

[English](README.md) | 中文

skyaxis 是 deepseek-harness（DSH）的 AI 编程可视化与单人工作流管理插件：把 session 内的进度、跨 session 的产出、需求维度的流程与产物，变成可被一眼看清、可被回溯、可被推进、可被裁决的对象。通过 `cordis.patch.yml` 与 dsh profile 机制挂载，对 DSH 宿主严格 observe-only。

当前功能面（dual-face 插件）：

- **Host 半**：自管 yaml 账本（`repos.yaml`、`requirements.yaml`、工作区绑定），原子写 + 乐观锁；HTTP 端点经 `connection.fetch.register` 注册。
- **浏览器半**：需求管理（清单 + 详情页三 seat：概览 / 工作区 / AI 工作台）、PRD 文档管理、仓库池、需求↔仓库关联。
- **AI 工作台**：六阶段导轨 seat（P1a 骨架；数据面——双账本、产物文件、两道硬门——门控于[决策 0005](docs/decisions/0005-AI工作台治理决策-产物独立文件存储与分级级联清理.md)）。

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
dsh plugin --profile web add link:$(pwd)/skyaxis
```

## 构建与测试

需要 Node 20 或更高版本及官方 NPM SDK 包；不使用 DSH 源码 checkout。

```sh
pnpm --filter @lz/skyaxis typecheck
pnpm --filter @lz/skyaxis test
pnpm --filter @lz/skyaxis build
```

回归基线为 774 tests（vitest）。
