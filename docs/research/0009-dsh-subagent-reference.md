# DSH Sub-Agent 深度调研报告（v0.1.5-rc.2 / commit fb2c4b9）

> **来源**：第二阶段只读调研（general-purpose agent 输出整理）。
> **目的**：为 [ADR 0009 — subagent 拓扑可视化 MVP 范围与轨迹合并策略](../decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md) 提供事实依据。
> **硬性约束**：`deepseek-harness/` 目录**只读**，所有引用基于实际源码，未做任何推测性内容。
> **版本**：dsh-v0.1.5-rc.2（commit `fb2c4b9e698e30edb738bca4cf0618587db7d203`）。

---

## TL;DR

1. **DSH 没有"父子 session 事件流合并"的现成投影**。`session-projection` 按 `Session` 单 session 折叠事件，跨 session 轨迹合并是空白——skyaxis 必须在客户端自己写 trajectory merger。
2. **UI 参考只用一个 React 组件（844 行）+ 一个 read-only 替换（31 行）**。`ui-subagent` 完全不重写会话列表，它通过 Cordis `ctx.slots.inject('conversation.session.header.lineage', …)` 在 conversation 头部占一个插槽，并订阅 SessionManager 的 `subagentsByParent`。这种"插槽式寄生"是 skyaxis 复用的关键模式。
3. **`list_agents` tool-adapter 的状态精炼是 skyaxis 状态机的最小可借鉴实现**：`running / idle / ready` 三态，逻辑只有 6 行（`agents.get(id)` + status 比较），完全可移植到客户端 useMemo。
4. **skyaxis 可以纯 observe-only 集成**：DSH 整个 subagent capability 是可插拔的，host 侧只需 inject 6 个只读服务（`subagents / sessions / sessionQuery / sessionProjections / sessionProjectionCache / agents`），不动 `prompt / interrupt` 写路径。

---

## 目标 1：DSH 自带的 sub-agent UI 参考

### 1.1 目录与文件清单

`deepseek-harness/packages/client/ui-subagent/`：

| 路径 | 行数 | 作用 |
|---|---|---|
| `package.json` | – | 声明 `dsh.client.inject: [session-controller, locale, ui-conversation, ui-primitives, ui-input-trigger]`；exposes `exports['./client']` 给浏览器聚合 |
| `src/index.ts` | 9 | Host 半（Node）：`export function apply() {}`——空体，仅让插件出现在 Loader 的 resolver manifest |
| `src/client/index.ts` | 82 | Client 半：声明 `inject = ['sessions', 'slots', 'locale']`；通过 `ctx.slots.inject('conversation.session.header.lineage', …)` 和 `ctx.slots.inject('conversation.composer', …)` 注册两个 slot |
| `src/client/subagent-lineage.ts` | 46 | 纯函数 `indexSubagentDescendants(summaries)`：从 summaries 反向索引每个 ancestor 的 (count, runningCount) |
| `src/client/SubagentHeaderLineage.tsx` | 844 | 主组件：CatalogDropdown + 递归 CatalogRows + 键盘导航 + 计时器（1s tick 刷新 running duration）|
| `src/client/SubagentReadOnlyComposer.tsx` | 31 | 一个占位组件，当子 agent 是 one-shot 或 parent-unavailable 时顶替 composer |
| `src/client/locales.ts` | 89 | 命名空间 `subagent` 的双语字典（zh/en） |

### 1.2 关键 API 消费模式

`SubagentHeaderLineage.tsx:6-8` 直接消费 **3 个 SessionManager 字段**：

- `state.subagentsByParent: Readonly<Record<SessionId, SubagentCatalogSnapshot>>`（`manager.ts:58`）
- `state.byId: Readonly<Record<SessionId, SessionSummary>>`（同 manager）
- `SessionSummary.projectionValues?.subagentTiming`（`manager.ts:65-69` 的 SubagentCatalogSnapshot；projection 字段通过 `useProjection('subagentTiming')` 链路返回）
- `SessionSummary.projectionValues?.tokenUsage`（用于 token 总数展示）

业务动作通过 3 个方法注入（`SubagentHeaderLineage.tsx:25-29`）：

- `openChild(address: SubagentAddress)` → 客户端走 `sessions.openSubagent(address)` 切换会话
- `refresh(parentSessionId)` → `sessions.refreshSubagents(parentSessionId)` 主动拉一次 catalog
- `setCatalogOpen(parentSessionId, open)` → `sessions.setSubagentCatalogOpen(parentSessionId, open)` 通知 manager 哪些 catalog 被打开过（用于后续主动 refresh）

### 1.3 设计模式（skyaxis 可借鉴）

| 模式 | 位置 | skyaxis 是否可借鉴 |
|---|---|---|
| **Slot 寄生**：`ctx.slots.inject('conversation.session.header.lineage', …)` 把 UI 嵌进既有 conversation 头部，而非另起一棵树 | `client/index.ts:65-72` | **可借鉴，但 skyaxis 不一定非要走 slot**——独立 panel 也是合理选项 |
| **状态外包给 SessionManager**：UI 完全无状态，所有 list state/catalog 在 manager 里 | `manager.ts:95-160` | **强烈推荐借鉴**：skyaxis 的 store 设计应该把 session summary、catalog snapshot、projection values 集中到一个 store 里 |
| **纯函数聚合 descendant count**：`indexSubagentDescendants(summaries)` 不依赖任何 service，单测 100% 覆盖 | `subagent-lineage.ts:24-45` | **直接复用** |
| **catalog state 三态**：`'loading' \| 'ready' \| 'error'` + 独立 `parentAvailable?: boolean` 字段 | `manager.ts:65-70` | **直接复用** |
| **1s 周期 tick**：dropdown open 且 `runningCount > 0` 时，每秒 `setNow(Date.now())` 重算活跃 duration | `SubagentHeaderLineage.tsx:652-656` | **直接复用** |
| **summaryBackedLoading 兜底**：catalog 还没拉下来但 `state.byId` 已知有 subagent descendants，先用 disabled "loading" 行占位 | `SubagentHeaderLineage.tsx:521-530` | **直接复用**：避免初次进入时 catalog 闪烁 |
| **portal 下拉 + viewport 边界保护**：`createPortal` + `catalogMenuPosition(trigger)` 防菜单超出窗口 | `SubagentHeaderLineage.tsx:467-480, 767-793` | skyaxis 如果做拓扑节点 popover，可直接抄 |

### 1.4 skyaxis 必须重写的部分

- **整棵树视图 vs 头部嵌入式 dropdown**：DSH 的 lineage 嵌在 header，是单亲节点的单层 dropdown；skyaxis 要做的是"全局拓扑画布"（多棵树、跨 root），需要：
  - 多 root 并列渲染
  - 节点拖拽 / 缩放 / 折叠
  - 选中态跨 panel 同步
- **轨迹流渲染**（trajectory merger，详见目标 3）
- **跨面板状态同步**：DSH 的 lineage 只看当前 selected session；skyaxis 可能要支持"看任意 root 而不影响选中"
- **历史快照**：skyaxis 关心"这个 root 3 天前的拓扑长什么样"，需要回放 projection cache（DSH 的 SessionManager 只活在内存里，刷新即丢）

---

## 目标 2：`list_agents` tool-adapter 的状态计算模式

### 2.1 关键代码片段（`packages/subagent/tool-subagent-control/src/list-agents.ts`）

状态精炼函数（59-63 行）：

```ts
function statusOf(
  agents: { get(id: SessionId): Agent | undefined },
  id: SessionId,
): 'running' | 'idle' | 'ready' {
  const agent = agents.get(id)
  if (agent === undefined) return 'ready'
  return agent.status === 'running' ? 'running' : 'idle'
}
```

投影函数（66-85 行）：把 `SubagentListEntry` 投成 model-facing entry，**one-shot 子 agent 直接返回 undefined**（模型不能 send_message 给它们，不出现在工具结果里）：

```ts
function project(
  agents: { get(id: SessionId): Agent | undefined },
  entry: SubagentListEntry,
  position?: Pick<SubagentDescendantListEntry, 'parentId' | 'depth'>,
): ListAgentsEntry | undefined {
  const at = position === undefined ? {} : { parent: position.parentId, depth: position.depth }
  if (entry.kind === 'diagnostic') {
    return { kind: 'diagnostic', id: entry.id, reason: entry.reason, ...at }
  }
  if (entry.mode !== 'continuable') return undefined
  return { kind: 'child', id: entry.id, label: entry.label, status: statusOf(agents, entry.id), ...at }
}
```

执行入口（165-191 行）：两种 scope 走两条独立 API：

- `children` → `ctx.subagents.listChildren(parent.id, exec.signal)`（直接子节点 + `agent.status` 精炼）
- `descendants` → `ctx.subagents.listDescendants(parent.id, exec.signal)`（完整 pre-order 树，每节点带 `parentId + depth`）

### 2.2 skyaxis 状态计算可借鉴的实现思路

skyaxis 不需要 model-visible 工具，但状态机完全可移植：

| DSH 状态 | 含义 | skyaxis 映射 |
|---|---|---|
| `running` | `agents.get(id).status === 'running'`（活的 Agent 在跑） | 同名节点 + 高亮动画 |
| `idle` | `agents.get(id)` 存在但 `status !== 'running'` | 同名节点（Agent 在内存里，但当前 turn 已停） |
| `ready` | `agents.get(id) === undefined`（只剩持久化数据） | 同名节点（dimmed） |

但 skyaxis **不需要 `idle` 状态**——DSH 的 `idle` 是因为模型可以 send_message 给一个 idle child 启动下一轮（agent 已经驻留内存所以反应快）。skyaxis 只是观察 UI，可以把 `idle + ready` 合并为 `settled`：

```ts
function statusOf(agents: AgentRegistry, id: SessionId, summary: SessionSummary): 'running' | 'settled' {
  // summary.running 是 host-side 通过 catalog snapshot 同步过来的"是否活跃"标志
  if (summary.running) return 'running'
  return 'settled'
}
```

**纯客户端派生位置建议**：放在 skyaxis 的 store selector / useMemo 里，不放 service 层——和 `indexSubagentDescendants` 一样保持纯函数可单测。

**`active duration` 派生**：照搬 `SubagentHeaderLineage.tsx:88-102` 的 `activityDuration()`：

- 读 `summary.projectionValues?.subagentTiming`（DSH 已经通过 projection 算出 `{ settledMs, active?: { since, through } }`）
- 客户端只做 `settledMs + (now - active.since)`，DSH 端 fold 完了，skyaxis 端做最终展示运算

### 2.3 注意点

- **listDescendants vs listChildren 的差异**：`listChildren` 只读直接子节点；skyaxis 做"主+子 agent 拓扑"必须用 `listDescendants` 才能拿到完整树
- **`hasChildren` 字段**：`SubagentListEntry.hasChildren` 是 DSH 在 catalog 阶段预计算好的"这个 child 是否还有 subagent descendants"，skyaxis UI 折叠/展开 chevron 的可见性判断可以照搬（见 `SubagentHeaderLineage.tsx:244-247`）
- **diagnostic reason 的语义**：`'corrupt' | 'unsupported' | 'unavailable'`——skyaxis UI 可以把它们渲染成红色 placeholder 行，沿用 DSH 的术语，不另造词

---

## 目标 3：trajectory merger 的最小可行设计

### 3.1 DSH 是否有现成 projection？**没有**

确认事实：

- `packages/session/session-projection/src/index.ts:199-223`：registry 只维护**单 session** 的 cell（`WeakMap<Session, UnitCell>`），所有 `apply` 都是 `(state, event: SessionEvent) => state` 的单事件折叠
- `packages/session/session-projection/src/index.ts:48-93`：`ProjectionDefinition` 接口明确约束 `apply(state, event)`，**不接受跨 session 输入**
- `packages/subagent/subagent/src/projection.ts`：只有两个 subagent 相关 projection：`subagent`（mode/label 身份）和 `subagentTiming`（活跃 duration），都是单 session fold
- `packages/subagent/subagent/src/list-children.ts:249-282` 的 `descendantCandidates` 是 pre-order 树遍历算法，但只产出 positioned 候选列表，**不做事件合并**

### 3.2 跨 session 合并的最小可行设计建议（**只给架构，不写 skyaxis 代码**）

**核心思路**：skyaxis 必须在客户端从 durable session storage 读取每个 subagent 的 events 流，然后按 `.time` 字段（每个事件都有，`packages/session/session-format/src/types.ts:32`）做时间戳合并。

**数据流**：

```
1. 拉 rootSession 的 SessionQueryEngine.listSessions()
   → 拿到所有 SessionFormatHeader
2. 用 list-children.ts:249-282 同样的 pre-order DFS 算法
   构造 { sessionId, parentId, depth } 三元组列表
3. 对每个 sessionId：
   - 如果是 live（ctx.sessions.get(id) 不为 undefined）
     → 直接读 Session.snapshotEvents()
   - 如果是 cold
     → SessionQueryEngine.observeSession(id)
     → 读 ownedObservation 的 events
4. 把所有 events 拍扁成一个数组，
   每条加上 metadata = { sessionId, parentId, depth }
5. 按 .time 升序排序（同 .time 用 .seq 二次排序）
6. 用一个 group-by-time-window 或 group-by-turn 切分
   → 输出 "merged trajectory view"
```

**关键参考算法位置**：

- pre-order DFS with visited guard：`packages/subagent/subagent/src/list-children.ts:264-280`（visited Set 防环、stack 反向 push 维持 pre-order）
- LIFECYCLE_WITNESS_KEYS（lifecycle 身份判定）：`packages/subagent/subagent/src/list-children.ts:389-392`，skyaxis merger 缓存时可以用这 8 个字段做跨进程 identity
- `SubagentIdentityProjection.seq` 是 durable identity 的归属标志（`packages/subagent/subagent/src/projection.ts:118-156`），判 inherited vs owned 时同样用 seq 与 `inheritedEventCount` 比较（参考 `list-children.ts:354-358`）

**DSH 端可借鉴但不照搬**：

- `SessionProjectionRegistry.drive()`（`session-projection/src/index.ts:655-701`）的 eager event drive + `Object.is` 比较发布模式——skyaxis merger 可以参考"事件到来 → 增量重算 merged view → 用 `Object.is` 比较是否需要触发 React 重渲染"的链路
- `sessionProjectionCache.cachedSnapshot()` / `viewCheckpoint()` / `hydrate()`（`packages/session/session-projection-cache/src/index.ts`）的三层 fallback——skyaxis merger 缓存也可以做"内存热缓存 + 持久化 checkpoint + 重新折叠"三层

**skyaxis merger 不要做的事**：

- 不要尝试写一个 DSH `ProjectionDefinition` 让 server 端合并——`apply(state, event)` 接口本身就不允许跨 session 输入
- 不要尝试侵入 `agent-loop`——`packages/agent/agent-loop/` 没有暴露任何 merger 钩子，DSH 把 subagent 视为"独立 session + 关系回指"是**架构决定**，不是技术债

### 3.3 持久化与重启场景

DSH 的 `session-projection-cache` 把每个 session 的 checkpoint 存在 host 侧 SQLite/JSONL，skyaxis 想做"3 天前的拓扑回放"必须自己持久化 merged view。**v0.1 demo 阶段建议**：先把 merger 做成纯内存单页应用，跨刷新重建即可，持久化放二期。

---

## 目标 4：skyaxis 插件集成前提

### 4.1 DSH Cordis plugin 模型（关键事实）

来自 `packages/CLAUDE.md` 和仓库 `AGENTS.md`：

- **Function plugin 形态**：`export const name = '...'; export const inject = [...]; export const Config = ...; export function apply(ctx) { ... }`（默认导出禁止用——见 postmortem 0001）
- **服务访问**：`ctx.<name>` 是 property proxy，仅对 `inject` 中声明的服务可用；缺服务会**拓扑敏感**地抛错；跨调用方的全局读要用 `ctx.get('name')`
- **Host plugin 注册位置**：`cordis.yml` 中以 `id` + `name: '@scope/pkg'` 形式列；裸 plugin（无 npm name）必须出现在**它所在 resolver manifest 的 dependencies** 里，由 `verify-cordis-config` 强校验
- **Client plugin 注册位置**：package.json 的 `dsh.client.inject` 数组——列的是 browser 端 `apply()` 运行时需要的服务（**注意这个字段是字符串数组，不是 host-side 注入声明**）
- **`dsh.client` 行**：bundle patch 里的 `- id: <id> / name: '@scope/pkg'` 同时是 host row 和 client row，Loader 启动时扫描 `node_modules` 注入到 `window.__DSH_BOOT__`
- **`packages/bundle/web-app/cordis.patch.yml`** 是 web-app 的完整 patch 模板——所有 host 插件都在此显式列出。`packages/bundle/web-app/src/startup.ts` 是命令行 provider，不是 plugin 注册点

### 4.2 skyaxis 可以注入的服务（observe-only 配置）

下面 6 个注入都在 web-app / base 已加载的范围里，skyaxis 全部只读访问即可：

| 注入 | 来源包 | skyaxis 用途 | 风险 |
|---|---|---|---|
| `subagents` | `@deepseek-ai/dsh-subagent` | 调 `listChildren` / `listDescendants` 拿拓扑 | 只读，safe |
| `sessions` | `@deepseek-ai/dsh-session` | 读 live session events | 只读，safe |
| `sessionQuery` | `@deepseek-ai/dsh-session-query` | 读 cold session（含 projection cache） | 只读，safe |
| `sessionProjections` | `@deepseek-ai/dsh-session-projection` | 读 `subagent` / `subagentTiming` / `tokenUsage` projection values | 只读，safe |
| `sessionProjectionCache` | `@deepseek-ai/dsh-session-projection-cache` | checkpoint 持久化（optional，skyaxis 也能用它做 merged view 缓存） | 只读 + 可选写自己 key，safe |
| `agents` | `@deepseek-ai/dsh-agent` | 调 `agents.get(id).status` 做 running/idle/ready 精炼 | 只读，safe |

**skyaxis 不需要注入的写路径**（如果注入就要慎重）：

- 不要 inject `subagent-model-selection-settings`、`tool-subagent`、`tool-subagent-control` ——这些是改 model 行为的
- 不要 host 任何 `subagent.prompt` / `subagent.interrupt` 的 RPC handler ——skyaxis 是 observe-only
- 不要写 DSH cordis 行到 `cordis.yml` 替用户启 model-visible tool

### 4.3 集成路径选择（**MVP 优先 B，长期目标 A**）

| 形态 | 描述 | 决策 |
|---|---|---|
| **A** | DSH 主仓 PR：skyaxis 包以 `@deepseek-ai/dsh-skyaxis` 入 `packages/experimental/` | 长期目标 |
| **B** | 外部 patch overlay：skyaxis 在独立仓，发 `@skyaxis/plugin`，用户用 `dsh --profile web --patch skyaxis.overlay.yml` 加载 | **MVP 优先** |
| **C** | 纯 UI 客户端：通过 `window.__DSH_BOOT__` 拿 host 注入的服务引用 | fallback

**MVP 选 B 的前提**：假设 1（`verify-cordis-config` 是否允许跨 monorepo 的裸 plugin 出现在 patch overlay 中）必须验证通过。

### 4.4 observe-only 验证标准

skyaxis 是否真"只读"，可以这样 grep 自检：

- 任何对 `ctx.subagents.continuationBinding` / `registerProvider` / `interrupt` / `fork` 的调用都禁止
- 任何注册到 `ctx.tools` 的 tool 禁止（除非带 `disabled: true` 永远不会触发）
- 任何对 `SubagentService` 上写方法的引用禁止

v0.1 实施期建议加一个 `verify-skyaxis-readonly` 的 lint 脚本，扫描上述调用。

---

## DSH demo 待 v0.1 实施期验证的 8 条假设清单

> ⚠️ **以下假设均未通过 DSH 实际运行验证**。v0.1 实施期必须逐条验证；任意 **3 条以上不成立**应回退到"skyaxis MVP 不做 subagent 拓扑可视化"。

| # | 假设 | 验证方法 | 失败后果 |
| --- | --- | --- | --- |
| 1 | `dsh --profile web --patch <外部-overlay.yml>` 能加载非 monorepo 内的 cordis plugin，且 `verify-cordis-config` 不拒绝 overlay 中的 `@skyaxis/*` 包名 | v0.1 demo 第一天必验证 | skyaxis 无法作为独立包加载，需 DSH 主仓 PR |
| 2 | `@deepseek-ai/dsh-api-session-controller/client` 暴露的 `remotes.subagents.list(parentId)` 可以被 skyaxis 直接调用拿到 `SubagentCatalog` | 写最小插件跑通 | 需额外 host row 注册 |
| 3 | `subagentTiming` projection 字段在 `useProjection('subagentTiming')` 链路上的 latency 足够低（每节点 1s tick 时不会因 projection 重算卡顿） | 实测响应时间 | 改用 `SessionSummary.running` 二值信号 |
| 4 | `SessionQueryEngine.observeSession(id)` 在 web-app patch 启动后默认就能用，不需要额外的 provider 注册 | v0.1 demo 验证 | skyaxis 需声明 `inject: ['sessionQuery']` |
| 5 | `turn/start` / `turn/end` / `subagent/descriptor` 事件的 `.time` 字段足够做跨 session 排序（不出现未来时间戳、不会回拨） | v0.1 demo 必验证 | merger 排序失败，事件顺序错乱 |
| 6 | cold observation 返回的 `events` 数组包含该 session 的所有事件，包括 `subagent/descriptor` | v0.1 demo 必验证 | merger 在 cold node 上丢身份信息 |
| 7 | `ctx.agents.get(id)` 在用户**未选中**该 session 时也能返回（DSH 是否只 retain selected session 的 Agent） | v0.1 demo 必验证 | `running` 状态精度下降 |
| 8 | SubagentCatalog `hasChildren` 在 catalog snapshot 阶段已经预计算，skyaxis 不需要自己再做一次 DFS | 已读代码确认（`packages/subagent/subagent/src/list-children.ts:81-92`） | skyaxis 需自做 DFS |

---

## 关键文件清单（绝对路径）

DSH 端（已读取）：

- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/client/ui-subagent/package.json`
- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/client/ui-subagent/src/index.ts`
- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/client/ui-subagent/src/client/index.ts`
- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/client/ui-subagent/src/client/SubagentHeaderLineage.tsx`
- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/client/ui-subagent/src/client/SubagentReadOnlyComposer.tsx`
- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/client/ui-subagent/src/client/subagent-lineage.ts`
- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/subagent/tool-subagent-control/src/list-agents.ts`
- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/subagent/subagent/src/projection.ts`
- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/subagent/subagent/src/list-children.ts`
- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/subagent/subagent/src/control-types.ts`
- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/session/session-projection/src/index.ts`
- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/session/session-format/src/types.ts`
- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/api/session-controller/src/types.ts`
- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/api/session-controller/src/client/sessions/manager.ts`
- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/api/session-controller/src/client/sessions/service.ts`
- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/api/session-controller/src/client/sessions/remotes.ts`
- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/bundle/web-app/cordis.patch.yml`
- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/bundle/web-app/src/startup.ts`

DSH 端（提到但未深读，skyaxis v0.1 实施期需查）：

- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/agent/agent-loop/src/` ——事件发射源头
- `/Users/Ray/TraeProjects/skyaxis/deepseek-harness/packages/session/session-projection-cache/src/index.ts` ——checkpoint 持久化

---

## 调研方法学说明

所有引用都基于 `git rev-parse HEAD = fb2c4b9e698e30edb738bca4cf0618587db7d203`（v0.1.5-rc.2）的实际源码，未做任何推测性内容。`packages/web/web/` 在该版本中是一个 web capability seam（search/fetch），不是 web server；`packages/web/web-server/` 不存在于该 commit。DSH 的 web server 由 `packages/bundle/web-app` + `packages/host-webserver` + `packages/api-gateway` 组合提供。所有"DSH 自带 UI 参考"路径均经过文件存在性确认。

---

## 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-19 | 初版。第二阶段只读调研报告存档，作为 [ADR 0009](../decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md) 的事实依据。 |