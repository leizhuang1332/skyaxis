# Trajectory Merger 算法细化 — 调研报告

| 字段 | 值 |
| --- | --- |
| **调研目标** | 把 [research/dsh-consume-map.md § 5](dsh-consume-map.md) 的 4 种合并路径伪代码细化到"可直接对照实现"的字段表 + 算法步骤 + 边界条件 |
| **覆盖** | 数据源契约（精确字段表）/ 输入输出 TypeScript 接口 / 4 路径合并算法详细步骤 / turn 边界分组 / 增量更新 / React Flow node-edge 映射 / 边界条件与错误处理 / N=64 性能预算 |
| **调研对象** | [`deepseek-harness/packages/core/session/src/types.ts`](../deepseek-harness/packages/core/session/src/types.ts) + [`packages/session-query/session-query/src/index.ts`](../deepseek-harness/packages/session-query/session-query/src/index.ts) + [`packages/core/session/src/known-event-types.ts`](../deepseek-harness/packages/core/session/src/known-event-types.ts) + [`packages/subagent/subagent/src/index.ts`](../deepseek-harness/packages/subagent/subagent/src/index.ts)（只读访问）|
| **日期** | 2026-09-19 |
| **前置调研** | [research/dsh-consume-map.md § 2.3 + § 5](dsh-consume-map.md) / [research/dsh-workspace-integration.md](dsh-workspace-integration.md) / [research/skyaxis-panel-architecture.md](skyaxis-panel-architecture.md) |

---

## 1. 调研范围与方法

### 1.1 范围

把 trajectory merger 从"伪代码参考"细化到"可对照实现"。覆盖：

- **数据源契约**：精确字段（`SessionEvent.time` / `seq` / `type`；`SessionHeader.parentSession` / `delegationDepth` / `agentPreset`；`SubagentListEntry` / `SubagentDescendantListEntry`）
- **输入输出 TypeScript 接口**：可直接落到 skyaxis 仓 `src/client/merger/types.ts`
- **4 路径合并算法详细步骤**：live single / live multi / cold single / cold multi
- **turn 边界分组**：基于 `turn/start` ↔ `turn/end` 的事件配对算法
- **增量更新**：live lease 的增量推送 + cold snapshot 的全量替换
- **React Flow 映射**：merger 输出 → React Flow nodes + edges
- **边界条件**：cycle detection / 空 session / 时钟漂移 / session dispose 中
- **N=64 性能预算**：[ADR 0009 第 9.4 节](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md) 的 N=64 边界

**不**研究：

- 拓扑图 React Flow 内部（[ADR 0010](decisions/0010-技术选型-MVP实施期.md) 锁定 React Flow）
- 6 只读服务消费路径（已锁 [research/dsh-consume-map.md](dsh-consume-map.md)）

### 1.2 方法

只读访问 [`packages/core/session/src/types.ts`](../deepseek-harness/packages/core/session/src/types.ts)（`SessionEvent` / `SessionHeader` / `SessionEventMap`）、[`packages/session-query/session-query/src/index.ts`](../deepseek-harness/packages/session-query/session-query/src/index.ts)（14 个公共方法）、[`packages/core/session/src/known-event-types.ts`](../deepseek-harness/packages/core/session/src/known-event-types.ts)（turn 边界类型）。

### 1.3 关键引用清单

| 文档 | 用途 |
| --- | --- |
| [`packages/core/session/src/types.ts:93-101`](../deepseek-harness/packages/core/session/src/types.ts#L93-L101) | `SessionHeader` 字段（`createdAt` / `parentSession` / `isSeeded` / `origin` / `delegationDepth` / `agentPreset`）|
| [`packages/core/session/src/types.ts:465-475`](../deepseek-harness/packages/core/session/src/types.ts#L465-L475) | `SessionEvent` 字段（`time` / `seq` / `type` / `envelope`）|
| [`packages/core/session/src/types.ts:269-300`](../deepseek-harness/packages/core/session/src/types.ts#L269-L300) | `SessionEventMap`（`turn/start` / `turn/end` / `subagent/*` / 等）|
| [`packages/core/session/src/types.ts:200-210`](../deepseek-harness/packages/core/session/src/types.ts#L200-L210) | `TurnEndReasonMap`（turn 终止原因）|
| [`packages/session-query/session-query/src/index.ts`](../deepseek-harness/packages/session-query/session-query/src/index.ts) | `observeSession` / `readSession` / `listEvents` / `traceSession` 14 个公共方法 |
| [`packages/subagent/subagent/src/index.ts`](../deepseek-harness/packages/subagent/subagent/src/index.ts) | `listChildren` / `listDescendants` / `start` / `interrupt` 等 |

---

## 2. 数据源契约（精确字段表）

### 2.1 `SessionHeader`（`@deepseek-harness/packages/core/session/src/types.ts:93-101`）

| 字段 | 类型 | 含义 | skyaxis 用法 |
| --- | --- | --- | --- |
| `id` | `SessionId`（branded `string`）| 唯一标识 | 节点 id / `_origin.sessionId` |
| `createdAt` | `number` | Unix epoch ms 创建时间 | 节点 `createdAt` 时间戳 |
| `parentSession` | `SessionId \| null` | 父 session（subagent 关系）| React Flow edge `source → target` |
| `isSeeded` | `boolean` | 是否 seed session | 区分 root / 派生 |
| `origin` | `string` | session 来源描述 | 节点 `origin` metadata |
| `delegationDepth` | `number` | 派生深度（root = 0）| 拓扑层级（与 `subagents.listDescendants` 的 `depth` 等价）|
| `agentPreset` | `string` | 使用的 agent preset 名 | 节点 `preset` metadata |
| `seq` | `SessionSeq`（branded `number`）| 当前 seq cursor | merger 增量推送起点 |

**关键观察**：

- `delegationDepth` 已内嵌在 `SessionHeader`——skyaxis 不需要单独维护 depth
- `parentSession` 是 subagent 父关系的**权威源**（DSH 维护）

### 2.2 `SessionEvent`（`packages/core/session/src/types.ts:465-475`）

| 字段 | 类型 | 含义 | skyaxis 用法 |
| --- | --- | --- | --- |
| `time` | `number` | Unix epoch ms | **合并排序的主键** |
| `seq` | `SessionSeq` | session 内事件序号 | per-session 排序 |
| `type` | `keyof SessionEventMap` | 事件类型 | 决定是否 turn 边界 / 节点 metadata |
| `envelope` | `{ ignorable?: boolean }` | 包络元数据 | 过滤 ignorable events |
| `data` | `unknown`（merge-extensible）| 类型相关数据 | 按 `type` 解析 |

**关键观察**：

- **`time: number` 是 Unix epoch ms**（[types.ts:470-471](../deepseek-harness/packages/core/session/src/types.ts#L470-L471)）——可直接做时间排序
- `data` 是 `unknown`——必须按 `type` 派发到具体处理函数
- `envelope.ignorable` 标记的事件（[known-event-types.ts:11-17](../deepseek-harness/packages/core/session/src/known-event-types.ts#L11-L17)）**必须跳过**（DSH 内部事件）

### 2.3 `SessionEventMap` 关键事件（trajectory merger 相关）

来源：[types.ts:269-300](../deepseek-harness/packages/core/session/src/types.ts#L269-L300) + [known-event-types.ts:75-76](../deepseek-harness/packages/core/session/src/known-event-types.ts#L75-L76)：

| `type` | `data` | 用途 |
| --- | --- | --- |
| `turn/start` | `{ turn: number }` | **turn 边界起点** |
| `turn/end` | `{ turn: number; reason: TurnEndReason }` | **turn 边界终点**（reason ∈ `TurnEndReasonMap`）|
| `message/user` | `{ content: ... }` | 用户输入 turn 内容 |
| `message/assistant` | `{ content: ... }` | 助手输出 turn 内容 |
| `tool/call` | `{ name: string; input: ... }` | turn 内的 tool 调用（task DAG 节点源）|
| `tool/result` | `{ output: ... }` | tool 调用结果 |
| `subagent/start` | `{ subagent: SubagentAddress }` | subagent 派生（live event）|
| `subagent/end` | `{ subagent: SubagentAddress; reason: ... }` | subagent 终止（live event）|
| `subagent/tool` | `{ subagent: ...; tool: ... }` | subagent 内 tool（[research/0009-dsh-subagent-reference.md](research/0009-dsh-subagent-reference.md) 调研）|

**关键观察**：

- turn 边界由 `turn/start` + `turn/end` **配对**形成（turn number 匹配）
- `subagent/start` / `subagent/end` 是 **scope-filtered dispatch**（[research/dsh-consume-map.md § 2.1](dsh-consume-map.md) 已识别）——skyaxis 需用 `ctx.inject(['subagents'])` 监听

### 2.4 `SubagentListEntry` / `SubagentDescendantListEntry`

来源：[packages/subagent/subagent/src/index.ts](../deepseek-harness/packages/subagent/subagent/src/index.ts)（已在 [research/dsh-consume-map.md § 2.1](dsh-consume-map.md) 盘点）：

| 字段（`SubagentListEntry`） | 含义 |
| --- | --- |
| `sessionId` | subagent session id |
| `parentSession` | 父 session id（隐含） |
| `origin` | 来源描述 |
| `running` | boolean（live）|
| `mode` | `'one-shot' \| 'continuable' \| ...` |
| `label` | 人类可读标签 |
| `provider` | provider 名 |
| `createdAt` | Unix epoch ms |

| 字段（`SubagentDescendantListEntry`） | 在前者基础上加 |
| --- | --- |
| `parentId` | 直接父 id |
| `depth` | pre-order DFS 深度 |

**关键观察**：

- `depth` 来自 `listDescendants` 自身——**不依赖 `SessionHeader.delegationDepth`**
- 两套 depth 字段冗余但等价；merger 优先用 `listDescendants.depth`（API 给出更稳定）

---

## 3. 输入输出 TypeScript 接口（draft ADR 0012 候选）

> ⚠️ 本节是 draft，**不进入 skyaxis 仓代码**。v0.1 第二周新开 ADR 0012 锁定细节。

### 3.1 输出数据结构

```ts
// packages/plugin/src/client/merger/types.ts (draft)

import type { SessionId, SessionEvent, SessionHeader, SessionSeq } from '@deepseek-ai/dsh-session'
import type { SubagentDescendantListEntry } from '@deepseek-ai/dsh-subagent'

/** 时间窗口边界（Unix epoch ms） */
export interface TimeWindow {
  readonly start: number
  readonly end: number
}

/** 事件来源标记（合并后保留） */
export interface EventOrigin {
  readonly sessionId: SessionId
  /** 拓扑层级（0 = root） */
  readonly depth: number
  /** 直接父 sessionId（root = null） */
  readonly parentId: SessionId | null
  /** subagent 标签（人类可读） */
  readonly label: string | null
  /** subagent provider 名 */
  readonly provider: string | null
  /** 该 session 是否 live（true）/ cold（false） */
  readonly live: boolean
}

/** 带 origin 标记的事件（merger 中间产物） */
export interface AnnotatedEvent {
  readonly event: SessionEvent
  readonly origin: EventOrigin
  /** per-session seq（保留原 SessionEvent.seq） */
  readonly seq: SessionSeq
}

/** turn 边界分组（基于 turn/start ↔ turn/end 配对） */
export interface MergedTurn {
  readonly turnNumber: number
  readonly startTime: number
  readonly endTime: number | null   // 未结束则为 null（live in-progress）
  readonly endReason: TurnEndReason | null
  readonly events: readonly AnnotatedEvent[]
  /** 该 turn 所属 session 的 id（用于聚合 session 内 turn） */
  readonly primarySessionId: SessionId
  /** 该 turn 内涉及的 session 列表（含 subagent） */
  readonly involvedSessions: readonly SessionId[]
}

/** trajectory merger 最终输出 */
export interface MergedTrajectory {
  /** 拓扑根（root session header） */
  readonly root: SessionHeader
  /** 所有 session header（含 subagent） */
  readonly headers: ReadonlyMap<SessionId, SessionHeader>
  /** 所有事件（按 .time 全局排序） */
  readonly events: readonly AnnotatedEvent[]
  /** turn 分组（按 .time 排序；live in-progress 在末尾） */
  readonly turns: readonly MergedTurn[]
  /** 时间窗口 */
  readonly window: TimeWindow
  /** 生成时间戳（merger 本地） */
  readonly generatedAt: number
  /** 数据版本（live lease version 或 cold snapshot version） */
  readonly dataVersion: number
}
```

### 3.2 merger 函数签名

```ts
// packages/plugin/src/client/merger/mergeTrajectories.ts (draft)

export type MergerPath = 'live-single' | 'live-multi' | 'cold-single' | 'cold-multi'

export interface MergerOptions {
  /** 拓扑根 id（multi path 必填；single path 可省） */
  readonly rootSessionId?: SessionId
  /** 显式指定 session id 列表（multi path 可省；省略时由 rootSessionId 派生） */
  readonly explicitSessionIds?: readonly SessionId[]
  /** turn 边界过滤：忽略的 turn type */
  readonly skipTurnTypes?: readonly string[]
  /** 时间窗口过滤（Unix epoch ms；inclusive） */
  readonly timeWindow?: TimeWindow
  /** AbortSignal：取消 live 等待 */
  readonly signal?: AbortSignal
}

export interface MergerResult {
  readonly trajectory: MergedTrajectory
  /** live path：caller-owned lease（必须 dispose） */
  readonly leases: readonly SessionObservation[]
  /** 触发刷新事件订阅（如 'subagent/start'）的 dispose 函数 */
  readonly disposers: readonly (() => void)[]
}

export async function mergeTrajectories(
  ctx: ClientContext,
  options: MergerOptions,
): Promise<MergerResult>
```

### 3.3 增量更新接口（live path）

```ts
// packages/plugin/src/client/merger/incremental.ts (draft)

export interface IncrementalMerger {
  /** 当前 trajectory snapshot */
  readonly snapshot: () => MergedTrajectory
  /** 订阅变化（增量事件） */
  readonly subscribe: (listener: (next: MergedTrajectory) => void) => () => void
  /** dispose：释放 leases + disposers */
  readonly dispose: () => void
  /** 数据来源路径 */
  readonly path: MergerPath
}

export function createIncrementalMerger(
  ctx: ClientContext,
  options: MergerOptions,
): Promise<IncrementalMerger>
```

---

## 4. 4 路径合并算法详细步骤

### 4.1 路径 A：live-single（单 live session 实时轨迹）

**输入**：单个 live `SessionId`
**数据源**：`ctx.sessionQuery.observeSession(id)` → `SessionObservation`（live lease）
**输出**：`MergedTrajectory`（root = 该 session；events = 该 session 全 events；turns = 全 turns）

```ts
async function mergeLiveSingle(ctx: ClientContext, id: SessionId, options: MergerOptions): Promise<MergerResult> {
  // Step 1: observeSession 拿 caller-owned lease
  const observation = await ctx.sessionQuery.observeSession(id, { signal: options.signal })
  
  // Step 2: 读 header + events
  const header = observation.session  // SessionHeader（live lease 自带）
  const events = await observation.events()  // SessionEvent[]
  
  // Step 3: 过滤 + 标注 origin
  const annotated: AnnotatedEvent[] = events
    .filter(e => !e.envelope?.ignorable)
    .filter(e => inTimeWindow(e.time, options.timeWindow))
    .map(e => ({
      event: e,
      origin: {
        sessionId: id,
        depth: 0,                          // single path = depth 0
        parentId: header.parentSession,
        label: null,
        provider: null,
        live: true,
      },
      seq: e.seq,
    }))
  
  // Step 4: 全局排序（按 .time 升序）
  annotated.sort((a, b) => a.event.time - b.event.time)
  
  // Step 5: turn 边界分组
  const turns = groupTurnsByBoundary(annotated)
  
  // Step 6: 返回结果
  return {
    trajectory: {
      root: header,
      headers: new Map([[id, header]]),
      events: annotated,
      turns,
      window: { start: annotated[0]?.event.time ?? header.createdAt, end: annotated.at(-1)?.event.time ?? header.createdAt },
      generatedAt: Date.now(),
      dataVersion: observation.version ?? 0,
    },
    leases: [observation],
    disposers: [],
  }
}
```

**复杂度**：O(n log n) 排序 + O(n) 分组 = **O(n log n)**（n = 该 session events 总数）

### 4.2 路径 B：live-multi（多 session 实时轨迹合并——**SUB.1 多 root 并列场景**）

**输入**：root `SessionId`（自动派生所有 descendant sessionIds）
**数据源**：`ctx.subagents.listDescendants(rootId)` → 拓扑 → `ctx.sessionQuery.observeSession(id)` 每个 session
**输出**：`MergedTrajectory`（events 已按 `.time` 全局排序；turns 含多 session 的 events）

```ts
async function mergeLiveMulti(ctx: ClientContext, rootId: SessionId, options: MergerOptions): Promise<MergerResult> {
  // Step 1: 拿完整拓扑（pre-order DFS）
  const descendants = await ctx.subagents.listDescendants(rootId, options.signal)
  const allSessionIds = [rootId, ...descendants.map(d => d.sessionId)]
  
  // Step 2: 并发 observeSession（live leases）
  const observations = await Promise.all(
    allSessionIds.map(async id => {
      const obs = await ctx.sessionQuery.observeSession(id, { signal: options.signal }).catch(() => null)
      if (obs === null) return null  // cold fallback
      return { id, observation: obs }
    })
  )
  
  // Step 3: 收集 header + events（含 depth / parentId / label 标注）
  const annotated: AnnotatedEvent[] = []
  const headers = new Map<SessionId, SessionHeader>()
  const depthMap = new Map<SessionId, number>([[rootId, 0]])
  const parentMap = new Map<SessionId, SessionId | null>([[rootId, null]])
  const labelMap = new Map<SessionId, string | null>()
  
  for (const { id, observation } of observations.filter(o => o !== null)) {
    const header = observation.observation.session
    headers.set(id, header)
    
    // 找对应的 descendant（root = depth 0）
    if (id !== rootId) {
      const desc = descendants.find(d => d.sessionId === id)
      if (desc) {
        depthMap.set(id, desc.depth)
        parentMap.set(id, desc.parentId ?? null)
        labelMap.set(id, desc.label ?? null)
      }
    }
    
    // 读 events
    const events = await observation.observation.events()
    for (const e of events) {
      if (e.envelope?.ignorable) continue
      if (!inTimeWindow(e.time, options.timeWindow)) continue
      annotated.push({
        event: e,
        origin: {
          sessionId: id,
          depth: depthMap.get(id) ?? 0,
          parentId: parentMap.get(id) ?? null,
          label: labelMap.get(id) ?? null,
          provider: null,  // listDescendants 不返回 provider，需要从 projection 补
          live: true,
        },
        seq: e.seq,
      })
    }
  }
  
  // Step 4: 全局排序（按 .time 升序；同 time 按 seq 保序）
  annotated.sort((a, b) => {
    const timeDelta = a.event.time - b.event.time
    if (timeDelta !== 0) return timeDelta
    return (a.event.seq as number) - (b.event.seq as number)
  })
  
  // Step 5: turn 边界分组
  const turns = groupTurnsByBoundary(annotated)
  
  // Step 6: 订阅增量推送（live lease 自带 listener）
  const disposers: (() => void)[] = []
  for (const { observation } of observations.filter(o => o !== null)) {
    const off = observation.subscribe((newEvents: SessionEvent[]) => {
      // 增量追加 → 重新排序 + 重新分组（debounced）
      onIncrementalUpdate(newEvents, ...)
    })
    disposers.push(off)
  }
  
  // Step 7: 返回
  return {
    trajectory: {
      root: headers.get(rootId)!,
      headers,
      events: annotated,
      turns,
      window: { start: annotated[0]?.event.time ?? 0, end: annotated.at(-1)?.event.time ?? 0 },
      generatedAt: Date.now(),
      dataVersion: 0,
    },
    leases: observations.filter(o => o !== null).map(o => o!.observation),
    disposers,
  }
}
```

**复杂度**：O(N·n log(n))——N 个 session 各 n 个 events，per-session 排序 N·O(n log n)；全局合并 N·O(n log n)；N ≤ 64（[ADR 0009 第 9.4 节](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)）。

### 4.3 路径 C：cold-single（单 persisted session 冷读）

**输入**：单个 cold/persisted `SessionId`（已 disposed）
**数据源**：`ctx.sessionQuery.readSession(id)` → `SessionLogSnapshot`
**输出**：与路径 A 同结构，`origin.live = false`

```ts
async function mergeColdSingle(ctx: ClientContext, id: SessionId, options: MergerOptions): Promise<MergerResult> {
  const snapshot = await ctx.sessionQuery.readSession(id)
  
  const annotated: AnnotatedEvent[] = snapshot.events
    .filter(e => !e.envelope?.ignorable)
    .filter(e => inTimeWindow(e.time, options.timeWindow))
    .map(e => ({
      event: e,
      origin: {
        sessionId: id,
        depth: 0,
        parentId: snapshot.session.parentSession,
        label: null,
        provider: null,
        live: false,
      },
      seq: e.seq,
    }))
  
  annotated.sort((a, b) => a.event.time - b.event.time)
  const turns = groupTurnsByBoundary(annotated)
  
  return {
    trajectory: {
      root: snapshot.session,
      headers: new Map([[id, snapshot.session]]),
      events: annotated,
      turns,
      window: { start: annotated[0]?.event.time ?? snapshot.session.createdAt, end: annotated.at(-1)?.event.time ?? snapshot.session.createdAt },
      generatedAt: Date.now(),
      dataVersion: -1,  // cold marker
    },
    leases: [],
    disposers: [],
  }
}
```

**复杂度**：O(n log n)，n = persisted events 总数。

### 4.4 路径 D：cold-multi（多 persisted session 冷读合并——**多 session 总览场景**）

**输入**：root `SessionId` + cold fallback
**数据源**：`ctx.sessionQuery.listSessions()` → 全部 session → 过滤 root 的 descendants → `ctx.sessionQuery.readSession(id)` 每个
**输出**：与路径 B 同结构，所有 `origin.live = false`

```ts
async function mergeColdMulti(ctx: ClientContext, rootId: SessionId, options: MergerOptions): Promise<MergerResult> {
  // Step 1: 拿所有 session 记录（含冷态）
  const allRecords = await ctx.sessionQuery.listSessions(options.signal)
  
  // Step 2: 用 traceSession 找 root 的 descendants（替代 subagents.listDescendants，cold 路径）
  const trace = await ctx.sessionQuery.traceSession(rootId, options.signal)
  const descendantIds = new Set(trace.descendants?.map(d => d.id) ?? [])
  descendantIds.add(rootId)
  
  // Step 3: 并发 readSession（cold snapshot）
  const snapshots = await Promise.all(
    [...descendantIds].map(async id => {
      const snap = await ctx.sessionQuery.readSession(id).catch(() => null)
      return snap === null ? null : { id, snapshot: snap }
    })
  )
  
  // Step 4-7: 同路径 B（仅 `live = false` + 无 leases / disposers）
  // ...（省略重复）
}
```

**复杂度**：O(N·n log n)，N = descendants 总数；冷态数据通常比 live 大，需考虑虚拟滚动 + 增量加载。

---

## 5. turn 边界分组算法

### 5.1 算法目标

把全局排序后的 `AnnotatedEvent[]` 按 turn 边界（`turn/start` ↔ `turn/end` 配对）分组为 `MergedTurn[]`。

### 5.2 turn 配对规则

来源：[types.ts:269-300](../deepseek-harness/packages/core/session/src/types.ts#L269-L300)：

- `turn/start.data.turn: number`（turn 序号，per-session 单调递增）
- `turn/end.data.turn: number`（匹配同 turn number）+ `reason: TurnEndReason`

**配对策略**：

```
for each turn_number n across all sessions:
  find first turn/start with turn=n        → turn opens
  find first turn/end with turn=n          → turn closes
  events between these two markers (inclusive) → MergedTurn.events
  if turn/end not found (live in-progress) → endTime = null, endReason = null
```

### 5.3 turn 跨 session 处理

**问题**：subagent 的 turn 可能在不同 session 的 events 流中。

**策略**：turnNumber 是 per-session 的，**不做跨 session 配对**——一个 MergedTurn 对应一个 session 的一个 turn。

```ts
function groupTurnsByBoundary(annotated: readonly AnnotatedEvent[]): MergedTurn[] {
  // Step 1: per-session 重新分组（origin.sessionId + turnNumber 二维 key）
  const turnsByKey = new Map<string, MergedTurn>()
  
  for (const ae of annotated) {
    const e = ae.event
    if (e.type === 'turn/start') {
      const turnNumber = (e.data as { turn: number }).turn
      const key = `${ae.origin.sessionId}:${turnNumber}`
      turnsByKey.set(key, {
        turnNumber,
        startTime: e.time,
        endTime: null,
        endReason: null,
        events: [],
        primarySessionId: ae.origin.sessionId,
        involvedSessions: [ae.origin.sessionId],
      })
    } else if (e.type === 'turn/end') {
      const turnNumber = (e.data as { turn: number }).reason
      const key = `${ae.origin.sessionId}:${turnNumber}`
      const turn = turnsByKey.get(key)
      if (turn) {
        turnsByKey.set(key, { ...turn, endTime: e.time, endReason: (e.data as any).reason })
      }
    } else {
      // 普通事件：append 到当前 session 的当前 turn
      const turnNumber = inferCurrentTurn(ae.origin.sessionId, ae.event.time, annotated)
      const key = `${ae.origin.sessionId}:${turnNumber}`
      const turn = turnsByKey.get(key)
      if (turn) {
        turn.events.push(ae)
      } else {
        // turn 没显式 start（异常情况）：建一个虚拟 turn
        // ...
      }
    }
  }
  
  // Step 2: 收集 + 全局按 startTime 排序
  return [...turnsByKey.values()].sort((a, b) => a.startTime - b.startTime)
}
```

**复杂度**：O(n) 单次扫描 + 排序 O(t log t)，t = turns 总数。

### 5.4 live in-progress turn

**特征**：`turn/end` 未到，`endTime = null`，`endReason = null`。

**处理**：UI 显示"进行中"标识；merger 每次增量推送后重算 turns；live lease 收到新 `turn/end` 时填上 endTime。

---

## 6. 增量更新机制（live path）

### 6.1 增量事件来源

`SessionObservation.subscribe(listener)` 接收 `SessionEvent[]`（live lease 自带）。

**触发条件**：

- 新 event 追加（`session/event` 触发）
- session dispose（lease 自动 abort）
- projection 变化（不直接触发 observer，skyaxis 用 `projection.onChanged` 单独订阅）

### 6.2 增量更新算法

```ts
function onIncrementalUpdate(newEvents: SessionEvent[], sessionId: SessionId, merger: IncrementalMerger) {
  // Step 1: 过滤 ignorable + timeWindow
  const filtered = newEvents.filter(/* ... */)
  
  // Step 2: 追加到当前 snapshot（不重排序整列，只追加 + 二分插入）
  const current = merger.snapshot()
  const updated = mergeNewEvents(current.events, filtered, sessionId)
  
  // Step 3: 重新分组 turns（仅受影响的 turn）
  const affectedTurns = inferAffectedTurns(updated)
  const updatedTurns = recomputeTurns(current.turns, affectedTurns)
  
  // Step 4: 更新 snapshot + 通知 listener
  merger._updateSnapshot({
    ...current,
    events: updated,
    turns: updatedTurns,
    dataVersion: current.dataVersion + 1,
    generatedAt: Date.now(),
  })
}
```

**优化点**：

- **debounce 50-200ms**：高频事件流（subagent tool calls）做批量更新
- **二分插入**：新 events 按 `.time` 插入已排序列表，不重排整列
- **增量 turn recompute**：仅受新 events 影响的 turn 重新计算，其他 turn 复用

### 6.3 cold path 无增量

cold path（`readSession`）是全量 snapshot，不支持增量。UI 切换 live ↔ cold 时做全量替换。

---

## 7. 与 React Flow nodes/edges 的映射

### 7.1 节点映射

每个 `MergedTurn` 映射到一个 React Flow node：

| MergedTurn 字段 | React Flow Node 字段 |
| --- | --- |
| `primarySessionId` | `node.id` |
| `startTime` | `node.data.startTime` |
| `endTime` | `node.data.endTime` |
| `endReason` | `node.data.status: 'running' \| 'settled'`（`endTime === null` → `running`）|
| `turnNumber` | `node.data.turnNumber` |
| `events.length` | `node.data.eventCount` |
| `origin.depth` | `node.data.depth`（层级布局）|
| `origin.parentId` | `node.data.parentSessionId`（parent edge 起点）|

### 7.2 边映射

| 边类型 | 源 | 目标 | 样式 |
| --- | --- | --- | --- |
| **subagent 父子** | subagent 的 root turn | 父 session 的对应 turn | 实线（自动推断）|
| **session 间依赖（D2.4）** | 主动声明的契约 | — | 虚线（手动）|
| **同 session turn 顺序** | turn N | turn N+1 | 默认边 |

### 7.3 SUB.1 多 root 并列画布

**场景**：多 session 同时活跃（剧本 1）。

**React Flow 布局**：

- 每 root session 一个独立 React Flow 实例（避免节点过多）
- 共享一个 `skyaxisStore`（Zustand）的拓扑选择状态
- 节点 = session-level（不展开到 turn），点击展开到 turn 级

### 7.4 节点状态机映射

来源：[research/dsh-ui-primitives-reuse.md § 3.7](dsh-ui-primitives-reuse.md) + [ADR 0009 § 9.2](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)：

| MergedTurn.endTime | `StateDot.state` | UI |
| --- | --- | --- |
| `null` | `'running'` | 蓝点 + spinning |
| `<= Date.now() - 5min` | `'settled'`（success）| 灰点 |
| `reason = 'aborted'` | `'error'` | 红点 |
| `reason = 'tool-failure'` | `'error'` | 红点 |

---

## 8. 边界条件与错误处理

### 8.1 cycle detection

**场景**：subagent 派生链 A → B → C → A（环）。

**DSH 行为**（`traceSession`）："throws when ... the target is absent, or its known ancestry cycles"（[dsh-consume-map.md § 5.3 假设 8](dsh-consume-map.md)）。

**merger 处理**：

```ts
try {
  const descendants = await ctx.subagents.listDescendants(rootId, signal)
  // 正常返回
} catch (error) {
  if (error.code === 'SUBSAGENT_CYCLE_DETECTED') {
    // 降级为单 session 视图（root only）
    return mergeLiveSingle(ctx, rootId, options)
  }
  throw error
}
```

### 8.2 空 session

**场景**：session 刚创建无 events / session 被 dispose 但未产生 events。

**merger 处理**：

- `events = []` → `turns = []` → UI 显示"无活动"
- `window = { start: createdAt, end: createdAt }`

### 8.3 时钟漂移

**场景**：不同机器 / 子 session 时钟不同步（理论上 DSH 单进程不会发生，但 root session 跨进程派生可能）。

**merger 处理**：

- 主排序键 `.time`（来自 SessionEvent）
- 退路：同 `.time` 按 `seq` 保序（per-session 单调）
- **不**用 `Date.now()`（merger 本地时钟）参与排序

### 8.4 session dispose 中

**场景**：merger live 时某 session dispose（`session/disposed` 事件）。

**merger 处理**：

- `observation.subscribe` 回调收到 `null`/`disposed` 信号
- lease 自动 abort
- 把该 session 的 events 标记 `origin.live = false`（降级为 cold view）
- 不重排序，仅更新 status

### 8.5 部分 session 不可读

**场景**：cold session 在 persistence 失败 / live session 在 race window 不可 observe。

**merger 处理**：

```ts
const observations = await Promise.all(
  allSessionIds.map(async id => {
    try {
      return await ctx.sessionQuery.observeSession(id, options)
    } catch (e) {
      // fallback to cold
      try {
        return { id, observation: null, snapshot: await ctx.sessionQuery.readSession(id) }
      } catch {
        return null  // skip this session entirely
      }
    }
  })
)
```

**UI 表现**：该 session 显示"数据不可读"，其他 session 正常显示。

### 8.6 turn 边界缺失

**场景**：session 启动但无 `turn/start` / `turn/end`（自定义 session / 测试 fixture）。

**merger 处理**：

- 退路：所有 events 归入一个"unknown turn"（`turnNumber = -1`）
- UI 显示灰色节点 + "无 turn 信息"

---

## 9. N=64 性能预算

### 9.1 边界条件

[ADR 0009 第 9.4 节](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md) 锁定 skyaxis MVP 子阶段 N ≤ 64（每 root session 的 subagent 总数）。

**总事件数估算**：

- 64 个 session × 平均 200 events/session = 12,800 events
- 假设 10% 是 `turn/start`/`turn/end` = 1,280 turns

### 9.2 性能预算表

| 阶段 | 预算 | 备注 |
| --- | --- | --- |
| **首次合并（cold path）** | < 200ms | N=64 · 200 events；含 N+1 次 `readSession` 并发 |
| **首次合并（live path）** | < 500ms | N+1 次 `observeSession` 并发 |
| **增量更新（单事件）** | < 16ms（60fps）| 二分插入 + 局部 turn recompute |
| **增量更新（debounce 100ms 批）** | < 50ms | 一次 batch ≤ 100 events |
| **内存占用** | < 50MB | 12,800 events × 约 4KB/event |
| **React Flow 渲染** | < 100ms（首屏）| 用 viewport culling（默认 React Flow 支持）|

### 9.3 性能优化策略

- **虚拟滚动**：React Flow 内置 viewport culling
- **debounce**：增量事件 100ms 批量
- **memo**：turn / node 用 React.memo
- **selector 订阅**：Zustand selector 避免全局 re-render（已在 [research/skyaxis-panel-architecture.md § 4.2](skyaxis-panel-architecture.md) 锁定）
- **Web Worker**（可选）：大 N 时把 merging 移到 worker（v0.2 评估）

---

## 10. ADR 0009 假设覆盖度更新

| 假设 | 本调研相关 | 状态 |
| --- | --- | --- |
| 假设 2（subagents.listDescendants API）| ✅ 已用于多 root 派生 | 维持 [research/dsh-consume-map.md](dsh-consume-map.md) |
| 假设 3（observeSession vs readSession）| ✅ 已用于路径 A vs C 区分 | 维持 |
| 假设 5（type-only 导出路径）| ✅ 已用于 § 3 输入输出接口 | 维持 |
| 假设 8（traceSession cycle detection）| ✅ § 8.1 给出处理 | 维持 |
| 假设 4（N=64 性能预算）| ✅ § 9 给出详细预算 | **假设 4 事实基础已建立**（实测待 v0.1 demo） |
| **新假设 15**：turn 边界由 turn/start ↔ turn/end 配对 | ✅ § 5 给出配对算法 | **假设 15 暂成立**（实测待 v0.1） |
| **新假设 16**：subagent.start / subagent.end 是 scope-filtered dispatch，skyaxis 通过 inject 监听 | ⚠️ § 6.1 提到，但具体 scope filter 行为待实测 | **假设 16 暂成立** |
| **新假设 17**：不同 session 时钟一致（无 clock skew）| ⚠️ § 8.3 给出退路 | **假设 17 暂成立** |

**累计 ADR 0009 假设**：1 + 2-8 + 9 + 10 + 11 + 12 + 13 + 14 + **15 + 16 + 17** = 17 条。**未触达"3 条以上不成立则回退"红线**。

---

## 11. 关键风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| **R.1 DSH 升级 SessionEventMap 变化** | turn 边界类型扩展（如新增 `turn/abort`）| type-only import 锁定；v0.1 末尾实测 |
| **R.2 N=64 边界性能** | 大规模 session 时首次合并超 500ms | Web Worker（v0.2 评估）；debounce |
| **R.3 lease 内存泄漏** | live 路径忘了 dispose lease | IncrementalMerger 必须 dispose 时调用 `leases.forEach(l => l.dispose())`；vitest 测试 |
| **R.4 turn 配对异常** | turn/end 缺失 / 重复 / 跨 session | § 8.6 给出退路；UI 灰显 |
| **R.5 subagent.start scope filter 行为** | skyaxis 监听不到跨 scope 的事件 | § 10 假设 16 待实测；fallback 用 `subagents.listDescendants` 轮询 |
| **R.6 cold path 数据量爆炸** | 12,800 events × N root = 100MB+ | viewport culling + 按需 `readEvent` 拉详情 |
| **R.7 SessionObservation.subscribe 触发频率** | 高频事件导致 React re-render | debounce 100ms + selector 订阅 |
| **R.8 cross-session 同 turn 编号冲突** | turnNumber 是 per-session 单调，跨 session 不唯一 | § 5.3 用 `${sessionId}:${turnNumber}` 复合 key |

---

## 12. 后续动作（v0.1 第二周）

### 12.1 新开 ADR 0012

候选标题：`ADR 0012 — trajectory merger 设计（TS 接口 + 4 路径算法 + turn 边界分组 + 增量更新）`。

**内容引用本调研第 3-8 节**，把"draft"接口和算法 pseudocode 锁定为正式接口。

### 12.2 v0.1 第二周交付

| # | 动作 | 输出位置 | 依赖 |
| --- | --- | --- | --- |
| 1 | `merger/types.ts`（§ 3 接口定稿）| `packages/plugin/src/client/merger/` | ADR 0012 锁定 |
| 2 | `merger/mergeTrajectories.ts`（§ 4 4 路径算法实现）| 同上 | types.ts |
| 3 | `merger/groupTurnsByBoundary.ts`（§ 5 算法实现）| 同上 | types.ts |
| 4 | `merger/incremental.ts`（§ 6 增量更新）| 同上 | mergeTrajectories.ts |
| 5 | `merger/__tests__/mergeTrajectories.test.ts`（Vitest 单测）| `packages/plugin/tests/unit/merger/` | 全部 |
| 6 | skyaxisStore 集成 merger（§ 7 React Flow 映射）| `packages/plugin/src/client/state/skyaxisStore.ts` | merger 全部 |

### 12.3 v0.1 第二周测试用例

- **单元测试**（vitest）：
  - 单 session 200 events 排序 + turn 分组
  - 64 session × 200 events 合并 + 性能基准
  - cycle detection fallback
  - 空 session / turn 边界缺失 退路
  - cold → live 切换全量替换
- **集成测试**（DSH 启动链路）：
  - 启动 dsh web profile + 加载 cordis.patch.yml
  - 创建 3 个 root session，每个派生 2 个 subagent（共 9 session）
  - 触发 tool calls / subagent starts
  - 断言 merger 输出 events 数量 / turns 数量 / 时间排序

---

## 13. 一句话总结

> Trajectory merger 从伪代码细化到可对照实现：4 路径合并算法（live-single / live-multi / cold-single / cold-multi） + turn 边界配对算法 + 增量更新 + 8 类边界条件处理 + N=64 性能预算（首次合并 < 500ms / 增量 < 16ms / 内存 < 50MB）。新增 ADR 0009 假设 15 / 16 / 17 暂成立。**累计假设 17 条，未触达红线**。v0.1 第二周新开 ADR 0012 锁定接口与算法。

---

## 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-19 | 初版。基于 [`packages/core/session/src/types.ts`](../deepseek-harness/packages/core/session/src/types.ts) (`SessionEvent.time` Unix epoch ms / `seq` / `envelope.ignorable` / turn 边界) + [`packages/session-query/session-query/src/index.ts`](../deepseek-harness/packages/session-query/session-query/src/index.ts) 14 个方法 + [`packages/core/session/src/known-event-types.ts`](../deepseek-harness/packages/core/session/src/known-event-types.ts) 落地 4 路径合并算法详细步骤 + TypeScript 接口草案（不进入 skyaxis 仓）+ turn 配对算法 + 增量更新 + React Flow 映射 + 8 类边界条件 + N=64 性能预算 + 3 条新增 ADR 0009 假设。**累计 17 条假设，未触达红线**。 |

---

## 相关 ADR / 文档

- [ADR 0009 — subagent 拓扑可视化](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)
- [ADR 0010 — 技术选型](decisions/0010-技术选型-MVP实施期.md)
- [调研报告 — DSH 6 只读服务消费路径地图](dsh-consume-map.md)（§ 5 trajectory merger 候选 API）
- [调研报告 — DSH Workspace 协议与 monorepo 集成](dsh-workspace-integration.md)
- [调研报告 — DSH ui-primitives 复用清单](dsh-ui-primitives-reuse.md)
- [调研报告 — skyaxis 独立 panel 架构](skyaxis-panel-architecture.md)
- [调研报告 — DSH Sub-Agent 深度调研](research/0009-dsh-subagent-reference.md)
- [MVP 功能点拆解](../scope/mvp-features.md)
- [核心画像 A 的 5 个场景剧本](../users/persona-a-scenarios.md)
- [CLAUDE.md](../CLAUDE.md)
- [`packages/core/session/src/types.ts`](../deepseek-harness/packages/core/session/src/types.ts)
- [`packages/session-query/session-query/src/index.ts`](../deepseek-harness/packages/session-query/session-query/src/index.ts)
- [`packages/core/session/src/known-event-types.ts`](../deepseek-harness/packages/core/session/src/known-event-types.ts)
