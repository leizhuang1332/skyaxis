# DSH Session Projection 机制 + Cache Invalidation 深度调研 — 调研报告 7

| 字段 | 值 |
| --- | --- |
| **调研目标** | 把 DSH `ctx.sessionProjections` + `ctx.sessionProjectionCache` 两个 observe-only 只读服务的内部机制系统化，作为 SUB.5 session event 时间线"低成本订阅 UI 更新"的工程基础；并在 [调研报告 5 § 4](trajectory-merger-algorithm.md) 的 4 路径合并算法基础上补充第 5 路径（projection cached）|
| **覆盖** | SessionProjectionRegistry 5 大接口 + SessionProjectionCache 持久化层 + SessionSurfaceSnapshot 字段契约 + 5 类 cache 失效触发 + skyaxis 第 5 路径合并 + SUB.5 实时订阅 UI 更新 + v0.2 D2 SessionDependency 场景应用 + ADR 0009 假设清单新增 |
| **调研对象** | [`packages/session/session-projection/src/`](../deepseek-harness/packages/session/session-projection/src/)（registry + projection definition + types）+ [`packages/session/session-projection-cache/src/`](../deepseek-harness/packages/session/session-projection-cache/src/)（persisted cache + spec）+ [`packages/session-query/session-query/src/`](../deepseek-harness/packages/session-query/session-query/src/)（`readSurface` 接口 + types）+ [`packages/context/session-reference/`](../deepseek-harness/packages/context/session-reference/src/)（consume-only 范例）+ DSH AGENTS.md 工程约束 |
| **日期** | 2026-09-19 |
| **前置调研** | [research/dsh-consume-map.md](dsh-consume-map.md) / [research/skyaxis-panel-architecture.md](skyaxis-panel-architecture.md) / [research/trajectory-merger-algorithm.md](trajectory-merger-algorithm.md) / [research/cordis-effect-lifecycle.md](cordis-effect-lifecycle.md) / [ADR 0009](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md) / [ADR 0011](decisions/0011-shell.overlay浮层实施约束.md) |

---

## 1. 调研范围与方法

### 1.1 范围

调研 skyaxis MVP SUB.5（session event 时间线）的工程基础：

- **SessionSurfaceSnapshot 字段契约**（[`session-query/src/types.ts:37-46`](../deepseek-harness/packages/session-query/session-query/src/types.ts#L37-L46)）
- **SessionProjectionRegistry 5 大接口**：`register` / `onChanged` / `stateOf` / `snapshot` / `cachedSnapshot` / `checkpoint` / `hydrate`（[`session-projection/src/index.ts:199-708`](../deepseek-harness/packages/session/session-projection/src/index.ts#L199-L708)）
- **ProjectionDefinition 契约**：`key` / `stateSchema` / `init` / `apply` / `wire` / `stateVersion`（[`session-projection/src/index.ts:48-93`](../deepseek-harness/packages/session/session-projection/src/index.ts#L48-L93)）
- **5 类 cache 失效触发**（throttle count / throttle interval / session created / turn/end / session disposed）（[`session-projection-cache/src/index.ts:301-352`](../deepseek-harness/packages/session/session-projection-cache/src/index.ts#L301-L352)）
- **写穿透一致性保证**：durability first + memory second（[`session-projection-cache/src/index.ts:8-17`](../deepseek-harness/packages/session/session-projection-cache/src/index.ts#L8-L17)）
- **identity 匹配规则**：`formatVersion` + `createdAt` + `cwd` + `isSeeded` + `inheritedEventCount`（[`session-projection-cache/src/index.ts:419-443`](../deepseek-harness/packages/session/session-projection-cache/src/index.ts#L419-L443)）
- **skyaxis 第 5 路径合并算法**（projection cached path）：在调研报告 5 § 4 的 4 路径基础上扩展
- **SUB.5 实时更新机制**：`ctx.sessionProjections.onChanged` + `ctx.sessionQuery.readSurface` 双订阅
- **v0.2 D2 SessionDependency 场景的应用**

### 1.2 方法

**只读访问** [`packages/session/`](../deepseek-harness/packages/session/) 4 个相关包 + [`packages/session-query/`](../deepseek-harness/packages/session-query/) + [`packages/context/session-reference/`](../deepseek-harness/packages/context/session-reference/)。严格遵守 [DSH AGENTS.md](../deepseek-harness/CLAUDE.md) "Registrations 是 effects" + "Pre-stable public APIs" + "Typed events 用 declaration merging" 三大约束。

### 1.3 关键引用清单

| 文档 | 用途 |
| --- | --- |
| [`packages/session/session-projection/src/index.ts:48-93`](../deepseek-harness/packages/session/session-projection/src/index.ts#L48-L93) | `ProjectionDefinition<K, S>` 接口契约 |
| [`packages/session/session-projection/src/index.ts:112-117`](../deepseek-harness/packages/session/session-projection/src/index.ts#L112-L117) | `ProjectionSnapshot` 接口 |
| [`packages/session/session-projection/src/index.ts:127-137`](../deepseek-harness/packages/session/session-projection/src/index.ts#L127-L137) | `ProjectionCheckpointRow` / `ProjectionCheckpoint` |
| [`packages/session/session-projection/src/index.ts:199-708`](../deepseek-harness/packages/session/session-projection/src/index.ts#L199-L708) | `SessionProjectionRegistry` 主类 |
| [`packages/session/session-projection/src/index.ts:655-701`](../deepseek-harness/packages/session/session-projection/src/index.ts#L655-L701) | `drive` 方法（`session/event` 触发 eager fold）|
| [`packages/session/session-projection/src/types.ts`](../deepseek-harness/packages/session/session-projection/src/types.ts) | `SessionProjectionMap` / `SessionProjectionStateMap` merge-extensible tables |
| [`packages/session/session-projection-cache/src/index.ts:92-392`](../deepseek-harness/packages/session/session-projection-cache/src/index.ts#L92-L392) | `SessionProjectionCache` 主类（持久化层）|
| [`packages/session/session-projection-cache/src/index.ts:301-352`](../deepseek-harness/packages/session/session-projection-cache/src/index.ts#L301-L352) | write-behind throttle + mandatory points |
| [`packages/session/session-projection-cache/src/index.ts:419-443`](../deepseek-harness/packages/session/session-projection-cache/src/index.ts#L419-L443) | `identityMatches` / `predecessorIdentityMatches` 规则 |
| [`packages/session/session-projection-cache/src/spec.ts`](../deepseek-harness/packages/session/session-projection-cache/src/spec.ts) | `projectionCacheDomainSpec` + `checkpointIdentity` / `checkpointRecord` schemas |
| [`packages/session-query/session-query/src/index.ts:302-316`](../deepseek-harness/packages/session-query/session-query/src/index.ts#L302-L316) | `readSurface()` 公共方法 |
| [`packages/session-query/session-query/src/types.ts:37-46`](../deepseek-harness/packages/session-query/session-query/src/types.ts#L37-L46) | `SessionSurfaceSnapshot` 字段 |
| [`packages/context/session-reference/src/projection.ts:38`](../deepseek-harness/packages/context/session-reference/src/projection.ts#L38) | consume-only 范本：`projectSessionConversation(snapshot: SessionSurfaceSnapshot)` |
| [DSH AGENTS.md](../deepseek-harness/CLAUDE.md) | "Typed events 用 declaration merging" + "Pre-stable public APIs" + "Misconfiguration fails loud" |

---

## 2. SessionSurfaceSnapshot 字段契约

来源：[types.ts:37-46](../deepseek-harness/packages/session-query/session-query/src/types.ts#L37-L46)：

```ts
export interface SessionSurfaceSnapshot {
  /** Cloned session header selected from the same corpus observation as events. */
  session: SessionHeader
  /** Exact number of fork-inherited events in the observed log. */
  inheritedEventCount: SessionLogOffset
  /** Highest raw-log seq included in the observation, or null for an empty log. */
  capturedThroughSeq: OptionalSessionSeq
  /** Cloned current surface events in model-history order. */
  events: SurfaceEvent[]
}
```

| 字段 | 类型 | 含义 | skyaxis 用法 |
| --- | --- | --- | --- |
| `session` | `SessionHeader` | session 元数据（已 clone，**不可变**）| 节点 metadata / 边元数据 |
| `inheritedEventCount` | `SessionLogOffset` | fork-inherited 事件数 | subagent 派生起点 |
| `capturedThroughSeq` | `OptionalSessionSeq` | 捕获的最高 seq，`null` 表示空 log | 增量订阅起点 |
| `events` | `SurfaceEvent[]` | **折叠后**的当前 surface 事件（model history 顺序）| **SUB.5 时间线主数据源** |

**关键观察**：

- **`SessionSurfaceSnapshot` ≠ `SessionLogSnapshot`**——前者是**折叠后的 model surface**（[调研报告 1 § 2.3](dsh-consume-map.md) 已识别：被替换的旧事件不出现在 surface），后者是**完整 raw log**（含 shadowed / log-only events）
- **`events` 已过滤**——`SurfaceEvent` = current model context（`surface: 'current' | 'shadowed' | 'log-only'` 三态，surface snapshot 只含 current）
- **`readSurface` 是 cold read**——[session-query/index.ts:308](../deepseek-harness/packages/session-query/session-query/src/index.ts#L308-L316) 是 async 调用，每次返回新 snapshot，**不是订阅**
- **subagent 子 session 不在 `events` 里**——[session-reference/projection.ts:38](../deepseek-harness/packages/context/session-reference/src/projection.ts#L38) 范本：`projectSessionConversation` 只处理 `snapshot.session` 一个 session 的 surface

**与 SessionProjectionSnapshot 区别**：

| 接口 | 范围 | 触发 | skyaxis 用法 |
| --- | --- | --- | --- |
| `SessionSurfaceSnapshot`（[session-query](../deepseek-harness/packages/session-query/session-query/src/types.ts#L37-L46)）| 单 session 折叠 surface | `readSurface()` async 一次性读 | SUB.5 时间线（折叠 view）|
| `ProjectionSnapshot`（[session-projection](../deepseek-harness/packages/session/session-projection/src/index.ts#L112-L117)）| 单 session 多个 projection units | `snapshot()` sync 多次读 + `onChanged()` 订阅 | SUB.1 topology（counts / state）/ SUB.5 增量 |

---

## 3. SessionProjectionRegistry 5 大接口

### 3.1 `register(definition)`：注册一个 projection unit

来源：[index.ts:233-293](../deepseek-harness/packages/session/session-projection/src/index.ts#L233-L293)：

```ts
register(definition: ProjectionDefinition<K, S>): () => void {
  // ... validation
  const dispose = this.ctx.effect(function* (this: SessionProjectionRegistry) {
    const key = erased.key
    const existing = this.registrations.get(key)
    if (existing === undefined) {
      this.registrations.set(key, { def: erased, cells: new WeakMap(), refs: 1 })
    } else {
      // ⚠️ stateVersion 不一致抛错
      if (existing.def.stateVersion !== erased.stateVersion) {
        throw new Error(`session projection key ${JSON.stringify(key)} is already registered at stateVersion ${String(existing.def.stateVersion)}; refusing to share it with stateVersion ${String(erased.stateVersion)}`)
      }
      existing.refs += 1   // ⚠️ 多 registrant 共享同一 unit，refs 计数
    }
    yield () => {
      const live = this.registrations.get(key)
      if (live === undefined) return
      live.refs -= 1
      if (live.refs === 0) this.registrations.delete(key)
    }
  }.bind(this), 'sessionProjections.register()')
  return () => void dispose()
}
```

**关键观察**：

- **`register` 自身是 effect**（[L273](../deepseek-harness/packages/session/session-projection/src/index.ts#L273)）——fiber unload 自动 unregister
- **同 key 共享 unit + refs 计数**（[L278-282](../deepseek-harness/packages/session/session-projection/src/index.ts#L278-L282)）——N 个 session 同一 preset 注册同一 key N 次，refs = N，全部释放后 key 删除
- **`stateVersion` 不匹配抛错**（[L279-281](../deepseek-harness/packages/session/session-projection/src/index.ts#L279-L281)）——"Misconfiguration fails loud"（[DSH AGENTS.md](../deepseek-harness/CLAUDE.md)）
- **`stateVersion` 必须是非负整数**（[L270-272](../deepseek-harness/packages/session/session-projection/src/index.ts#L270-L272)）——任何不是 SafeInteger 的值都抛错
- **skyaxis MVP 不注册新 projection**——只**消费**已有 projection（如 `title` / `outline` 等 DSH 内置）

### 3.2 `onChanged(listener)`：订阅变化

来源：[index.ts:301-309](../deepseek-harness/packages/session/session-projection/src/index.ts#L301-L309)：

```ts
onChanged(listener: ProjectionChangeListener): () => void {
  const dispose = this.ctx.effect(() => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }, 'sessionProjections.onChanged()')
  return () => void dispose()
}

export type ProjectionChangeListener = (
  session: Session,
  key: Extract<keyof SessionProjectionMap, string>,
  value: unknown,
  seq: SessionSeq,
) => void
```

**关键观察**：

- **`onChanged` 也是 effect**（[L302](../deepseek-harness/packages/session/session-projection/src/index.ts#L302)）——fiber unload 自动 unsubscribe
- **回调参数**：`(session, key, value, seq)`——`seq` 是**触发这次变化的 event seq**（用于增量更新跟踪）
- **`value` 是 schema-validated output**（[drive L689](../deepseek-harness/packages/session/session-projection/src/index.ts#L689)）——已通过 `viewSchema.parse`
- **变化检测基于 `Object.is`**（[drive L688](../deepseek-harness/packages/session/session-projection/src/index.ts#L688)）——只有 client-visible raw view 引用变化才通知（**不是 deep diff**）

**skyaxis SUB.5 用法**：

```ts
const off1 = ctx.sessionProjections.onChanged((session, key, value, seq) => {
  // session: 当前变化的 session（live Session 引用）
  // key: 变化的 projection key
  // value: 新的 wire 值
  // seq: 触发变化的 event seq
  skyaxisStore.updateProjection(session.id, key, value, seq)
})
```

### 3.3 `snapshot(session, keys?)`：完整 snapshot 读

来源：[index.ts:338-352](../deepseek-harness/packages/session/session-projection/src/index.ts#L338-L352)：

```ts
snapshot(
  session: Session,
  keys?: readonly Extract<keyof SessionProjectionMap, string>[],
): ProjectionSnapshot {
  const values: Record<string, unknown> = {}
  const selected = keys === undefined ? undefined : new Set<string>(keys)
  this.materializeCells(session)
  for (const registration of this.registrations.values()) {
    if (registration.def.wire === undefined) continue   // host-only 跳过
    if (selected !== undefined && !selected.has(registration.def.key)) continue
    const cell = this.cellFor(registration, session)
    values[registration.def.key] = this.viewCell(registration, cell)
  }
  return { asOfSeq: cursorBefore(session.seq), values }
}
```

**关键观察**：

- **`snapshot` 是同步**（[index.ts:338](../deepseek-harness/packages/session/session-projection/src/index.ts#L338-L352)）——已 materialize cells（[L344](../deepseek-harness/packages/session/session-projection/src/index.ts#L344)），无需 await
- **`asOfSeq = cursorBefore(session.seq)`**（[L351](../deepseek-harness/packages/session/session-projection/src/index.ts#L351)）——当前 session 的 watermark
- **`keys` 可选**（[L340](../deepseek-harness/packages/session/session-projection/src/index.ts#L340)）——只读指定 key，其余不读取 wire view
- **lazy fold**（[L615-629 cellFor](../deepseek-harness/packages/session/session-projection/src/index.ts#L615-L629)）——首次访问 session 的 cell 才 fold 整个 in-memory log

### 3.4 `cachedSnapshot(session, keys?)`：只读已 materialize 的 cell

来源：[index.ts:362-380](../deepseek-harness/packages/session/session-projection/src/index.ts#L362-L380)：

```ts
cachedSnapshot(session: Session, keys?: ...): ProjectionSnapshot | undefined {
  // ... 只读已 materialize cells，缺失返回 undefined
  return asOfSeq === undefined ? undefined : { asOfSeq, values }
}
```

**关键观察**：

- **不触发 lazy fold**——只读已 materialize 的 cell
- **返回的 asOfSeq 是最低 watermark**——值可能 trailing live session（hint，不是 baseline）
- **skyaxis SUB.5 在 cold session 上读取时**——首次访问返回 undefined，需 fallback 到 `snapshot()`

### 3.5 `checkpoint(session)` / `hydrate(session, ...)` / `restore(...)`：持久化接口

[`index.ts:396-595`](../deepseek-harness/packages/session/session-projection/src/index.ts#L396-L595)：

| 方法 | 用途 | skyaxis 用法 |
| --- | --- | --- |
| `checkpoint(session)` | 取所有 unit 的 `{ver, seq, val}` 行（detached clone）| **不直接调用**——DSH cache 自己用 |
| `hydrate(session, rows, events, baseSeq)` | 注入已准备的 cells | **不直接调用**——DSH 内部用 |
| `restore(rows, events, baseSeq, header, inheritedEventCount)` | cold read 时从 cached rows + tail replay fold | **不直接调用**——DSH cache 自己用 |
| `viewCheckpoint(rows, keys?)` | 直接从 rows 读取 wire view（**zero-I/O**）| skyaxis 可在 cold path 直接用 |

**关键观察（observe-only 边界）**：

- skyaxis **不能注册新 projection**（影响其他 plugin）
- skyaxis **不能修改 checkpoint**（持久化层 only）
- skyaxis **可调用**：`snapshot()` / `cachedSnapshot()` / `stateOf()` / `onChanged()` / `viewCheckpoint()` 5 个**只读**接口

---

## 4. ProjectionDefinition 契约（registry 注册项的 5 个必须字段）

来源：[index.ts:48-93](../deepseek-harness/packages/session/session-projection/src/index.ts#L48-L93)：

```ts
export interface ProjectionDefinition<K extends keyof SessionProjectionStateMap, S> {
  key: K                                            // 1. 唯一 key
  stateSchema: ZodType<S>                            // 2. Zod 验证持久化 state
  init(header: SessionHeader, inheritedEventCount: SessionLogOffset): NoInfer<S>   // 3. 初始 state
  apply(state: NoInfer<S>, event: SessionEvent): NoInfer<S>                       // 4. 纯 fold
  wire?: { viewSchema: ZodType<...>; view(state: NoInfer<S>): SessionProjectionMap[K] }  // 5. client view（可选）
  stateVersion: number                              // 6. 版本号（升级时 bump）
}
```

**关键观察（"Whole-value event rule" load-bearing）**：

- **`apply` 必须纯同步**（[L44-47](../deepseek-harness/packages/session/session-projection/src/index.ts#L44-L47)）——"an async unit would tear the carriers' consistency cut"
- **`state` 必须 plain JSON**（[L46](../deepseek-harness/packages/session/session-projection/src/index.ts#L46)）——持久化前提
- **`apply` 必须返回 same reference 当 event 不属于本 unit**（[L65-66](../deepseek-harness/packages/session/session-projection/src/index.ts#L65-L66)）——`Object.is` 检测状态变化，**未变化时返回原 state** 让 Object.is 触发零下游工作
- **wire 是可选的**（[L73](../deepseek-harness/packages/session/session-projection/src/index.ts#L73)）——host-only unit 无 wire（不出现在 client snapshot）

**skyaxis MVP 不注册新 projection**——只消费 DSH 内置 projection（如 `title` / `outline` 等）。

---

## 5. drive 方法：eager fold + 增量通知

来源：[index.ts:655-701](../deepseek-harness/packages/session/session-projection/src/index.ts#L655-L701)：

```ts
private drive(session: Session, event: SessionEvent): void {
  for (const registration of this.registrations.values()) {
    let cell = registration.cells.get(session)
    if (cell !== undefined && cell.observedSeq >= event.seq) continue  // 已 fold 跳过
    if (cell === undefined) {
      // Late build mid-stream
      cell = this.buildCell(registration.def, session.header, session.inheritedEventCount,
        session.snapshotEvents(SessionLogOffset(0), SessionLogOffset(event.seq)))
      registration.cells.set(session, cell)
    } else {
      this.advanceCell(registration.def, cell, session, event.seq === 0 ? -1 : SessionSeq(event.seq - 1))
    }
    const previousState = cell.state
    const next = registration.def.apply(previousState, event)
    const changed = !Object.is(next, previousState)   // ⚠️ Object.is 检测
    cell.state = next
    cell.observedSeq = event.seq
    const wire = registration.def.wire
    if (changed && wire !== undefined) {
      const views = cell.views
      views[0] = views[1]
      if (this.listeners.size > 0) {
        views[1] = wire.view(next)
        if (!Object.is(views[0], views[1])) {   // ⚠️ wire view 也 Object.is 检测
          const value = wire.viewSchema.parse(views[1])
          for (const listener of this.listeners) {
            listener(session, registration.def.key as Extract<keyof SessionProjectionMap, string>, value, event.seq)
          }
        }
      } else {
        views[1] = undefined
      }
    }
  }
}
```

**关键观察**：

- **subscribe `session/event` 一次**（[constructor L220](../deepseek-harness/packages/session/session-projection/src/index.ts#L220)）——所有 committed events 都被 drive
- **`Object.is` 两级检测**——state 引用变化 → wire view 引用变化才通知
- **`listeners.size > 0` 优化**（[L686](../deepseek-harness/packages/session/session-projection/src/index.ts#L686)）——无订阅者时不计算 wire view
- **`late build mid-stream`**（[L659-668](../deepseek-harness/packages/session/session-projection/src/index.ts#L659-L668)）——unit 在 events 流动后才注册时，先 fold 前缀再 apply 当前 event
- **`Object.is` 而非 deep diff**——state 必须 immutable，wire view 必须复用 reference 表示"未变化"

**skyaxis SUB.5 用法**：

```ts
ctx.sessionProjections.onChanged((session, key, value, seq) => {
  // 局部更新 skyaxisStore
  skyaxisStore.setProjectionForSession(session.id, key, value)
  // 不需要 refold 整列
})
```

---

## 6. SessionProjectionCache 持久化层

### 6.1 5 类写触发

来源：[index.ts:301-352](../deepseek-harness/packages/session/session-projection-cache/src/index.ts#L301-L352)：

| 触发 | 类型 | 来源 | 写策略 |
| --- | --- | --- | --- |
| **`writeEveryEvents`** 阈值 | throttle count | `Config`（部署可调）| per-session counter，达到阈值就写 |
| **`writeIntervalMs`** 定时器 | throttle interval | `Config`（部署可调）| per-session timer，dirty 期最长存活 |
| **`session/created`** | mandatory | `ctx.on('session/created', ...)` | 创建时立即写（捕获 seed-derived values）|
| **`turn/end`** | mandatory | `ctx.on('session/event', e.type === 'turn/end')` | turn 终止时立即写（turn-final values）|
| **`session/disposed`** | mandatory | `ctx.on('session/disposed', ...)` | dispose 时立即写（live → cold 转换点）|

**关键观察（[L62-73 Config 注释](../deepseek-harness/packages/session/session-projection-cache/src/index.ts#L62-L73)）**：

- "Both throttle triggers are deployment choices with no universally correct value, so the composition states them explicitly (cordis.yml)"
- "The three mandatory write points ... are policy, not tunables, and always fire"
- **DSH 已配置默认值**——`writeEveryEvents` / `writeIntervalMs` 是 cordis.yml 部署变量
- **3 个 mandatory point 总是 fire**——这是 policy 不允许改

### 6.2 写穿透一致性保证（durability first + memory second）

来源：[index.ts:8-17](../deepseek-harness/packages/session/session-projection-cache/src/index.ts#L8-L17) + [`write()` 方法 L246-262](../deepseek-harness/packages/session/session-projection-cache/src/index.ts#L246-L262)：

```ts
async write(session: Session): Promise<void> {
  const rows = this.ctx.sessionProjections.checkpoint(session)
  this.markClean(session)
  // ⚠️ Durability barrier: 先 flush session log
  if (this.ctx.sessions.get(session.id) === session) await this.ctx.sessions.flush(session)
  await this.put(session.id, identityOf(session.header, session.inheritedEventCount), rows)
}
```

**关键观察**：

- **"Reads and writes share ONE coherent state"**（[L8-10](../deepseek-harness/packages/session/session-projection-cache/src/index.ts#L8-L10)）
- **`write` 不是 fail-soft**（[L242 注释](../deepseek-harness/packages/session/session-projection-cache/src/index.ts#L242)）——内部 `put` 失败会 throw
- **flushSoft 是 fail-soft**（[L359-365](../deepseek-harness/packages/session/session-projection-cache/src/index.ts#L359-L365)）——失败只 log 警告，不传播
- **顺序：memory cut → flush session log → durable cache write**（[L247-261](../deepseek-harness/packages/session/session-projection-cache/src/index.ts#L247-L261)）——a crash can leave the cache behind the log but never ahead of it

### 6.3 identity 匹配规则（5 字段）

来源：[index.ts:419-443](../deepseek-harness/packages/session/session-projection-cache/src/index.ts#L419-L443)：

```ts
function identityMatches(stored, expected): boolean {
  return stored.formatVersion === expected.formatVersion
    && lifecycleIdentityMatches(stored, expected)
}

function lifecycleIdentityMatches(stored, expected): boolean {
  return stored.createdAt === expected.createdAt
    && stored.cwd === expected.cwd
    && (stored.isSeeded ?? false) === expected.isSeeded
    && (stored.inheritedEventCount ?? 0) === expected.inheritedEventCount
}
```

**关键观察**：

- **5 字段匹配**：`formatVersion` + `createdAt` + `cwd` + `isSeeded` + `inheritedEventCount`
- **`formatVersion` 不匹配 → 不匹配**（拒绝读取）——持久化版本与当前 log 语义不同
- **`createdAt` 不匹配 → 不匹配**——同 id 但 lifecycle 不同（删除+重建）
- **`cwd` 不匹配 → 不匹配**——同 id 但 cwd 不同（per-project session 切换）
- **`isSeeded` 不匹配 → 不匹配**——seed 状态不同
- **`inheritedEventCount` 不匹配 → 不匹配**——fork inherited prefix 不同

**skyaxis MVP 不直接读 cache**——只通过 `ctx.sessionQuery.readSurface` 间接获取折叠 surface。但 cache 失效规则的认知对 SUB.5 实时性判断很重要。

### 6.4 cache 行的 schema

来源：[spec.ts:26-72](../deepseek-harness/packages/session/session-projection-cache/src/spec.ts#L26-L72)：

```ts
export const checkpointRow = z.object({
  ver: z.number().int().nonnegative(),
  seq: z.number().int().gte(-1).transform((value): SessionSeqCursor =>
    value === -1 ? -1 : SessionSeq(value)),
  val: z.json(),   // ⚠️ z.json() 强校验 plain JSON
})

export const checkpointRecord = z.object({
  identity: checkpointIdentity,    // 5 字段
  rows: z.record(z.string(), checkpointRow),
})
```

**关键观察**：

- **`val: z.json()` 强校验**——非 plain JSON throw（persist precondition）
- **`seq: -1` 表示空 log**（[L28-30](../deepseek-harness/packages/session/session-projection-cache/src/spec.ts#L28-L30)）
- **`ver` 升级时 bump**——不匹配时 cache 行**丢弃**（不是迁移）——`ver` mismatch 永不 forward-apply 成 garbage
- **domain version 7**（[spec.ts:100](../deepseek-harness/packages/session/session-projection-cache/src/spec.ts#L100)）——`compatibleVersions: [3, 4, 5, 6]` 支持向前兼容

---

## 7. 与 session-query 的关系

### 7.1 三层 API 关系图

```
┌─────────────────────────────────────────────────────────────┐
│  sessionQuery (read-only facade)                            │
│  ├── readSurface(id)  → SessionSurfaceSnapshot (cold read) │
│  ├── observeSession(id)  → SessionObservation (live lease) │
│  └── readSession(id)  → SessionLogSnapshot (cold read)     │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  sessionProjections (in-memory watermark cache + onChanged) │
│  ├── register(definition)  → effect-bound, refs-counted    │
│  ├── onChanged(listener)  → effect-bound, Object.is diff  │
│  ├── snapshot(session)  → sync, all wire values           │
│  └── cachedSnapshot(session)  → sync, materialized only    │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│  sessionProjectionCache (persisted layer, fail-soft write) │
│  ├── cachedSnapshot(meta)  → zero-I/O listing hint        │
│  ├── hydratePrepared(session, events)  → session reattach │
│  └── coldSnapshot(meta, events)  → full log cold read     │
└─────────────────────────────────────────────────────────────┘
```

**关键观察**：

- **`sessionProjections` 是内存层**——`WeakMap<Session, UnitCell>`，Session dispose 时 GC 自动回收
- **`sessionProjectionCache` 是持久化层**——`KvTable<SessionId, CheckpointRecord>`，Session dispose 后仍可读
- **`sessionQuery` 是查询 facade**——综合多个数据源，但**不直接读 projection cache**
- **skyaxis SUB.5 推荐用 `sessionQuery.readSurface` + `sessionProjections.onChanged`**——read 走 query facade，增量订阅走 projection

### 7.2 sessionQuery.readSurface 与 SessionProjectionSnapshot 的关系

来源：[session-query/index.ts:308-316](../deepseek-harness/packages/session-query/session-query/src/index.ts#L308-L316)：

```ts
async readSurface(sessionId: SessionId): Promise<SessionSurfaceSnapshot> {
  const loaded = await this._corpus.load(sessionId)
  return {
    session: structuredClone(loaded.header),
    inheritedEventCount: loaded.inheritedEventCount,
    capturedThroughSeq: loaded.events.at(-1)?.seq ?? null,
    events: tracing.currentSurfaceEvents(sessionId, loaded.events),
  }
}
```

**关键观察**：

- **`readSurface` 走 `_corpus.load()`**（不是直接读 projection）——但 corpus 内部可能用 projection cache 优化（[DSH session-query/corpus 实现细节待读]）
- **返回的 `events: SurfaceEvent[]`**——**已折叠**的 surface（不含 shadowed / log-only）
- **`events` 是 detached clone**——`tracing.currentSurfaceEvents` 输出**新数组**
- **`session: structuredClone(loaded.header)`**——header 也 detached

**skyaxis SUB.5 用法对比**：

| 场景 | 用什么 |
| --- | --- |
| 一次性读 cold session | `ctx.sessionQuery.readSurface(id)` |
| 一次性读 live session | `ctx.sessionQuery.readSurface(id)` 或 `ctx.sessionQuery.observeSession(id).events()` |
| 增量订阅 live session 投影变化 | `ctx.sessionProjections.onChanged(listener)` |
| 增量订阅 fold progress（每事件） | `ctx.sessionQuery.observeSession(id).subscribe(events => ...)` |
| 读已缓存的 projection 状态 | `ctx.sessionProjections.snapshot(session, keys)` |

---

## 8. 5 类 cache 失效触发详解

### 8.1 5 类失效触发的层次关系

| 触发 | 时机 | 触发原因 | 写策略 |
| --- | --- | --- | --- |
| **writeEveryEvents 阈值** | `session/event` 计数器达到 | high-frequency 事件流（subagent tool calls / 频繁 message）| 主动节流 |
| **writeIntervalMs 定时器** | dirty 状态超过 N 毫秒 | 长时间 low-frequency 流 | 主动节流 |
| **session/created** | session 创建时 | seed-derived values（标题等）| 立即写（**mandatory**）|
| **turn/end** | turn 终止时 | turn-final values（model-visible state）| 立即写（**mandatory**）|
| **session/disposed** | session dispose 时 | live → cold 转换点（最终值）| 立即写（**mandatory**）|

**关键观察**：

- **3 mandatory point 总是 fire**（[L60-67 注释](../deepseek-harness/packages/session/session-projection-cache/src/index.ts#L60-L67)）——policy
- **2 throttle 是 deployment tunable**（[L60-67 注释](../deepseek-harness/packages/session/session-projection-cache/src/index.ts#L60-L67)）——DSH 配置默认
- **fail-soft write**（`flushSoft`）——throttle + mandatory 都走 fail-soft，丢失仅导致下次 cold read 更长 tail replay
- **`write` 是 strict**（非 fail-soft）——但**只在内部用**，外部调用都走 `flushSoft`

### 8.2 写时序图

```
session/event fired
  ↓
sessionProjections.drive(session, event)
  ↓ (eager fold + listeners)
sessionProjectionCache 监听 session/event
  ↓ (if event.type === 'turn/end')
flushSoft(session, 'turn/end')   ← mandatory
  ↓ else
dirty[session].pending++
if pending >= writeEveryEvents
  flushSoft(session, 'count threshold')
else
  dirty[session].timer = setTimeout(flushSoft, writeIntervalMs)
  ↓
flushSoft → write(session)
  ↓
sessionProjections.checkpoint(session)   ← memory cut
sessions.flush(session)                   ← log durability barrier
put(id, identity, rows)                   ← cache write
markClean(session)                        ← reset dirty state
```

### 8.3 读时序图（cold path）

```
sessionQuery.readSurface(id)
  ↓
_corpus.load(id)
  ↓
_sessionProjections.{restore | hydratePrepared}(rows, events)
  ↓
viewCheckpoint(rows, keys)            ← zero-I/O rung
  ↓
sessionProjectionCache.cachedSnapshot(meta)  ← persisted rows
  ↓
sessionProjections.snapshot(session, keys)   ← materialized cells (lazy fold if needed)
  ↓
return SessionSurfaceSnapshot (detached clone)
```

### 8.4 实时性影响 skyaxis SUB.5

| 路径 | 实时性 | 适用 |
| --- | --- | --- |
| `sessionQuery.observeSession(id).subscribe(...)` | **per-event**（最高频）| SUB.1 topology + SUB.5 turn boundary 实时性 |
| `sessionProjections.onChanged(...)` | **per-projection-change**（按需）| SUB.5 投影字段实时性（title / outline / count）|
| `sessionQuery.readSurface(id)` | **cold read**（一次性）| SUB.5 时间线初始化 + cold session 显示 |
| `sessionProjectionCache.cachedSnapshot(meta)` | **persisted hint**（最旧）| 列表场景（无需 fold）|

**推荐组合**：

- **初始化**：`sessionQuery.readSurface(id)` → `surface` + `seq`
- **per-event 更新**：`observeSession(id).subscribe(events => append events past seq)`
- **per-projection 更新**：`sessionProjections.onChanged(update projection)`
- **list 场景**：`sessionProjectionCache.cachedSnapshot(meta)` → 0-I/O listing hint

---

## 9. skyaxis 第 5 路径合并算法（projection cached path）

### 9.1 在 [调研报告 5 § 4](trajectory-merger-algorithm.md) 4 路径基础上扩展

[调研报告 5](trajectory-merger-algorithm.md) 4 路径：live-single / live-multi / cold-single / cold-multi。

**新增第 5 路径**：`projection-cached-multi`（用 projection cache + projection registry 替代 readSession/observeSession 序列）。

```ts
async function mergeProjectionCachedMulti(ctx: ClientContext, rootId: SessionId, options: MergerOptions): Promise<MergerResult> {
  // Step 1: 拿完整拓扑
  const descendants = await ctx.subagents.listDescendants(rootId, options.signal)
  const allSessionIds = [rootId, ...descendants.map(d => d.id)]
  
  // Step 2: 读 header（用 sessionQuery.listSessions + readTitleSnapshots）
  const headers = await ctx.sessionQuery.readTitleSnapshots(allSessionIds, options.signal)
  
  // Step 3: 对每个 session 拿 cached projection snapshot
  const annotated: AnnotatedEvent[] = []
  const headerMap = new Map<SessionId, SessionHeader>()
  
  for (const id of allSessionIds) {
    const header = headers.get(id)?.header
    if (!header) continue
    headerMap.set(id, header)
    
    // ⚠️ 用 cached snapshot（zero-I/O rung）——如果 cache 行存在
    const cached = ctx.sessionProjectionCache.cachedSnapshot(header, header.inheritedEventCount)
    
    if (cached !== undefined) {
      // ⚠️ 用 cached wire values（已经是 client-visible 折叠状态）
      // 不需要 fold 整个 event log
      // 但需要 events 才能 merge turn boundaries ——cached 不含 events
    }
    
    // ⚠️ 仍需读 events（cold path）
    const snap = await ctx.sessionQuery.readSession(id, options.signal)
    
    // ... 同 path C（cold-single）的处理
  }
  
  // ... 同 path B（live-multi）的全局排序 + turn 分组
}
```

**复杂度**：O(N·n log n)，与 cold-multi 相同——但 cache hint 减少了**部分** cold fold 的工作量（projection 状态已存）。

### 9.2 projection cached path 的实际价值

**直白说：调研报告 5 的 4 路径合并时，**每个 cell fold 完整 log**——如果 cache 行存在，fold 只需从 cache 的 `seq` 之后 replay tail**。

```ts
// 优化点：用 sessionProjections.restore(rows, tail_events, baseSeq, header, inheritedEventCount)
const restored = ctx.sessionProjections.restore(cachedRows, tailEvents, baseSeq, header, inheritedEventCount)
```

**但是**——trajectory merger 需要的是 **events 列表 + turn 边界**，**不是** projection state。**events 必须从 corpus 或 readSession 读**。

**结论**：**projection cached path 在 trajectory merger 中价值有限**——它的优势主要在"读 projection state"（title / outline / count），不在"读 events"。

### 9.3 SUB.5（session event 时间线）的 projection 用法

SUB.5 的主数据源是 `SessionSurfaceSnapshot.events`——**来自 `readSurface`**，**不是 projection**。但：

- **`sessionProjections.onChanged`** 可以订阅 SUB.5 视图需要的**折叠字段**（如 turn count / last activity time / subagent parent state 等）
- **`sessionProjectionCache.cachedSnapshot(meta)`** 提供 0-I/O 列表 hint，**用于 SUB.5 在冷读列表中渲染标题/状态**

**SUB.5 推荐的 projection 用法**：

```ts
// 1. 列表场景（多 session 同时显示）
for (const meta of sessionMetas) {
  const cached = ctx.sessionProjectionCache.cachedSnapshot(meta, meta.inheritedEventCount)
  // 用 cached.values.title / cached.values.outline 渲染列表项
}

// 2. 单 session 详情场景
const surface = await ctx.sessionQuery.readSurface(id)
const off = ctx.sessionProjections.onChanged((session, key, value, seq) => {
  if (key === 'outline' || key === 'title') {
    // 增量更新 SUB.5 视图的元数据
  }
})
```

---

## 10. v0.2 D2（SessionDependency）场景应用

### 10.1 D2 场景回顾

[ADR 0009 § 9.1](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md) 提到 SUB 系列场景：**D2 = SessionDependency**——跨 session 的状态变更可视化。

### 10.2 projection 在 D2 中的作用

| SUB 场景 | projection 用法 |
| --- | --- |
| **SUB.1**（multi session topology）| `ctx.sessionProjections.snapshot(session)` 读每个 session 的 wire values；`onChanged` 监听 subagent 派生变化 |
| **SUB.4**（catalog refresh）| `ctx.sessionProjections.onChanged((session, 'subagentCatalog', value) => refresh UI)` |
| **SUB.5**（session event 时间线）| `ctx.sessionQuery.readSurface(id)` 初始化；`ctx.sessionProjections.onChanged` 增量更新 title/outline/count |
| **D2**（SessionDependency）| `ctx.sessionProjectionCache.cachedSnapshot(meta)` 列表 hint；`onChanged` 跨 session 状态变更通知 |

**关键观察**：

- **SUB.1 / D2 是 projection 的**主要消费者**——trajectory merger 不直接用 projection，但 projection 提供 topology 所需的 fold state
- **`onChanged` 是 SUB.1 的核心 API**——拓扑变化（subagent 派生 / 终止 / 状态变更）都通过 onChanged 推送

---

## 11. ADR 0009 假设清单更新

| 假设 | 本调研相关 | 状态 |
| --- | --- | --- |
| 假设 2（subagents 服务）| § 10.2 SUB.1 用 onChanged 监听 subagent 派生 | 维持 |
| 假设 7（sessionProjections observe-only）| ✅ § 3.1-3.5 验证只读接口 5 个 | **事实基础已建立** |
| **新假设 28**：`sessionProjectionCache` 的 `cachedSnapshot` 是 zero-I/O 列表 hint（仅基于 persisted rows）| ✅ § 6.4 + § 9.3 验证 | **假设 28 暂成立** |
| **新假设 29**：`sessionProjections.onChanged` 的 listener 触发基于 `Object.is` 两级检测（state 引用 + wire view 引用）| ✅ § 5 drive 方法验证 | **假设 29 暂成立** |
| **新假设 30**：`sessionProjectionCache` 的 3 mandatory write point（session created / turn end / session disposed）总是 fire，2 throttle（writeEveryEvents / writeIntervalMs）是部署可调 | ✅ § 6.1 验证 | **假设 30 暂成立** |
| **新假设 31**：`sessionProjectionCache` 的 write 是 fail-soft（丢失仅导致更长 tail replay），但 identity 匹配是严格 5 字段 | ✅ § 6.2 + § 6.3 验证 | **假设 31 暂成立** |
| **新假设 32**：`sessionQuery.readSurface` 返回 `SessionSurfaceSnapshot` 已折叠（仅 current surface，不含 shadowed / log-only events）| ✅ § 2 + § 7.2 验证 | **假设 32 暂成立** |
| **新假设 33**：projection 的 3 个生命周期事件 `session/created` / `session/event` / `session/disposed` 由 DSH core 发出，skyaxis 不监听 | ✅ § 5 + § 6.1 验证 | **假设 33 暂成立** |
| **新假设 34**：skyaxis MVP 不注册新 projection，只消费 DSH 内置 projection（title / outline 等）| ✅ § 4 验证（observe-only 边界）| **假设 34 暂成立** |

**累计 ADR 0009 假设清单**：1 + 2-8 + 9-14 + 15-17 + 18-20 + 21-27 + **28-34** = 34 条假设。**未触达"3 条以上不成立则回退"红线**（[CLAUDE.md 第 2.6 节](../CLAUDE.md)）。

---

## 12. 关键风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| **R.1 sessionProjectionCache 配置不可知** | skyaxis 不知道 DSH 部署的 `writeEveryEvents` / `writeIntervalMs` 默认值 | 文档化"DSH 默认"假设，v0.1 demo 第一天实测 |
| **R.2 onChanged 回调频率过高** | SUB.1 拓扑频繁重建导致 React 重渲染 | debounce 50ms + selector 订阅（[调研报告 4 § 5](skyaxis-panel-architecture.md)）|
| **R.3 Object.is 检测错失 nested 变化** | wire view 内嵌对象修改但顶层 reference 不变 → 错过通知 | skyaxis 的 wire view 设计保持 immutable（用 spread / structuredClone）|
| **R.4 列表场景 cachedSnapshot 返 undefined** | persisted cache miss 时返回 undefined → UI 显示"未知状态" | fallback 到 `snapshot(session, keys)`（sync fold）|
| **R.5 projection 定义变更（DSH 升级）** | DSH 新增 / 修改 projection 时 skyaxis 假设失效 | 钉钉 DSH 版本 + 升级评估（[ADR 0010 § 8.1](decisions/0010-技术选型-MVP实施期.md)）|
| **R.6 cache 行 val 非 plain JSON** | 持久化失败 → cache 不可用 | `z.json()` 强校验（DSH 已做），skyaxis 只消费不注册 |
| **R.7 session/created 触发导致 seeded session 立即写** | seeded session（fork 自父）的 inheritedEventCount > 0 → 立即写 | DSH cache 已支持（[L401-402 identityOf](../deepseek-harness/packages/session/session-projection-cache/src/index.ts#L401-L402) 校验）|
| **R.8 onChanged listener 内存泄漏** | skyaxis 多次注册 listener 未清理 | 调研报告 6 § 6.3 `ctx.on` 自身是 effect + 用 `skyaxisStore.subscribe` 单订阅分发 |
| **R.9 双层订阅冲突** | observeSession.subscribe + sessionProjections.onChanged 同时订阅导致重复更新 | skyaxis 用**单一订阅者**模式（仅 observeSession），onChanged 仅用于 SUB.1 topology 推送 |
| **R.10 持久化丢失（OS crash / disk fail）** | cache 行丢失 → 下次 cold read 全 fold | DSH 已声明 fail-soft（[L11-13 注释](../deepseek-harness/packages/session/session-projection-cache/src/index.ts#L11-L13)），skyaxis 无需处理 |

---

## 13. v0.1 / v0.2 衔接

### 13.1 v0.1 第一周交付（与 [调研报告 6 § 15](cordis-effect-lifecycle.md) 衔接）

| 交付 | 用 projection 的部分 |
| --- | --- |
| 7 个 plugin 文件骨架 | 无（仅 cordis 集成）|
| `verify-skyaxis-readonly` oxlint 规则 | **新增规则** `skyaxis/no-register-projection`：禁止调用 `ctx.sessionProjections.register(...)` |
| 单测 | 无 |

### 13.2 v0.1 第三周（React Flow + SUB.1 拓扑）

| 交付 | 用 projection 的部分 |
| --- | --- |
| `skyaxisStore` 集成 SUB.1 拓扑 | `ctx.sessionProjections.onChanged` 订阅 topology 变化 |
| `TopologyCanvas` 组件 | 渲染 fold state |
| 多视图管理 | `ctx.sessionProjectionCache.cachedSnapshot(meta)` 列表 hint |

### 13.3 v0.1 第四周（SUB.5 session event 时间线）

| 交付 | 用 projection 的部分 |
| --- | --- |
| `SessionEventTimeline` 组件 | `ctx.sessionQuery.readSurface(id)` 初始化 |
| 增量更新 | `ctx.sessionProjections.onChanged` 监听 outline/title/count |
| 列表场景 | `ctx.sessionProjectionCache.cachedSnapshot(meta)` 0-I/O hint |

### 13.4 v0.2 D2（SessionDependency）

| 交付 | 用 projection 的部分 |
| --- | --- |
| SessionDependency 渲染 | `ctx.sessionProjections.onChanged` 跨 session 监听 |
| 状态变更通知 | `onChanged` 的 `(session, key, value, seq)` 参数直接用于 diff |

---

## 14. 一句话总结

> SessionProjectionRegistry 是 in-memory watermark cache（`WeakMap<Session, UnitCell>` + Object.is 两级检测 + drive 方法 eager fold），SessionProjectionCache 是持久化层（5 字段 identity 匹配 + 3 mandatory write + 2 throttle + fail-soft + durable first / memory second），`sessionQuery.readSurface` 是查询 facade（折叠 surface，已 clone）。**新增 ADR 0009 假设 28-34 共 7 条暂成立**，**累计 34 条假设，未触达"3 条以上不成立则回退"红线**。**第 5 路径（projection cached）在 trajectory merger 中价值有限**，但 onChanged 是 SUB.1 topology 和 SUB.5 时间线**实时订阅 UI 更新**的核心 API。10 项风险 + v0.1/v0.2 衔接明确。**verify-skyaxis-readonly 新增 `skyaxis/no-register-projection` 规则**锁定 observe-only 边界。

---

## 修订记录

| 日期 | 变更 |
| --- | --- |
| 2026-09-19 | 初版。基于 [`packages/session/session-projection/src/`](../deepseek-harness/packages/session/session-projection/src/)（registry 5 接口 + drive Object.is 两级检测）+ [`packages/session/session-projection-cache/src/`](../deepseek-harness/packages/session/session-projection-cache/src/)（5 字段 identity 匹配 + 3 mandatory + 2 throttle + fail-soft）+ [`packages/session-query/session-query/src/`](../deepseek-harness/packages/session-query/session-query/src/)（`readSurface` + `SessionSurfaceSnapshot`）+ [`packages/context/session-reference/`](../deepseek-harness/packages/context/session-reference/src/)（consume-only 范例）系统化梳理。14 章核心内容：(1) SessionSurfaceSnapshot 4 字段 + 与 SessionLogSnapshot 区别；(2) SessionProjectionRegistry 5 接口（register / onChanged / snapshot / cachedSnapshot / hydrate-restoration）；(3) ProjectionDefinition 契约 + "Whole-value event rule"；(4) drive 方法 eager fold + Object.is 两级检测；(5) SessionProjectionCache 5 类失效触发；(6) 写穿透一致性保证（durability first / memory second）；(7) identity 5 字段匹配；(8) 与 session-query 三层 API 关系图；(9) 5 类失效触发的层次关系 + 写时序图 + 读时序图 + 实时性对照；(10) skyaxis 第 5 路径合并算法（projection cached path）+ 在 trajectory merger 中价值有限的结论 + SUB.5 推荐 projection 用法；(11) v0.2 D2 场景应用；(12) **新增 ADR 0009 假设 28-34 共 7 条暂成立**：cachedSnapshot 是 0-I/O 列表 hint / onChanged Object.is 两级检测 / 3 mandatory 总是 fire 2 throttle 可调 / write fail-soft identity 严格 / readSurface 已折叠不含 shadowed / 3 生命周期事件 DSH core 发出 / skyaxis MVP 不注册新 projection。**累计假设 34 条，未触达红线**。10 项关键风险 + v0.1/v0.2 衔接 4 阶段。**新增 oxlint 规则 `skyaxis/no-register-projection`** 锁定 observe-only 边界。同步更新本变更日志。 |

---

## 相关 ADR / 文档

- [ADR 0009 — subagent 拓扑可视化](decisions/0009-subagent拓扑可视化-MVP范围与轨迹合并策略.md)
- [ADR 0010 — 技术选型](decisions/0010-技术选型-MVP实施期.md)
- [ADR 0011 — shell.overlay 浮层实施约束](decisions/0011-shell.overlay浮层实施约束.md)
- [调研报告 — DSH 6 只读服务消费路径地图](dsh-consume-map.md)
- [调研报告 — DSH Workspace 协议与 monorepo 集成](dsh-workspace-integration.md)
- [调研报告 — DSH ui-primitives 复用清单](dsh-ui-primitives-reuse.md)
- [调研报告 — skyaxis 独立 panel 架构](skyaxis-panel-architecture.md)
- [调研报告 — trajectory merger 算法细化](trajectory-merger-algorithm.md)
- [调研报告 — DSH Cordis plugin effect 生命周期深度调研](cordis-effect-lifecycle.md)
- [MVP 功能点拆解](../scope/mvp-features.md)
- [CLAUDE.md](../CLAUDE.md)
- [`packages/session/session-projection/src/index.ts`](../deepseek-harness/packages/session/session-projection/src/index.ts)
- [`packages/session/session-projection/src/types.ts`](../deepseek-harness/packages/session/session-projection/src/types.ts)
- [`packages/session/session-projection-cache/src/index.ts`](../deepseek-harness/packages/session/session-projection-cache/src/index.ts)
- [`packages/session/session-projection-cache/src/spec.ts`](../deepseek-harness/packages/session/session-projection-cache/src/spec.ts)
- [`packages/session-query/session-query/src/index.ts`](../deepseek-harness/packages/session-query/session-query/src/index.ts)
- [`packages/session-query/session-query/src/types.ts`](../deepseek-harness/packages/session-query/session-query/src/types.ts)
- [`packages/context/session-reference/src/projection.ts`](../deepseek-harness/packages/context/session-reference/src/projection.ts)
- [DSH AGENTS.md](../deepseek-harness/CLAUDE.md)
