# skyaxis — 术语与概念（权威出处）

> 本文档定义 skyaxis 项目的所有专有名词。每个术语给出**名称 + 一句话定义 + 所属层级 + 关联 ADR / 调研索引**。
> **不细化字段、不定类型、不设计存储**（遵循 CLAUDE.md 第 2.1 节边界）。

**层级说明**：

- **skyaxis**：skyaxis 项目独有的术语（DSH 中无对应概念）。
- **DSH**：DSH 自带术语（skyaxis 直接复用，不重定义）。
- **共享**：DSH 与 skyaxis 都有意义、但 skyaxis 视角下被重新定义或重新组织。

---

## 1. 通用术语

| 术语 | 一句话定义 | 层级 |
| --- | --- | --- |
| **skyaxis** | AI 编程可视化插件项目名，DSH 生态的独立插件（[ADR 0001](decisions/0001-形态-dsh插件.md)） | skyaxis |
| **DSH（DeepSeek Harness）** | skyaxis 的宿主，DeepSeek AI 开源的 AI agent harness；当前锁定版本 **dsh-v0.1.5-rc.2**（commit `fb2c4b9e698e30edb738bca4cf0618587db7d203`） | DSH |
| **Cordis** | DSH 使用的微内核框架，function plugin 模型 | DSH |
| **Plugin（插件）** | DSH 的扩展单元，host 半（Node）+ client 半（浏览器） | DSH |
| **Web Profile** | DSH 的 web 端 profile（`packages/bundle/web-app/`） | DSH |
| **Patch Overlay** | DSH 的 cordis 补丁叠加文件（`cordis.yml` + `cordis.patch.yml`） | DSH |
| **Inject** | cordis 服务注入声明，function plugin 通过 `inject` 数组声明依赖；缺服务会**拓扑敏感**地抛错 | DSH |
| **Slot Injection** | cordis 的 UI 插槽机制，插件可向 conversation header 等位置注入 UI 组件 | DSH |
| **Apply** | cordis 插件入口函数，`export function apply(ctx) { ... }`（默认导出禁止用，见 DSH postmortem 0001） | DSH |
| **Window DSH Boot** | DSH Loader 启动后注入到浏览器 `window.__DSH_BOOT__` 的 host 服务引用 | DSH |

## 2. Session 模型

| 术语 | 一句话定义 | 层级 |
| --- | --- | --- |
| **Session** | AI 会话本体，由 DSH 提供；skyaxis 在其上加自己的视图与元数据 | 共享 |
| **Session ID** | Session 唯一标识 | DSH |
| **Session Header** | Session 元数据字段集合（id / parentSession / isSeeded / origin / delegationDepth / agentPreset） | DSH |
| **Parent Session** | subagent 的父 Session，由 `SessionHeader.parentSession` 字段回指 | DSH |
| **Delegation Depth** | subagent 嵌套深度（root=0，子=1，孙=2，...） | DSH |
| **Origin** | Session 来源（`main` / `subagent` 等） | DSH |
| **Agent Preset** | Session 的 agent 配置预设 | DSH |
| **Is Seeded** | Session 是否是"种子"（从已存档 checkpoint 恢复） | 共享 |

## 3. Trajectory 模型

| 术语 | 一句话定义 | 层级 |
| --- | --- | --- |
| **Trajectory** | Session 的事件流，由 `SessionEvent[]` 组成（**非单个对象**） | DSH |
| **Session Event** | 单个事件，含 type / time / seq / payload 等字段；DSH 定义 56+ 种 | DSH |
| **Event Type** | 事件类型枚举（`turn/start`、`step/start`、`tool/call`、`subagent/*` 等） | DSH |
| **Turn** | Session 内一个完整回合（`turn/start` ↔ `turn/end` 配对） | DSH |
| **Step** | Turn 内一个执行步骤 | DSH |
| **Tool Call** | 一次工具调用事件（`tool/call`） | DSH |
| **Subagent Catalog Event** | parent 视角事件：`subagent/catalog`，含子 session 列表快照 | DSH |
| **Subagent Descriptor Event** | child 视角事件：`subagent/descriptor`，含自我描述 | DSH |
| **Subagent Lifecycle Event** | 生命周期事件：`subagent/start`、`subagent/end`（observe-only） | DSH |

## 4. Skyaxis 抽象对象（核心业务对象）

> 6 个核心对象详见 [entities.md](entities.md)。本节给出简短术语索引。

| 术语 | 一句话定义 | 层级 |
| --- | --- | --- |
| **Task** | skyaxis 从 trajectory 抽取的任务步骤（**非 DSH 原生**） | skyaxis |
| **Task DAG** | session 内的 task 依赖图（[ADR 0003](decisions/0003-MVP场景清单.md) 场景 D1） | skyaxis |
| **Task Dependency** | task DAG 的边（[ADR 0006](decisions/0006-业务对象清单.md)） | skyaxis |
| **Session Dependency** | session 间输入 / 输出契约（[ADR 0006](decisions/0006-业务对象清单.md)） | skyaxis |
| **Decision** | session 内被标记的关键决策（[ADR 0006](decisions/0006-业务对象清单.md)） | skyaxis |
| **Snippet** | session 内被标记的代码片段（[ADR 0006](decisions/0006-业务对象清单.md)） | skyaxis |

## 5. Sub-agent 模型

| 术语 | 一句话定义 | 层级 |
| --- | --- | --- |
| **Sub-agent（Subagent）** | 由主 Session 派生出的独立子 Session，通过 SessionHeader 元数据回指，**不是嵌套 trajectory** | DSH |
| **Native Subagent** | skyaxis 可追踪的 subagent（`origin: 'subagent'` 且 `parentSession` 已记录） | 共享 |
| **ACP Subagent** | ACP / Codex / Claude Code 远端子节点；DSH README 明确"one-shot 不可追踪"，skyaxis **不覆盖** | DSH |
| **Agent Teams** | DSH 实验性功能，未稳定，不在 skyaxis MVP 范围 | DSH |
| **One-shot Subagent** | 单次性 subagent（运行一次即结束，模型不能再 send_message） | DSH |
| **Continuable Subagent** | 可继续对话的 subagent | DSH |
| **Agent Status** | DSH 中 Agent 的运行时状态（`running` / `idle` / `ready`） | DSH |
| **Subagent Catalog** | parent 视角的 subagent 列表快照（state.subagentsByParent） | DSH |
| **Subagent Descriptor** | child 视角的 subagent 自我描述 | DSH |

## 6. Topology / Trajectory Merger

| 术语 | 一句话定义 | 层级 |
| --- | --- | --- |
| **Topology** | 主 + 子 agent 拓扑关系图 | skyaxis |
| **Descendant** | 后代 session（含多层）；`ctx.subagents.listDescendants(rootId)` 返回 | DSH |
| **Ancestor** | 祖先 session（含多层） | DSH |
| **Has Children** | 节点是否有 subagent 子节点（DSH catalog 阶段预计算） | DSH |
| **Pre-order DFS** | pre-order 深度优先遍历算法；DSH `list-children.ts:264-280` 用作参照 | 共享 |
| **Subagent Topology View** | skyaxis 自研的多 root 并列拓扑画布（[ADR 0009](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)） | skyaxis |
| **Trajectory Merger** | skyaxis 自研的"按 `.time` 合并多 session 事件流"客户端合并器 | skyaxis |
| **Merged Trajectory View** | 合并后的视图（`events` + `windowStart` + `windowEnd`） | skyaxis |
| **Merged Event** | 合并后的事件，附加 `_origin = { sessionId, parentId, depth, label }` 标记 | skyaxis |

## 7. DSH Projection

| 术语 | 一句话定义 | 层级 |
| --- | --- | --- |
| **Projection** | DSH 把 Session 事件流折叠成状态视图的机制（**单 session fold**） | DSH |
| **Projection Definition** | projection 的注册接口 `apply(state, event)`；**不接受跨 session 输入** | DSH |
| **Subagent Timing Projection** | 折叠 subagent 活跃 / 已结束时长（`{ settledMs, active?: { since, through } }`） | DSH |
| **Subagent Identity Projection** | 折叠 subagent 身份信息（mode / label / seq） | DSH |
| **Token Usage Projection** | 折叠 token 用量 | DSH |
| **Session Projection Map** | Session 的所有 projection values 集合 | DSH |
| **Session Projection Cache** | projection 的持久化 checkpoint（memory / checkpoint / file） | DSH |
| **Session Query Engine** | DSH 的 session 查询接口（`observeSession` / `listSessions`） | DSH |

## 8. Skyaxis 集成形态

| 术语 | 一句话定义 | 层级 |
| --- | --- | --- |
| **形态 A** | DSH 主仓 PR：skyaxis 包以 `@deepseek-ai/dsh-skyaxis` 入 DSH 仓；长期目标 | skyaxis |
| **形态 B** | 外部 patch overlay：skyaxis 在独立仓发包，用户用 `--patch skyaxis.overlay.yml` 加载；**MVP 优先** | skyaxis |
| **形态 C** | 纯 UI 客户端：通过 `window.__DSH_BOOT__` 拿 host 服务引用；fallback | skyaxis |
| **Observe-Only** | skyaxis 只读访问 DSH；禁止 `continuationBinding` / `registerProvider` / `interrupt` / `fork` 等写操作 | skyaxis |
| **Independent Panel** | skyaxis 的 UI 架构选择：独立 panel（独立 store + navigation），**MVP 选此**，**不嵌入** conversation header | skyaxis |
| **Verify-Skyaxis-Readonly** | v0.1 实施期建议加的 lint 脚本，扫描 observe-only 违规调用 | skyaxis |

## 9. Skyaxis 状态机

| 术语 | 一句话定义 | 层级 |
| --- | --- | --- |
| **Node Status（节点状态）** | skyaxis 拓扑视图的节点状态（**`running / settled`**），合并 DSH 的 `idle + ready` | skyaxis |
| **Catalog State** | subagent catalog 三态：`loading / ready / error` + 独立 `parentAvailable` 字段；复用 DSH 模式 | 共享 |
| **Activity Duration** | 节点活跃时长，DSH 端已 fold 完成，skyaxis 端做最终展示运算（`settledMs + (now - active.since)`） | 共享 |

## 10. MVP / 验收 / 阶段

| 术语 | 一句话定义 | 层级 |
| --- | --- | --- |
| **MVP** | Minimum Viable Product，第一版交付 | skyaxis |
| **Non-Goals** | MVP 显式不做的清单（[ADR 0005](decisions/0005-MVP边界与Non-Goals.md)） | skyaxis |
| **In-Scope** | MVP 显式要做的清单（[ADR 0005](decisions/0005-MVP边界与Non-Goals.md)） | skyaxis |
| **MVP 场景** | 6 个：A（单 session 进度可视化）/ B（跨 session 产出聚合）/ C（多 session 总览）/ D（session 决策与代码片段归档）/ D1（session 内 task DAG）/ D2（session 间依赖） | skyaxis |
| **功能完整性** | MVP 4 验收维度之一：6 场景全部可用 | skyaxis |
| **可用性** | MVP 4 验收维度之一：5 分钟跑起来 | skyaxis |
| **文档完整性** | MVP 4 验收维度之一：ADR + README 4 章节 | skyaxis |
| **测试覆盖** | MVP 4 验收维度之一：每场景至少 1 个 E2E | skyaxis |
| **v0.1** | MVP 子阶段 1：核心可视化（Session + Task） | skyaxis |
| **v0.2** | MVP 子阶段 2：依赖关系（TaskDependency + SessionDependency） | skyaxis |
| **v0.3** | MVP 子阶段 3：归档检索（Decision + Snippet） | skyaxis |

## 11. 立项流程

| 术语 | 一句话定义 | 层级 |
| --- | --- | --- |
| **立项阶段** | skyaxis 当前阶段；定位 / 范围 / 用户 / 对象 / 里程碑 / 验收 7 项必填项 + 关键 ADR | skyaxis |
| **ADR** | Architecture Decision Record，立项决策的可追溯记录；存 `docs/decisions/` | skyaxis |
| **调研** | 立项阶段的产出物之一，存 `docs/research/` | skyaxis |
| **假设** | 立项阶段未验证的判断；文档中显式标注 `假设:` 或 `待验证:` | skyaxis |
| **风险** | 立项阶段识别的潜在问题；附缓解措施 | skyaxis |
| **阶段切换条件** | CLAUDE.md 第 4.4 节定义；立项 → 下一阶段需 7 项条件全满足 | skyaxis |
| **MVP 后迭代** | 阶段 3（占位）；MVP 完成时启动新 ADR 锁定具体内容 | skyaxis |

## 12. 用户画像

| 术语 | 一句话定义 | 层级 |
| --- | --- | --- |
| **核心画像 A** | AI 重度多 session 用户（[ADR 0004](decisions/0004-目标用户画像.md)） | skyaxis |
| **反例 1** | 团队协作用户（[ADR 0004](decisions/0004-目标用户画像.md)） | skyaxis |
| **反例 3** | 跨项目独立 session 用户（[ADR 0004](decisions/0004-目标用户画像.md)） | skyaxis |
| **边缘画像（学习者）** | 学习新技术的个人开发者，**不在核心、不排除** | skyaxis |

---

## skyaxis 一句话总结

> skyaxis 术语库覆盖 **12 个主题、约 80 个术语**，分三层级（**skyaxis 项目独有 / DSH 自带复用 / 共享**）。

---

## 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-19 | 初版。基于 ADR 0001-0009 + research/0009 调研报告整理，12 个主题、约 80 个术语。 |

---

## 相关 ADR / 调研

- [ADR 0001 — 形态：DSH 独立插件](decisions/0001-形态-dsh插件.md)
- [ADR 0002 — 定位：可视化向](decisions/0002-定位-可视化向.md)
- [ADR 0003 — MVP 场景清单](decisions/0003-MVP场景清单.md)
- [ADR 0004 — 目标用户画像](decisions/0004-目标用户画像.md)
- [ADR 0005 — MVP 边界与 Non-Goals](decisions/0005-MVP边界与Non-Goals.md)
- [ADR 0006 — 业务对象清单](decisions/0006-业务对象清单.md)
- [ADR 0007 — 长期规划与里程碑](decisions/0007-长期规划与里程碑.md)
- [ADR 0008 — 每阶段验收标准](decisions/0008-每阶段验收标准.md)
- [ADR 0009 — subagent 拓扑可视化：MVP 范围与轨迹合并策略](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)
- [调研报告 — DSH Sub-Agent 深度调研](research/0009-dsh-subagent-reference.md)