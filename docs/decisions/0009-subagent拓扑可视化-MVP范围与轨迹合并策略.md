# ADR 0009：subagent 拓扑可视化 — MVP 范围与轨迹合并策略

| 字段 | 值 |
| --- | --- |
| **状态** | 接受（带 8 条假设清单待 v0.1 实施期验证） |
| **日期** | 2026-09-19 |
| **记录人** | Claude（基于用户决策 + 第二阶段只读调研结论） |

---

## 背景

立项阶段后期，用户提出新的可视化需求：

> 每个 ai session 有时会开一个或多个子agent，我也想能可视化子agent运行情况，包括主agent子agent们的拓扑关系图，子agent的任务目标，执行步骤，当前执行状态，以及支持进入查看实时执行内容。

按 [ADR 0003](0003-MVP场景清单.md)，MVP 已锁定 6 个核心场景（A / B / C / D / D1 / D2）。subagent 拓扑可视化**不是新独立场景**，而是场景 A（单 session 内进度可视化）+ D1（session 内 task DAG）+ D2（session 间依赖）的**纵深补强**——subagent 是 session 的特殊形态（独立 session + 元数据回指），其可视化天然嵌入 D1 / D2 的视图骨架。

DSH 调研发现（v0.1.5-rc.2 / commit `fb2c4b9e698e30edb738bca4cf0618587db7d203`）：

- DSH **原生深度支持** subagent：[`packages/subagent/`](../../deepseek-harness/packages/subagent/) 整个 package group、56+ session 事件中的 `subagent/catalog`、`subagent/descriptor`、`subagent/start`、`subagent/end` 等
- sub-agent = 独立 Session + SessionHeader 元数据回指（`parentSession / origin / delegationDepth`），**不是嵌套 trajectory**
- DSH **没有父子 session 事件流合并的现成投影**（session-projection 是单 session fold）
- DSH 自带的 subagent UI 参考（[`packages/client/ui-subagent/`](../../deepseek-harness/packages/client/ui-subagent/)）只嵌在 conversation header 的 dropdown，**不能满足"全局拓扑画布"需求**
- `list_agents` tool-adapter（[`packages/subagent/tool-subagent-control/src/list-agents.ts`](../../deepseek-harness/packages/subagent/tool-subagent-control/src/list-agents.ts)）的状态精炼（6 行代码）是 skyaxis 状态机最小可借鉴实现

**硬性约束**：[CLAUDE.md 工程硬性约束](../../CLAUDE.md) 明确"禁止修改 deepseek-harness 源码；`deepseek-harness/` 目录仅供只读访问"。skyaxis 是 DSH 的独立插件，所有实现都在 skyaxis 自己的仓内。

**调研方法学**：本 ADR 决策基于"**只读读 DSH 源码**"的两次调研结论（CLAUDE.md 第 4.3 节允许范围）。DSH demo 验证待 v0.1 实施期进行。

---

## 决策

### 9.1 subagent 拓扑可视化在 MVP 内的定位

**subagent 拓扑可视化是场景 A / D1 / D2 的"纵深补强"，不是新独立场景。**

具体含义：

- **场景 A 的补强**：v0.1 交付"单 session 进度可视化"时，**当该 session 是 subagent root 时**，自动展开该 session 的 subagent 树，作为"该 session 内进度可视化"的"特殊形态"展示。
- **场景 D1 的补强**：v0.2 交付"session 内 task DAG"时，subagent tree 与 task DAG 是**同一 session 内的两种视图**——前者关注"子 session 关系"，后者关注"task 步骤依赖"。
- **场景 D2 的补强**：v0.2 交付"session 间依赖"时，subagent 父子关系是 SessionDependency 的**最常见实例**——可视化为"实线"；用户手动声明的 session 间契约为"虚线"（区分）。

### 9.2 MVP 应该包括的 8 项

1. **拓扑视图**：root × N 的并列展示，每个 root 一棵树（参考 [`packages/client/ui-subagent/src/client/subagent-lineage.ts:24-45`](../../deepseek-harness/packages/client/ui-subagent/src/client/subagent-lineage.ts) 的 `indexSubagentDescendants` 纯函数）。
2. **节点状态机**：`running | settled`（合并 DSH 的 `idle + ready`），使用 `SessionSummary.running` 作为主信号。
3. **节点 metadata**：`mode (one-shot / continuable)`、`label`、`hasChildren`、`activity`、活跃 duration（投影 `subagentTiming`）。
4. **Catalog refresh + retry**：照搬 DSH 的 `'loading' | 'ready' | 'error'` 三态 + `setSubagentCatalogOpen` 防抖。
5. **Read-only session event 时间线**：基于 trajectory merger 的"按 `.time` 合并"的只读视图（**不写回** DSH）。
6. **独立 panel 架构**：MVP 选独立 panel（独立 store、独立 navigation），**不嵌入** conversation header（避免和 DSH ui-subagent 抢 slot）。
7. **观察范围限定**：仅 native subagent（`origin: 'subagent'` 且 `parentSession` 已记录）；**不覆盖** ACP / Codex / Claude Code 远端子节点。
8. **集成形态**：MVP 优先**形态 B**（外部 patch overlay，独立仓发 `@skyaxis/plugin`），**形态 A**（DSH 主仓 PR）作为长期目标。

### 9.3 MVP 明确不包括的 6 项

1. **send_message / prompt / interrupt** 等任何控制面写操作（observe-only）。
2. **agent-team**（DSH 标记为 experimental，未稳定，不在 MVP 范围）。
3. **轨迹写回 DSH**——merger 只在自己 store 内存活，不持久化到 DSH 的 session log。
4. **跨刷新持久化**——MVP 纯内存，刷新即丢，二期再做 checkpoint。
5. **历史拓扑回放**——MVP 只看当前存活 session；想看 3 天前的拓扑必须自己加持久化层。
6. **替换或镜像 conversation header 的 lineage UI**（DSH 的 ui-subagent 已做，skyaxis 不抢这个槽位）。

### 9.4 trajectory merger 的最小可行设计（架构性，非代码）

**输入**：

- rootSessionId（用户选定 / 默认当前 selected）
- `listDescendants(rootId)` → `Array<{ sessionId, parentId, depth, mode, label, hasChildren }>`

**输出**（纯内存 React state，不持久化）：

- `MergedTrajectoryView = { events: MergedEvent[], windowStart, windowEnd }`
- `MergedEvent = SessionEvent & { _origin: { sessionId, parentId, depth, label } }`

**核心步骤**：

1. 拉 root 的 descendants（DFS with visited guard，参考 [`packages/subagent/subagent/src/list-children.ts:264-280`](../../deepseek-harness/packages/subagent/subagent/src/list-children.ts)）。
2. 对每个 descendant：
   - live：读 `Session.snapshotEvents()`
   - cold：读 `SessionQueryEngine.observeSession(id).events`
   - 标注 `_origin = { sessionId, parentId, depth, label }`
3. 拍扁所有事件，按 `.time` 升序排序（[`packages/session/session-format/src/types.ts:32`](../../deepseek-harness/packages/session/session-format/src/types.ts) 事件时间戳），同 `.time` 用 `.seq` 二次排序。
4. 按 turn 边界分组（`turn/start` / `turn/end` 配对）。

**MVP 复杂度边界**：

- 单 root session，最多 N=64 个 descendants。
- 不做增量更新，每次 refresh 全量重建。
- 不做虚拟滚动（事件 > 10k 提示用户收敛 root）。

### 9.5 DSH demo 待 v0.1 实施期验证的 8 条假设清单

> ⚠️ **以下假设均未通过 DSH 实际运行验证**。v0.1 实施期必须逐条验证；任意 **3 条以上不成立**应回退到"skyaxis MVP 不做 subagent 拓扑可视化"。

| # | 假设 | 验证方法 | 失败后果 |
| --- | --- | --- | --- |
| 1 | `dsh --profile web --patch <外部-overlay.yml>` 能加载非 monorepo 内的 cordis plugin，且 `verify-cordis-config` 不拒绝 overlay 中的 `@skyaxis/*` 包名 | v0.1 demo 第一天必验证 | skyaxis 无法作为独立包加载，需 DSH 主仓 PR |
| 2 | `@deepseek-ai/dsh-api-session-controller/client` 暴露的 `remotes.subagents.list(parentId)` 可以被 skyaxis 直接调用 | 写最小插件跑通 | 需额外 host row 注册 |
| 3 | `subagentTiming` projection 字段在 `useProjection` 链路上的 latency 足够低（每节点 1s tick 时不卡顿） | 实测响应时间 | 改用 `SessionSummary.running` 二值信号 |
| 4 | `SessionQueryEngine.observeSession(id)` 在 web-app patch 启动后默认可用，不需要额外 provider 注册 | v0.1 demo 验证 | skyaxis 需声明 `inject: ['sessionQuery']` |
| 5 | `turn/start` / `turn/end` / `subagent/descriptor` 事件的 `.time` 字段足够做跨 session 排序（不出现未来时间戳、不会回拨） | v0.1 demo 必验证 | merger 排序失败，事件顺序错乱 |
| 6 | cold observation 返回的 `events` 数组包含该 session 的所有事件，包括 `subagent/descriptor` | v0.1 demo 必验证 | merger 在 cold node 上丢身份信息 |
| 7 | `ctx.agents.get(id)` 在用户**未选中**该 session 时也能返回（DSH 是否只 retain selected session 的 Agent） | v0.1 demo 必验证 | `running` 状态精度下降 |
| 8 | SubagentCatalog `hasChildren` 在 catalog snapshot 阶段已预计算 | 已读代码确认（[`packages/subagent/subagent/src/list-children.ts:81-92`](../../deepseek-harness/packages/subagent/subagent/src/list-children.ts)） | skyaxis 需自做 DFS |

### 9.6 集成形态候选（决策：MVP 优先 B，长期目标 A）

DSH 是全插件架构（`AGENTS.md` 开头："all-plugin Cordis agent harness"）。skyaxis 作为 DSH 独立插件有三种集成形态：

| 形态 | 描述 | MVP 选择 | 长期目标 |
| --- | --- | --- | --- |
| **A** | DSH 主仓 PR：skyaxis 包以 `@deepseek-ai/dsh-skyaxis` 入 `packages/experimental/` | ⏳ 长期目标 | ✅ |
| **B** | 外部 patch overlay：skyaxis 在独立仓，发 `@skyaxis/plugin`，用户用 `dsh --profile web --patch skyaxis.overlay.yml` 加载 | ✅ **MVP 优先** | — |
| **C** | 纯 UI 客户端：通过 `window.__DSH_BOOT__` 拿 host 注入的服务引用 | ⏳ fallback | — |

**MVP 选 B 的原因**：独立仓 / 独立 npm 包 / 用户写最小 overlay.yml 加载，**不依赖** DSH 维护者接受 PR。**前提**：假设 1 必须验证通过。

### 9.7 observe-only 验证标准（v0.1 实施期加 lint 脚本）

- 禁止调用 `ctx.subagents.continuationBinding` / `registerProvider` / `interrupt` / `fork`。
- 禁止注册到 `ctx.tools` 的 tool（除非带 `disabled: true`）。
- 禁止对 `SubagentService` 上写方法的引用。
- 推荐加 `verify-skyaxis-readonly` 的 lint 脚本扫描上述调用。

---

## 后果

### 正面

1. **MVP 场景范围不增加新独立场景**：subagent 拓扑可视化作为 A / D1 / D2 的纵深补强，避免"宽范围 MVP 风险"进一步恶化（[ADR 0003](0003-MVP场景清单.md) / [ADR 0006](0006-业务对象清单.md) 已标注）。
2. **复用 DSH 自带的 4 个模式**：`indexSubagentDescendants` 纯函数 / catalog 三态 / 1s tick / `hasChildren` 预计算——减少 skyaxis 自研工作量。
3. **observe-only 集成**：6 个只读服务（`subagents / sessions / sessionQuery / sessionProjections / sessionProjectionCache / agents`）即可覆盖 MVP 全部需求，不侵入 DSH 写路径。
4. **集成形态 B（外部 overlay）** 不依赖 DSH 维护者，skyaxis 可以独立演进。

### 负面 / 风险

1. **8 条假设中任一不成立都会影响 MVP 子能力**（详见 9.5 假设清单）。
   - **缓解**：任意 3 条以上不成立 → 回退到"skyaxis MVP 不做 subagent 拓扑可视化"。
2. **轨迹 merger 是 skyaxis 自研，复杂度高**。
   - **缓解**：MVP 复杂度边界明确（单 root、N ≤ 64、不做增量）；merger 算法参照 [`packages/subagent/subagent/src/list-children.ts:264-280`](../../deepseek-harness/packages/subagent/subagent/src/list-children.ts) 的 pre-order DFS + [`packages/session/session-format/src/types.ts:32`](../../deepseek-harness/packages/session/session-format/src/types.ts) 的事件时间戳。
3. **集成形态 B 的 `verify-cordis-config` 行为未知**（假设 1）。
   - **缓解**：v0.1 demo 第一天必验证；不通过则降级到形态 C（纯 UI 客户端）。
4. **DSH demo 未实际跑通**：本 ADR 决策全部基于源码只读调研。
   - **缓解**：在 ADR 状态字段明确标注"带 8 条假设清单待 v0.1 实施期验证"；v0.1 demo 跑通后转正式"接受"。
5. **独立 panel vs slot 嵌入的决策** 可能与 DSH ui-subagent 形成视觉割裂。
   - **缓解**：v0.1 实施期先做独立 panel 验证需求；二期评估是否走 slot 嵌入。

---

## 备选项（已考虑，未选）

| 备选方案 | 未选原因 |
| --- | --- |
| **把 subagent 拓扑可视化作独立场景 E** | 违反 [ADR 0003](0003-MVP场景清单.md) 的 6 场景锁定；增加"宽范围 MVP 风险" |
| **走 slot 嵌入（与 DSH ui-subagent 抢槽位）** | DSH ui-subagent 已做 dropdown；skyaxis 要的是"全局拓扑画布"，slot 嵌入满足不了多 root 并列 |
| **trajectory merger 写在 DSH 仓内**（PR 形式） | 违反 CLAUDE.md 工程硬性约束（禁止修改 deepseek-harness 源码） |
| **持久化 merged view（checkpoint 写入 DSH session log）** | MVP 复杂度爆炸；二期再做；且违反 observe-only |
| **支持 ACP / Codex / Claude Code 远端子节点** | DSH README 明确"ACP children remain one-shot and are not trace-enumerable"；MVP 不覆盖 |
| **支持 agent-team** | DSH 标记 experimental，未稳定；MVP 不覆盖 |
| **集成形态 C（纯 UI 客户端，不进 Cordis）** | 失去和 host 的 effect 生命周期绑定（HMR / dispose / cold start 时序）；仅作 fallback |

---

## 后续动作

1. **本回合同步更新**：
   - [CLAUDE.md](../../CLAUDE.md) 决策索引 + 变更日志。
   - [`docs/research/0009-dsh-subagent-reference.md`](../research/0009-dsh-subagent-reference.md) — 第二阶段调研报告存档。
2. **下一回合同步更新**（按 CLAUDE.md "小步前进" 拆分到下一回合）：
   - [`docs/vision/positioning.md`](../vision/positioning.md) — 添加"subagent 拓扑可视化作为场景 A / D1 / D2 纵深补强"段落。
   - [`docs/milestones/roadmap.md`](../milestones/roadmap.md) — v0.1 / v0.2 通过条件加一条"subagent 拓扑可视化对应能力可用"。
   - [`docs/domain/entities.md`](../domain/entities.md) — Session 对象补一句"当 Session 是 subagent root 时，其视图骨架同时承载 subagent tree"。
3. **v0.1 实施期验证 8 条假设清单**：进入 v0.1 demo 后逐条验证；3 条以上不成立回退。
4. **新开 ADR 时机**：本 ADR 状态在 v0.1 demo 跑通 + 8 条假设验证后，转为正式"接受"（无需新开 ADR）；若回退（3 条以上假设不成立），新开 ADR 0010 锁定"skyaxis MVP 不做 subagent 拓扑可视化"。

---

## 相关 ADR

- [ADR 0001 — 形态：DSH 独立插件](0001-形态-dsh插件.md)
- [ADR 0002 — 定位：可视化向](0002-定位-可视化向.md)
- [ADR 0003 — MVP 场景清单](0003-MVP场景清单.md)
- [ADR 0004 — 目标用户画像](0004-目标用户画像.md)
- [ADR 0005 — MVP 边界与 Non-Goals](0005-MVP边界与Non-Goals.md)
- [ADR 0006 — 业务对象清单](0006-业务对象清单.md)
- [ADR 0007 — 长期规划与里程碑](0007-长期规划与里程碑.md)
- [ADR 0008 — 每阶段验收标准](0008-每阶段验收标准.md)

## 相关调研

- **第一阶段调研**（Explore agent，已完成）：DSH subagent 服务定义、API、事件 schema、父子 session 关系。
- **第二阶段调研**（general-purpose agent，已完成）：[`docs/research/0009-dsh-subagent-reference.md`](../research/0009-dsh-subagent-reference.md)——
  - DSH 自带 UI 参考（`packages/client/ui-subagent/`）
  - `list_agents` 状态计算模式
  - trajectory merger 最小可行设计
  - 集成形态 3 选 1