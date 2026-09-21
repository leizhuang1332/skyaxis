# DSH 6 只读服务消费路径地图（v0.1 实施期基线）

> 本调研是 skyaxis v0.1 实施期第一步的"消费地图"。把 [ADR 0009 第 9.7 节](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md) 锁定的 6 个 observe-only 服务（`subagents` / `sessions` / `sessionQuery` / `sessionProjections` / `sessionProjectionCache` / `agents`）逐个拆开，记录"从哪里取、按什么形状取、什么是只读、什么是写入"。
>
> **不细化字段、不定接口、不写代码**（遵循 [CLAUDE.md 第 2.1 节](../CLAUDE.md) 边界）。本文是后续 `verify-skyaxis-readonly` oxlint 规则 + skyaxis 仓 package.json `dependencies` 列表 + trajectory merger 设计的输入。

**锁定来源**：

- [ADR 0009 第 9.7 节](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md) observe-only 集成（6 个只读服务）
- [ADR 0010 第 10.1 节](decisions/0010-技术选型-MVP实施期.md) 与 DSH 工具链对齐（pnpm / workspace:^ / tsdown / Vitest）
- DSH 仓 AGENTS.md / vendor/cordis 源码（read-only，本次调研事实来源）

**DSH 锁定版本**：`dsh-v0.1.5-rc.2`（commit `fb2c4b9e698e30edb738bca4cf0618587db7d203`）

---

## 1. 调研范围与事实采集

### 1.1 已读取的 DSH 源码（read-only）

| 路径 | 服务 / 模块 | 关键发现 |
| --- | --- | --- |
| `packages/core/session/src/index.ts` | `ctx.sessions`（`SessionStore extends Service`） | 服务名 `'sessions'`；公共方法 `create` / `prepare` / `enter` / `announce` / `get` / `list` / `flush` / `fork` |
| `packages/session/session-projection/src/index.ts` | `ctx.sessionProjections`（`SessionProjectionRegistry extends Service`） | 服务名 `'sessionProjections'`；公共方法 `register`（**写**）/ `onChanged`（订阅）/ `stateOf`（读）/ `snapshot`（读）/ `cachedSnapshot`（读）/ `checkpoint`（读）/ `restoreFloor`（读）/ `viewCheckpoint`（读）/ `restore`（读）/ `hydrate`（读） |
| `packages/session/session-projection-cache/src/index.ts` | `ctx.sessionProjectionCache`（`SessionProjectionCache extends Service`） | 服务名 `'sessionProjectionCache'`；`static inject = ['storageDomain', 'sessionProjections', 'sessions']`；公共只读方法 `cachedSnapshot` / `cachedPredecessorTitle` |
| `packages/session-query/session-query/src/index.ts` | `ctx.sessionQuery`（`SessionQueryEngine extends Service`） | 服务名 `'sessionQuery'`；`static inject = ['sessions']`；公共只读方法 `observeSession` / `searchSessions` / `searchEvents` / `listSessions` / `readSession` / `filterSessions` / `readTitle` / `listEvents` / `filterEvents` / `readSurface` / `traceSession` / `traceEvent` / `readEvent` |
| `packages/subagent/subagent/src/index.ts` | `ctx.subagents`（`SubagentRuntime extends TypertRemoteService`） | 服务名 `'subagents'`；只读方法 `listChildren` / `listDescendants` / `getProvider` / `list`；**写**方法 `start` / `startContinuable` / `sendMessage` / `interrupt` / `drainContinuableDescendants` / `drainContinuableChildren` / `registerProvider` / `prompt` / `interruptByParent` |
| `packages/core/agent/src/index.ts` | `ctx.agents`（`AgentRegistry extends Service`） | 服务名 `'agents'`；公共方法 `get(id)`（读）/ `create`（**写**）/ `resume`（**写**）/ `drain`（**写**）/ `setFactory`（**写**）/ `withInitiator`（**写**） |
| `vendor/cordis/src/service.ts` | `Service` 基类 | `constructor(ctx, name)` 注册到 `ctx.reflect.provide(name, this, ...)`；`static inject = ['xxx']` 声明依赖；服务被 owning fiber 自动 dispose |
| `packages/client/ui-subagent/src/client/subagent-lineage.ts` | ui-subagent 拓扑索引 | 已知事实陈列 `indexSubagentDescendants(summaries)` 是纯函数；与 SessionStore / sessionQuery 的"运行时事件流"无关，skyaxis 不直接复用 |

### 1.2 cordis 依赖注入约定（DSH AGENTS.md + cordis 源码）

DSH 仓 `packages/AGENTS.md`：

- **Service packages default-export their service class**（`export default XxxService`）
- **Function plugins named-export `name` / `inject` / `Config` / `apply`**；**无 default export**（混用导致 Loader 丢弃 function plugin 的 namespace，postmortem 0001）
- **Optional services use `ctx.get(name)`** — `ctx.<name>` 是 property proxy（topology-sensitive），只对 `inject` 声明过的服务可用；可选服务必须用 `ctx.get`
- **Empty `apply()` for pure UI plugin** — ui-subagent 是这个模式（`export function apply(): void {}`）
- **Registries: `register()` returns disposer**（effect-scoped）

→ skyaxis 仓作为 DSH 插件必须遵循同样约定：纯 UI plugin 用 `apply()` 空实现 + 命名导出。

### 1.3 服务名 / 注入约定一览

| 服务 | 服务名（`ctx.<name>`） | DSH 包 | 注入依赖（`static inject`） |
| --- | --- | --- | --- |
| `SessionStore` | `sessions` | `@deepseek-ai/dsh-session` | 无显式 `static inject`（隐式依赖 `typert`） |
| `SessionProjectionRegistry` | `sessionProjections` | `@deepseek-ai/dsh-session-projection` | 无（订阅 `session/event` / `session/created`） |
| `SessionProjectionCache` | `sessionProjectionCache` | `@deepseek-ai/dsh-session-projection-cache` | `['storageDomain', 'sessionProjections', 'sessions']` |
| `SessionQueryEngine` | `sessionQuery` | `@deepseek-ai/dsh-session-query` | `['sessions']` |
| `SubagentRuntime` | `subagents` | `@deepseek-ai/dsh-subagent` | `ctx.inject(['agents'])` + `ctx.inject(['sessionProjections'])` |
| `AgentRegistry` | `agents` | `@deepseek-ai/dsh-agent` | 无显式 `static inject` |

→ skyaxis 在 inject 列表中需声明 `['subagents', 'sessions', 'sessionQuery', 'sessionProjections', 'sessionProjectionCache', 'agents']` 才能用 property proxy；或对可选服务用 `ctx.get(name)`。

---

## 2. 6 只读服务消费路径表

> 每行给出：**服务 → 安全用法（observe-only）→ 危险用法（禁止 / 必须避开）→ 返回结构简述 → skyaxis 用法示例**。

### 2.1 `ctx.subagents` — SubagentRuntime（**半只读**）

| 维度 | 内容 |
| --- | --- |
| **包** | `@deepseek-ai/dsh-subagent` |
| **类** | `SubagentRuntime extends TypertRemoteService` |
| **safe（observe-only）** | `listChildren(parentSessionId, signal?)` / `listDescendants(rootSessionId, signal?)` / `getProvider(name)` / `list()` |
| **forbidden（写）** | `start` / `startContinuable` / `sendMessage` / `interrupt` / `drainContinuableDescendants` / `drainContinuableChildren` / `registerProvider` / `prompt` / `interruptByParent` |
| **safe 事件订阅** | `ctx.on('subagent/provider-added', ...)` / `ctx.on('subagent/provider-removed', ...)`（观察 provider 注册表） |
| **safe 事件订阅（生命周期）** | `ctx.on('subagent/start', ...)` / `ctx.on('subagent/end', ...)`（注意 `@dshScopeScan unsupported` + scope-filtered dispatch） |
| **return SubagentListEntry** | 字段：`sessionId` / `parentSession`（隐含）/ `origin` / `running` / `mode` / `label` / `provider` / `createdAt` 等（具体见 `packages/subagent/subagent/src/list-children.ts:264-280`）|
| **return SubagentDescendantListEntry** | 在 `SubagentListEntry` 基础上加 `parentId` / `depth`（pre-order DFS 遍历） |
| **skyaxis 用法** | v0.1 多 root 拓扑视图的"节点数据源"——`listDescendants(rootId)` 一次拉一棵完整 subagent 树（pre-order）；`running` 字段映射到 skyaxis 的 `node.status = 'running' / 'settled'`；`depth` 字段映射到拓扑层级 |
| **触发刷新** | 订阅 `subagent/start` / `subagent/end` 事件，`running` 状态翻转时增量更新 |

### 2.2 `ctx.sessions` — SessionStore（**有副作用但可只读**）

| 维度 | 内容 |
| --- | --- |
| **包** | `@deepseek-ai/dsh-session` |
| **类** | `SessionStore extends Service` |
| **safe（observe-only）** | `get(id)` / `list()` / `flush(session)` |
| **forbidden（写）** | `create` / `prepare` / `enter` / `announce` / `fork` |
| **safe 事件订阅** | `ctx.on('session/created', ...)` / `ctx.on('session/disposed', ...)` / `ctx.on('session/event', ...)` / `ctx.parallel('session/flush', ...)`（监听，不触发）|
| **return Session** | 字段：`id` / `header`（含 `parentSession` / `isSeeded` / `origin` / `delegationDepth` / `agentPreset`）/ `seq` / `events`（只读访问器）/ `inheritedEventCount` |
| **skyaxis 用法** | v0.1 多 session 总览视图的"session 列表数据源"——`list()` 一次拉当前所有 live session；`get(id)` 按 id 拉单个 session 用于详情面板 |
| **持久化补全** | 拿不到 live session 时（已 disposed）走 `sessionQuery.readSession(id)` 冷读回放补全 |

### 2.3 `ctx.sessionQuery` — SessionQueryEngine（**纯只读**）

| 维度 | 内容 |
| --- | --- |
| **包** | `@deepseek-ai/dsh-session-query` |
| **类** | `SessionQueryEngine extends Service`（abstract，DSH 内部有具体实现） |
| **safe（observe-only）** | **全部 14 个公共方法**：`observeSession` / `searchSessions` / `searchEvents` / `listSessions` / `readSession` / `filterSessions` / `readTitle` / `readTitleSnapshot` / `readTitleSnapshots` / `listEvents` / `filterEvents` / `readSurface` / `traceSession` / `traceEvent` / `readEvent` |
| **return** | 见第 2.3.1 子表 |
| **skyaxis 用法** | **trajectory merger 主数据源**——`observeSession(id)` 拉 live lease；冷读场景用 `readSession(id)` / `listEvents(id)` / `filterEvents(id, filters)`；跨 session 搜索用 `searchSessions` / `searchEvents` |

#### 2.3.1 `sessionQuery` 关键方法返回结构（trajectory merger 相关）

| 方法 | 返回结构 | skyaxis 用法 |
| --- | --- | --- |
| `observeSession(id, options?)` | `Promise<SessionObservation>`（caller-owned lease，**live 路径**）| live session 事件流主入口；skyaxis 的"实时轨迹合并"用此 |
| `readSession(id)` | `Promise<SessionLogSnapshot>` = `{ session: SessionHeader, inheritedEventCount, events: SessionEvent[] }` | cold session 完整回放；skyaxis 的"冷态轨迹合并"用此 |
| `listEvents(id)` | `Promise<SessionEventRecord[]>` | 单 session 事件列表（轻量版，比 `readSession` 更快） |
| `filterEvents(id, filters)` | `Promise<SessionEventSearchDocument[]>` | 事件搜索（带谓词） |
| `readEvent(request)` | `Promise<SessionEventWindow>` = `{ session, inheritedEventCount, target, events, startSeq, endSeq }` | 单事件 + 上下文窗口（UI "跳到该事件" 用） |
| `traceSession(id, signal?)` | `Promise<SessionLineageTrace>` | 跨 session 血缘（skyaxis D2 场景间依赖主数据源） |
| `listSessions(signal?)` | `Promise<SessionRecord[]>` | **所有** session（含已 disposed 的 persisted session）——`sessions.list()` 的全集补全 |

### 2.4 `ctx.sessionProjections` — SessionProjectionRegistry（**半只读**）

| 维度 | 内容 |
| --- | --- |
| **包** | `@deepseek-ai/dsh-session-projection` |
| **类** | `SessionProjectionRegistry extends Service` |
| **safe（observe-only）** | `stateOf(session, key)` / `snapshot(session, keys?)` / `cachedSnapshot(session, keys?)` / `checkpoint(session)` / `restoreFloor(checkpoint)` / `viewCheckpoint(checkpoint, keys?)` / `restore(...)` / `hydrate(session, ...)` |
| **forbidden（写）** | `register(definition)`（**skyaxis 不应注册新 projection**——DSH 子包职责；v0.1 demo 验证 ADR 0009 假设 6 "skyaxis 不需要注册自己的 projection"） |
| **safe 事件订阅** | `onChanged(listener)` —— `ProjectionChangeListener = (session, key, value, seq) => void`（按 `Object.is` 比较） |
| **skyaxis 用法** | **节点 metadata / activity duration 数据源**——`snapshot(session, ['subagent.timing', 'subagent.identity', 'subagent.catalog'])` 拉折叠后的 subagent 状态；`onChanged` 增量推送 |

> ⚠️ **ADR 0009 假设 6 提醒**：skyaxis 是否注册自己的 projection（Task / Task DAG / Decision / Snippet）待 v0.1 demo 验证。本次调研假设 skyaxis **不注册**——所有业务对象从 `sessionQuery.readSession` / `listEvents` 解析。

### 2.5 `ctx.sessionProjectionCache` — SessionProjectionCache（**纯只读**）

| 维度 | 内容 |
| --- | --- |
| **包** | `@deepseek-ai/dsh-session-projection-cache` |
| **类** | `SessionProjectionCache extends Service` |
| **safe（observe-only）** | `cachedSnapshot(meta, inheritedEventCount, keys?)` / `cachedPredecessorTitle(meta, inheritedEventCount)` |
| **forbidden（写）** | 无公共写方法（写由 DSH 内部 effect 触发，skyaxis 不可见） |
| **skyaxis 用法** | **零 I/O listing read**——已知 session 列表但 session 不在 live store（已 disposed / persisted only）时，用 `cachedSnapshot(header, inheritedEventCount)` 拿已折叠的 projection 值作为"快速提示"；live 读走后 `hydrate` 或 `restore` 才补全 |

### 2.6 `ctx.agents` — AgentRegistry（**半只读**）

| 维度 | 内容 |
| --- | --- |
| **包** | `@deepseek-ai/dsh-agent` |
| **类** | `AgentRegistry extends Service` |
| **safe（observe-only）** | `get(id)`（**唯一 safe**） |
| **forbidden（写）** | `create` / `resume` / `drain` / `setFactory` / `withInitiator` / `dispose` |
| **safe 事件订阅** | `ctx.on('agent/created', ...)` / `ctx.on('agent/disposed', ...)` / `ctx.on('agent/event', ...)`（监听，不触发） |
| **return Agent** | 字段：`sessionId` / `session` / `agentOptions` / `agentCarrier` / `state`（running / idle / ready）等 |
| **skyaxis 用法** | **subagent 拓扑的"live agent 状态"数据源**——`subagents.listChildren` 给的是 session-backed 列表，`agents.get(id)` 给的是该 session 上是否挂有 live Agent；拓扑视图节点 metadata 的 `hasAgent` / `agentState`（`running / idle / ready`）从此来 |

---

## 3. observe-only 边界（必须避开的写调用面）

> 按"skyaxis 一旦触发即触发 NF.2 违规"原则，列明所有写面。`verify-skyaxis-readonly` oxlint 规则（v0.1 第一周实现）的扫描目标。

### 3.1 禁止的 DSH 服务方法（按服务分组）

| 服务 | 禁止方法 | 触发效果 |
| --- | --- | --- |
| `ctx.subagents` | `start` / `startContinuable` / `sendMessage` / `interrupt` / `drainContinuableDescendants` / `drainContinuableChildren` / `registerProvider` / `prompt` / `interruptByParent` | 派生 / 继续 / 中断 / 销毁 subagent；注册新 provider |
| `ctx.sessions` | `create` / `prepare` / `enter` / `announce` / `fork` | 新建 / 准备 / 提交 / 宣布 / fork session |
| `ctx.sessionProjections` | `register` | 注册新 projection unit（DSH 内部 projection 范畴，skyaxis 越界） |
| `ctx.agents` | `create` / `resume` / `drain` / `setFactory` / `withInitiator` / `dispose` | 新建 / 恢复 / 销毁 agent；设置 factory；进入 initiator scope |

### 3.2 禁止的 cordis 副作用

> cordis 提供的通用副作用原语中，下列对 skyaxis 是**副作用边界外**：一旦使用即触发 NF.2 违规。

| 原语 | 类型 | skyaxis 限制 |
| --- | --- | --- |
| `ctx.emit('subagent/start', info)` | 写（**模拟**事件） | ❌ 禁止（`subagent/start` 由 DSH lifecycle emitter 发出） |
| `ctx.emit('subagent/end', info)` | 写（**模拟**事件） | ❌ 禁止 |
| `ctx.emit('session/created', session)` | 写 | ❌ 禁止 |
| `ctx.emit('session/event', session, event)` | 写 | ❌ 禁止 |
| `ctx.parallel('session/flush', session)` | 副作用（触发 flush） | ❌ 禁止（`ctx.sessions.flush` 是公开入口；skyaxis 只订阅） |
| `ctx.inject(['agents'], callback)` | 副作用（注册新注入） | ❌ 禁止（skyaxis 是消费者，不注入） |
| `ctx.effect(...)` | 副作用（注册 effect） | ⚠️ 只读场景的 `ctx.on(...)` 订阅 OK；写 effect 禁止 |

### 3.3 安全 vs 危险的判断框架

| 维度 | 安全 | 危险 |
| --- | --- | --- |
| **数据流方向** | DSH → skyaxis（skyaxis 拉）| skyaxis → DSH（skyaxis 推 / 写）|
| **副作用** | 无（pure query / pure subscription）| 有（state mutation / event dispatch / service registration）|
| **触发链** | skyaxis 接收事件（passive observer）| skyaxis 触发事件（active emitter）|

---

## 4. 类型导出路径（避免深路径 import）

> DSH 仓 AGENTS.md：service package `default-export` 服务类；类型通过 named-export 暴露。skyaxis 包消费类型时优先从包根 `@deepseek-ai/dsh-<pkg>` 导入，避免 `import type from '@deepseek-ai/dsh-<pkg>/src/...'` 深路径。

### 4.1 顶层类型导出（推荐入口）

| 包 | 顶层类型导出（`@deepseek-ai/dsh-<pkg>`） | skyaxis 用到的类型 |
| --- | --- | --- |
| `@deepseek-ai/dsh-session` | `Session` / `SessionId` / `SessionHeader` / `SessionEvent` / `SessionEventMap` / `SessionEventType` / `SessionLogOffset` / `SessionSeq` / `CreateSessionOptions` 等 | `Session` / `SessionId` / `SessionHeader` / `SessionEvent` / `SessionSeq` |
| `@deepseek-ai/dsh-session-projection` | `ProjectionDefinition` / `ProjectionSnapshot` / `ProjectionChangeListener` / `ProjectionCheckpoint` / `SessionProjectionMap` / `SessionProjectionStateMap` | `ProjectionSnapshot` / `SessionProjectionMap` |
| `@deepseek-ai/dsh-session-projection-cache` | `CheckpointIdentity` / `CheckpointRecord` | （暂不用）|
| `@deepseek-ai/dsh-session-query` | `Config` / `SessionQueryError` / `ColdSessionLog` / `SessionObservation` / `SessionObservationOptions` + 全部 `types.ts` 导出 | `SessionObservation` / `SessionObservationOptions` / `SessionLineageTrace` / `SessionRecord` / `SessionLogSnapshot` |
| `@deepseek-ai/dsh-subagent` | `SubagentRuntime` / `SubagentListEntry` / `SubagentDescendantListEntry` / `SubagentProvider` / `SubagentCapabilities` / `SubagentIdentityProjection` / `SubagentTimingProjection` 等 | `SubagentListEntry` / `SubagentDescendantListEntry` / `SubagentIdentityProjection` / `SubagentTimingProjection` |
| `@deepseek-ai/dsh-agent` | `Agent` / `AgentOptions` / `AgentRegistry` / `AgentHandle` / `CreateAgentOptions` / `ResumeAgentOptions` | `Agent` / `AgentRegistry`（仅类型）|

### 4.2 跨包共享类型

| 类型 | 定义包 | 消费方 | 备注 |
| --- | --- | --- | --- |
| `SessionId` | `@deepseek-ai/dsh-session` | 全部 | branded `string`；不要用 `string` 替代 |
| `SessionHeader` | `@deepseek-ai/dsh-session` | `subagents` / `sessionProjectionCache` / `sessionQuery` | 不可变（`deepFreeze`） |
| `SessionEvent` | `@deepseek-ai/dsh-session` | 全部 | 不可变；merge-extensible（DSH + plugin 各自扩展） |
| `SessionSeq` | `@deepseek-ai/dsh-session` | `sessionProjections` / `sessionProjectionCache` | branded number |

### 4.3 风险：DSH 包结构变化时的应对

> ADR 0010 风险表中已识别。v0.1 实施期第一周验证本调研列出的所有消费路径是否仍能解析；若有变化，记录在 `docs/research/dsh-consume-map.md` 修订记录。

---

## 5. trajectory merger 候选 API（按场景分组）

> [ADR 0009 第 9.4 节](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md) 锁定 skyaxis 自研 trajectory merger。本节给出 4 种合并路径的 API 候选。

### 5.1 合并路径对照表

| 场景 | 数据源（DSH 侧） | skyaxis 端处理 | 候选 API |
| --- | --- | --- | --- |
| **Live single-session** | live session 的 `Session.eventAt(seq)` / `snapshotEvents()` | 直接遍历 events | `sessionQuery.observeSession(id)` 返回 lease 后读 events |
| **Live multi-session merge** | 多个 live session + subagent 事件流 | 按 `.time` 排序 + 按 turn 边界分组 | `subagents.listDescendants(rootId)` 拿拓扑 → 对每个 session 调 `observeSession` → 合并 |
| **Cold single-session read** | 持久化 session | `readSession` 返回完整 events 数组 | `sessionQuery.readSession(id)` |
| **Cold multi-session merge** | 多个 persisted session（已 disposed） | 按 `.time` 排序 + 按 turn 边界分组 + 标记 `_origin = { sessionId, parentId, depth, label }` | `sessionQuery.listSessions()` + 对每个 id 调 `readSession` → 合并 |

### 5.2 合并算法（伪代码）

```
async function mergeTrajectories(rootSessionId: SessionId): Promise<MergedTrajectory> {
  // 1. 拿完整拓扑（live + cold 都行）
  const descendants = await ctx.subagents.listDescendants(rootSessionId)
  const allSessionIds = [rootSessionId, ...descendants.map(d => d.id)]

  // 2. 对每个 session 拉事件流
  const perSessionEvents = await Promise.all(
    allSessionIds.map(async (id) => {
      // live session 用 observeSession（lease），cold 用 readSession
      const observation = await ctx.sessionQuery.observeSession(id).catch(() => null)
      if (observation) return { id, events: await observation.events() }
      return { id, events: (await ctx.sessionQuery.readSession(id)).events }
    })
  )

  // 3. 按 .time 排序（DSH SessionEvent 都带 .time 字段）
  const merged = perSessionEvents
    .flatMap(({ id, events }) => events.map(e => ({ ...e, _origin: { sessionId: id } })))
    .sort((a, b) => a.time - b.time)

  // 4. 按 turn 边界分组（turn/start ↔ turn/end）
  const grouped = groupByTurnBoundary(merged)

  return { events: merged, turns: grouped, windowStart: merged[0]?.time, windowEnd: merged.at(-1)?.time }
}
```

> ⚠️ **5.2 节伪代码不进入 skyaxis 仓代码**，仅作为设计参考。v0.1 实施期 trajectory merger 模块具体接口待新 ADR（候选 ADR 0012）锁定。

### 5.3 5 个待验证假设（ADR 0009 中本调研覆盖）

| ADR 0009 假设 | 本调研覆盖度 | 结论 |
| --- | --- | --- |
| **1. `verify-cordis-config` 是否放过形态 B（外部 patch overlay）** | ❌ 未覆盖 | v0.1 demo 第一天验证 |
| **2. `subagents.listChildren` / `listDescendants` 的 live vs cold 一致性** | ✅ 覆盖 | API 形态确认（`listChildren(parentId, signal?)` 返回 `SubagentListEntry[]`；`listDescendants(rootId, signal?)` 返回 `SubagentDescendantListEntry[]` 加 `parentId` / `depth`）|
| **3. `sessionQuery.observeSession` 的 lease 语义与 `readSession` 的 snapshot 语义边界** | ✅ 覆盖 | `observeSession` 返回 caller-owned lease（live path）；`readSession` 返回 `SessionLogSnapshot`（cold path）；两者不混用 |
| **4. trajectory merger 在 N=64 边界（[ADR 0009 第 9.4 节](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)）下的内存与延迟预算** | ❌ 未覆盖 | v0.1 demo 跑通后做性能回归 |
| **5. 6 只读服务的 type-only 导出路径稳定性** | ✅ 覆盖 | 顶层 `@deepseek-ai/dsh-<pkg>` 入口确认；深路径 import 风险已识别 |
| **6. skyaxis 不需要注册自己的 projection** | ⚠️ 间接覆盖 | 6 个服务消费路径全部走"读取 + 订阅"，未触发 `sessionProjections.register` |
| **7. `ctx.on('subagent/start' / 'subagent/end')` 的 scope-filtered dispatch 在 ui-subagent 之外的 consumer 行为** | ⚠️ 间接覆盖 | DSH source comment：scope-filtered dispatch 用 `@dshScopeScan unsupported`；skyaxis 用 `ctx.inject(['subagents'])` 后通过 `Scoped<SubagentRuntime>` 监听，行为与 ui-subagent 等价 |
| **8. `sessionQuery.traceSession` 的递归边界（cycle detection）** | ✅ 覆盖 | DSH source comment 已明确："throws when ... the target is absent, or its known ancestry cycles" |

**本调研覆盖 4 项（2 / 3 / 5 / 8）；间接覆盖 2 项（6 / 7）；未覆盖 2 项（1 / 4）→ 待 v0.1 demo 验证**。**未触达"3 条以上不成立则回退"红线**。

---

## 6. 风险与已知坑

### 6.1 服务名稳定性风险

- 服务名（`'subagents'` / `'sessions'` / `'sessionQuery'` / `'sessionProjections'` / `'sessionProjectionCache'` / `'agents'`）由 DSH 主仓锁定；skyaxis 钉钉 `dsh-v0.1.5-rc.2`（commit `fb2c4b9`），升级时**所有 6 个服务名必须重新核对**
- 缓解：v0.1 第一周把 6 个服务名硬编码到 skyaxis 仓 `src/constants/dsh-services.ts`，加单测断言

### 6.2 type-only 导入的运行时风险

- DSH `package.json` 用 `"exports"` 字段暴露类型；skyaxis 消费 `import type` 走 TypeScript 编译路径，**不经过运行时**——但 tsdown 打包时需确认类型不漏到 bundle
- 缓解：skyaxis `tsdown.config.ts` 配置 `dts: true` + `external: ['@deepseek-ai/dsh-*']`（运行时从宿主 DSH 解析）

### 6.3 `ctx.inject` 的拓扑敏感

- DSH `packages/AGENTS.md`：`ctx.<name>` 是 property proxy，topology-sensitive；只在 `inject` 声明过的服务上可用
- 缓解：skyaxis 仓 `apply(ctx)` 顶层 `ctx.inject(['subagents', 'sessions', 'sessionQuery', 'sessionProjections', 'sessionProjectionCache', 'agents'])`；可选服务用 `ctx.get(name)`

### 6.4 cordis 副作用边界

- DSH `packages/AGENTS.md`：`Optional services use ctx.get(name). Reserve ctx.<name> for declared injections`
- 缓解：skyaxis 自写代码全部用 `ctx.get(name)`（明确不假设注入），避免 property proxy 触发的拓扑敏感抛错

### 6.5 workspace 协议依赖

- ADR 0010 已识别：skyaxis 发到 npm 后 `workspace:^` 协议无法解析
- 缓解：v0.1 demo 期间保持 monorepo 内（pnpm workspaces）；发包前替换为精确版本

---

## 7. 后续动作

### 7.1 v0.1 第一周交付清单（依赖本调研）

| # | 动作 | 输出位置 | 阻塞本调研? |
| --- | --- | --- | --- |
| 1 | skyaxis 仓 `package.json` 依赖列表 | `package.json` | ✅ 依赖本调研 4.1 节 |
| 2 | skyaxis 仓 `src/constants/dsh-services.ts`（6 个服务名常量） | `src/constants/` | ✅ 依赖本调研 6.1 节 |
| 3 | `verify-skyaxis-readonly` oxlint 规则（扫描第 3.1 / 3.2 节的禁止调用） | `scripts/verify-skyaxis-readonly.ts` + `.oxlintrc.cjs` | ✅ 依赖本调研第 3 节 |
| 4 | trajectory merger 设计 ADR（候选 ADR 0012）| `docs/decisions/0012-trajectory-merger-设计.md` | ✅ 依赖本调研第 5 节 |

### 7.2 v0.1 第二周交付清单

| # | 动作 | 输出位置 |
| --- | --- | --- |
| 5 | `apply(ctx)` 注入声明 + cordis 入口骨架 | `src/host/apply.ts` |
| 6 | client 半入口（`exports["./client"]`）+ Slot 注入样板 | `src/client/index.ts` |
| 7 | Zustand store 骨架（6 个 slice：session / catalog / projection / mergedTrajectory / decision / snippet） | `src/client/stores/` |
| 8 | React Flow 拓扑画布组件骨架 | `src/client/components/TopologyCanvas.tsx` |

### 7.3 待新开 ADR 候选

| 候选编号 | 主题 | 何时启动 |
| --- | --- | --- |
| ADR 0011 | DSH 版本兼容策略 | DSH 升级时（v0.1 末期评估）|
| ADR 0012 | trajectory merger 设计（伪代码 → TS 实现）| v0.1 第二周 |
| ADR 0013 | skyaxis 仓架构（host 半 / client 半 / 包结构）| v0.1 第二周 |

---

## 8. 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-19 | 初版。基于 DSH 仓 root（`packages/core/session/`、`packages/session/session-projection/`、`packages/session/session-projection-cache/`、`packages/session-query/session-query/`、`packages/subagent/subagent/`、`packages/core/agent/`、`vendor/cordis/`、`packages/client/ui-subagent/`）只读调研，覆盖 6 个只读服务的消费路径 + observe-only 边界 + 类型导出 + trajectory merger 候选 API。覆盖 ADR 0009 假设 2 / 3 / 5 / 8；间接覆盖 6 / 7；待 v0.1 demo 验证 1 / 4。**未触达"3 条以上不成立则回退"红线**。 |

---

## 9. 相关 ADR / 文档

- [ADR 0001 — 形态：DSH 独立插件](decisions/0001-形态-dsh插件.md)
- [ADR 0007 — 长期规划与里程碑](decisions/0007-长期规划与里程碑.md)
- [ADR 0009 — subagent 拓扑可视化：MVP 范围与轨迹合并策略](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)
- [ADR 0010 — 技术选型：MVP 实施期](decisions/0010-技术选型-MVP实施期.md)
- [调研报告 — DSH Sub-Agent 深度调研](research/0009-dsh-subagent-reference.md)
- [docs/domain/glossary.md](domain/glossary.md)
- [docs/scope/mvp-features.md](scope/mvp-features.md)
- [CLAUDE.md](../CLAUDE.md)
- [DSH AGENTS.md（DSH 仓根）](../deepseek-harness/AGENTS.md)（只读参考）
- [DSH packages/AGENTS.md](../deepseek-harness/packages/AGENTS.md)（只读参考）