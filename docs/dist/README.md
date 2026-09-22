# 任务 DAG 可视化插件 · 设计文档与代码快照（脱敏分发版）

这是一套可独立分发、与任何具体仓库无关的技术资料，主题是一个宿主平台（下文统称 **Host**）插件的完整设计与实现拆解。插件代号 **task-dag-viewer**：不维护第二份编排数据，把宿主平台已有的会话投影重组成一张可视 DAG（子代理血缘、Agent Teams 任务与通信、Workflow 运行拓扑）。

## 目录结构

| 路径 | 内容 |
| --- | --- |
| `01-implementation-philosophy.md` | 整体设计哲学、项目目标、分层架构、技术选型 |
| `02-data-sources.md` | 每个数据源的类型、用途与获取方式 |
| `03-data-processing.md` | 源数据 → 图数据 → 渲染 DAG 的完整流水线 |
| `04-layout-algorithm.md` | 确定性分层布局算法 |
| `05-cycle-fallback.md` | 依赖环的残量分量 fallback |
| `06-metrics-honesty.md` | 累计指标 vs 当次请求的诚实表达 |
| `07-replication-steps.md` | 复刻实施步骤（含可直接使用的分步 prompt） |
| `src/`、`scripts/`、`lib/invariant.js`、`package.json`、`cordis.patch.yml` | 文档中引用到的代码快照 |

文档中的 `src/...`、`scripts/...` 等路径与行号引用和本目录内的快照一一对应（快照仅做同行字符串替换，不改变行号）。快照未包含宿主平台依赖，仅供对照阅读，不能直接安装运行。

## 阅读顺序

建议按 01 → 02 → 03 → 04 → 05 → 06 → 07 顺序阅读；07 是落地手册，其分步 prompt 可直接交给 LLM 生成代码。

## 脱敏说明

本资料已做如下泛化处理，不与任何具体产品或仓库对应：

| 类别 | 处理方式 |
| --- | --- |
| 宿主平台名称 | 统一写作「宿主平台 / Host」 |
| 宿主侧包名 | 泛化为 `@host/*` |
| 插件名 / CSS 前缀 / 配置键 | 泛化为 `task-dag-viewer` / `task-dag-viewer-*` / `host.*` |
| 宿主设计令牌 | 泛化为 `--host-*` |
| 示例 provider / model | 涉及真实厂商的样例替换为虚构名称（如 `acme`） |

文中保留的公开外部引用（如 OpenAI 模型文档页）仅作为「公开默认值参考」这一设计议题的示例，与来源项目无关。
