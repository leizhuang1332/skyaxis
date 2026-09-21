# Research 0002 — Session 数据源调研（任务图 + Subagent 子树落地前置）

- **作者**：skyaxis 团队
- **日期**：2026-09-21
- **关联 ADR**：[0001-单session可视化v0.1-任务图与subagent子树](../decisions/0001-单session可视化v0.1-任务图与subagent子树.md)（§五.3 数据来源）
- **目的**：摸清 DSH 客户端暴露给 `conversation.view`（session 作用域）entry 的 session 数据通道，为把 `src/client/task-graph/view.tsx` 从硬编码种子数据切换到真实 session 数据定型。

> **范围声明**：本文档只调研"读得到的数据"——不写实现代码，不改既有 ADR。具体落地（事件窗口订阅模型、推断算法、subagent 子树渲染）留给后续 research / ADR / 工程实现跟进。

---

## 一、入口回顾：当前 task-graph entry 拿到了什么

[src/client/task-graph/register.ts](../../src/client/task-graph/register.ts) 在 `conversation.view`（list, session）slot 注册了 `TaskGraphView`。该 entry 由 `dsh-client-ui-conversation`（运行时依赖，本仓库未 install）声明的 conversation shell 渲染，session 作用域。

按 `@deepseek-ai/dsh-client-ui-slots` 的 [标准 kit 契约](../../node_modules/@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts)（§`StandardPropsOf` / §`SessionStandardProps`），session 作用域 entry 的 props 由 scope adapter 安装时注入。`agent-presets` 内置 [cordis-plugin-development SKILL.md](../../node_modules/.pnpm/@deepseek-ai+dsh-agent-pres_fc9bf98ae5865ea9f109f84a7d78519a/node_modules/@deepseek-ai/dsh-agent-presets/presets/cordis/skills/cordis-plugin-development/SKILL.md) §"Session and page data" 明确：

> "A session-scoped Slot may provide `useSession`, `useSessions`, `useWorkspaces`, `useProjection`, input state, or actions through standard props."

下面分别拆解这四个钩子（外加若干通过 `ctx` 在 apply 阶段可触达的通道），看各自能为任务图 / subagent 子树提供哪些数据。

---

## 二、四个标准钩子详解

### 2.1 `useSession()` —— 当前 session 的 SessionFace

- **类型**：`SnapshotSelectorHook<SessionFace>`
- **SessionFace 定义**：[dsh-api-session-controller/lib/types/client/contract/session.d.ts](../../node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/contract/session.d.ts)
  ```ts
  export type SessionFace = ISession & ObservableSnapshot<SessionSnapshot>;
  ```
- **可直接读到**：
  - `sessionId: SessionId`（branded string）
  - `ObservableSnapshot<SessionSnapshot>` 上挂的状态：[SessionSnapshot](../../node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/contract/snapshot.d.ts)
    - `queue: readonly QueuedMessage[]` —— 待执行 inbox（queue / steering / context 三种 placement）
    - `pendingSubmissions: readonly PendingSubmission[]` —— 本地未确认的提交回声
    - `running: boolean` —— Agent 是否在跑
    - `subagent: { address, parentAvailable? } | null` —— 当前选中的子 session 地址
    - `openState: 'cold' | 'loading' | 'open' | 'error'`
    - `openError`, `hasMore`, `loadingOlder`, `promptError`, `blank`, `lastAgentError`, `promptAttempted`, `awaitingFirstTurn`, `removed`
- **行为动词**（`ISession`）：
  - `loadOlder(): Promise<void>` —— 翻页老历史
  - `loadThrough(seq): Promise<void>` —— 翻页到指定 seq
  - `prompt / cancel / rename / updateQueue / readAttachment / command / beginSubmission`
- **子字段**：
  - `session.projections.faceOf(key): ObservableSnapshot<unknown>` —— **这就是 `useProjection` 的内部通路**（见下）

**对 v0.1 的可用性**：

- ✅ **能判定 session 是否在跑**（`running`）→ 根节点状态可推断
- ✅ **能拿到 pending queue / steering**（`queue`）→ 可作为 waiting 节点的输入
- ✅ **能拿到 subagent address**（`subagent.address`）→ subagent 子树入口
- ❌ **拿不到事件窗口**（`SessionSnapshot` 不含 events）→ 这是最大盲点

### 2.2 `useProjection(key)` —— 当前 session 的投影值

- **类型**：[UseProjection](../../node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/projection-store.d.ts)
  ```ts
  export type UseProjection = {
    <K extends Extract<keyof SessionProjectionMap, string>>(key: K): SessionProjectionMap[K] | undefined;
    <K, S>(key: K, selector: (value: SessionProjectionMap[K] | undefined) => S, eq?): S;
  };
  ```
- **数据来源**：`ProjectionValueStore`（push 模型；host 计算 → wire 投递 → client 缓存），由 Session Controller 通过 `session.follow()` opening 帧的 `projections` baseline + 后续 control frames 增量更新（"higher-seq wins"）。
- **Key 表**：所有注册进 [`@deepseek-ai/dsh-session-projection/types` SessionProjectionMap](../../node_modules/.pnpm/@deepseek-ai+dsh-session-pr_84cd66f454dbfc7490c4215f4e78e5dd/node_modules/@deepseek-ai/dsh-session-projection/lib/types/types.d.ts) 的 key。本仓库可见的注册：

| Key | 类型 | 来源包 | 对 v0.1 的用途 |
| --- | --- | --- | --- |
| `subagentCatalog` | `SubagentCatalogEntry[]` | `@deepseek-ai/dsh-subagent` | ✅ **直接子 subagent 列表**——subagent 子树的"子节点集合" |
| `subagent` | `SubagentIdentityProjection \| null` | `@deepseek-ai/dsh-subagent` | ✅ 当前 session 的身份（mode / label / seq） |
| `subagentTiming` | `SubagentTimingProjection` | `@deepseek-ai/dsh-subagent` | ✅ 累积耗时 + 当前 turn 边界 → 状态聚合 |
| `inbox` | `InboxWireState` | `@deepseek-ai/dsh-agent` | 待执行 inbox 投影（与 `useSession().queue` 类似但更原始） |
| `agentPreset` | `string \| null` | `@deepseek-ai/dsh-agent-presets` | 显示用的 preset 名 |
| `title` | 各种 session 标题投影 | `@deepseek-ai/dsh-session-title` | session 标题（给根节点 label 用） |
| `modelSelection` | `ModelSelectionProjection` | `@deepseek-ai/dsh-api-session-controller` | 模型选择 |

> **没看到任何"trajectory / events / steps"投影**。SessionProjectionMap 是 fold state 表，不是事件流。

**对 v0.1 的可用性**：

- ✅ **subagent 子树完全可以靠 `subagentCatalog` + `subagentTiming` + `subagent` 拼出来**（节点集合 + 状态聚合）
- ❌ **DAG 节点集合 / 父子 step 关系 / tool call 序列拿不到**——这是 task DAG 的核心数据
- ⚠️ **建议在 apply 阶段主动探查**：`useProjection` 在 key 不存在时返回 `undefined`（capability absent），可以安全轮询若干候选 key（如 `taskGraph`、`trajectory`、`events`）确认 host 是否提供专用投影。这是 v0.1 的可行性验证点。

### 2.3 `useSessions()` —— 全 session 列表（root 级钩子）

- **类型**：`SnapshotSelectorHook<SessionListState>`（[定义](../../node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/service.d.ts)）
- **作用域**：root（任何 slot 都可调，与 session 作用域无关）
- **可读字段**（[SessionListState](../../node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/service.d.ts#L61-L79)）：
  - `ids: SessionId[]` —— host 列表顺序
  - `byId: Record<SessionId, SessionSummary>` —— 行级数据
  - `current: SessionId | undefined` —— 当前打开的 session
  - `subagentsByParent: Record<SessionId, SubagentCatalogSnapshot>` —— **每个 parent 的子 session 列表**
  - `currentAddress: SubagentAddress | undefined` —— 当前选中的子 session 地址
- **SessionSummary 字段**：`parentId`, `origin: 'subagent' | undefined`, `running`, `blank`, `updatedAt`, `displayTitle`, `projectionValues`（含 subagentCatalog 等的快照）

**对 v0.1 的可用性**：

- ✅ **可重建完整 session 拓扑**（用 `byId[].parentId` 画全局树）
- ✅ **`subagentsByParent[parentId]` 与 `useProjection('subagentCatalog')` 是同一份事实的两种视图**（前者是 list 视图，后者是当前选中会话的视图）
- ⚠️ **跨 session 的"任务图"在 v0.1 不做**（ADR §六 out of scope），但单 session 内的"任务图"完全可以靠 `useSession()` + `useProjection()` 拼出来

### 2.4 `useWorkspaces()` —— workspace 列表（root 级）

与任务图无关，**v0.1 用不到**。仅记录在此以备后续。

---

## 三、事件窗口：v0.1 最大的盲点与三条出路

### 3.1 为什么事件窗口没在标准钩子里

任务图核心数据是 **session 事件流**（`turn/start`、`turn/end`、`step/start`、`step/end`、`user/message`、`assistant/message`、`tool/call`、`tool/result`…）。它们属于 [SessionEventMap](../../node_modules/.pnpm/@deepseek-ai+dsh-session@0._54d1a918d77e481567353c23a9e2039f/node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts)，序列化成 [SessionWireEvent](../../node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/types.d.ts#L397-L407) 后由 host 通过 [SessionEventStream](../../node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/transport.d.ts#L61-L76) 投递。

事件流由 [SessionEventSource](../../node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/contract/events.d.ts) 持有，**仅挂在 SessionBinding 上**：

```ts
export interface SessionBinding {
  readonly sessionId: SessionId;
  readonly session: SessionFace;        // ← 通过 useSession() 拿到
  readonly eventSource: SessionEventSource;   // ← 这一段没有标准钩子透出
  readonly ctx: AgentContext;
}
```

**而 SessionFace 是 `ISession & ObservableSnapshot<SessionSnapshot>`，不含 `eventSource`**。

所以 `useSession()` 不能直接拿到事件窗口。

### 3.2 出路 A（推荐）：从 `ctx.sessions` 拿 binding，跳过标准钩子

`ISessions.binding(id)` 返回 `SessionBinding | undefined`：

```ts
binding(id: SessionId): SessionBinding | undefined
```

**实施位置**：在 `src/client/task-graph/register.ts` 的 `apply(ctx)` 阶段（或新建 `src/client/task-graph/connector.ts`），订阅当前 session 变化的 listener，从 `ctx.sessions.binding(id)?.eventSource.getSnapshot().entries` 拿到 `SessionEventLikeEntry[]`。

具体步骤：

1. `ctx.sessions.list`（也是 observable）订阅，监测 `list.current`。
2. `current` 变 → 调 `ctx.sessions.binding(currentId)` 拿到 binding。
3. 订阅 `binding.eventSource`（用 `getSnapshot()` + `subscribe()`），把 entries 推到一个内存 store。
4. 在 `TaskGraphView` 组件里 `useStore()` 读这个 store（也走标准 kit，store seat 是 `register` 时声明的 `store:` 字段）。
5. 切 session 时调用 `binding.session.loadOlder()` 翻页老历史，事件窗口自动 prepend 进 eventSource。

**代价**：在 `apply` 阶段维护一个跨 session 的内存 store（需要 store seat；面 UI 库已有 `@deepseek-ai/dsh-client-store` 可用，[`createSnapshotStore`](../../node_modules/@deepseek-ai/dsh-client-store/lib/types/index.d.ts#L44)）。

**代价 2**：需要给 `inject` 列表加 `sessions`：

```ts
export const inject: readonly string[] = ['locale', 'slots', 'sessions']
```

### 3.3 出路 B：通过 ctx.effect 暴露一个 useEvents 自定义钩子

按 slot 系统的 inject face 契约，自定义钩子可以走：

1. 在 conversation shell 上游（或自己注册一个 session-scope provider）声明一个 session 作用域的 slot 节点。
2. 在那个节点里把事件流映射成 React hook。

**这条路过重**——我们要的是订阅当前 session 的事件流，不是再造一个 slot。**不推荐**。

### 3.4 出路 C：完全推断 + 启发式（v0.1 MVP 候选）

如果 host 不暴露事件流、或不想为 skyaxis 单独走 SessionBinding 通路，可以退回到**纯投影推断**：

- **Step 边界**：用 `useProjection('subagentTiming')` 推断 turn 边界（活跃 turn 用 `since/through`，累积用 `settledMs`）。
- **父子关系**：完全靠 `useProjection('subagentCatalog')` 的 `parentId` 关系画。
- **状态**：聚合 `useSession().running` / `subagentTiming.settledMs` / `subagent` 的 mode。

**问题**：拿不到 tool call / assistant message 的细分节点；节点 label 也只能从投影兜底（`title`、`agentPreset`），不是从 assistant text 提取。**这等价于 v0.1 只画 subagent 子树、不画任务 DAG**——与 ADR §二 决策冲突。

**结论**：**不推荐作为 v0.1 主路径**，仅作 fallback。如果出路 A 走通（应该能走通——SessionBinding 是公开 API，eventSource 是 readonly），就用 A。

### 3.5 决策建议

> **v0.1 走出路 A**：在 `apply` 阶段拿 SessionBinding.eventSource，事件窗口走内存 store + 标准 `useStore` 钩子。`inject` 列表追加 `sessions`。同时在 `useProjection()` 上轮询候选 key（`taskGraph` / `trajectory` / `events`）做 host 能力探测，若 host 提供专用投影则 v0.2 切到 projection 路径，省去 store 维护成本。

---

## 四、Subagent 子树：完全可用 useProjection 拼出来

### 4.1 数据拼装

```ts
// 假设已经在组件内
const session = useSession()                       // 当前 session 的 SessionFace
const currentSubagent = useProjection('subagent')  // 当前 subagent 的身份
const siblingCatalog = useProjection('subagentCatalog')  // 当前 session 的直接子列表

// 若当前 session 是个 subagent（currentSubagent 非 null）：
//   - label: currentSubagent.label
//   - mode: currentSubagent.mode ('one-shot' | 'continuable')
//   - status: 由 session.running + subagentTiming 推断
//   - seq: currentSubagent.seq（用于追溯到自己的描述符事件）

// siblingCatalog: SubagentCatalogEntry[]（按 session id 排序）
//   - 每个元素: { id, createdAt, mode, label? }
//   - 用于画 subagent 节点的兄弟 / 表亲
```

### 4.2 跨 session 拓扑（v0.1 暂不做，但数据就绪）

```ts
const list = useSessions()                         // 全 session 列表
const { byId, subagentsByParent, current } = list.getSnapshot()

// 树：以 current 为根，递归展开 byId[child].parentId === currentId 的子节点
// 状态聚合：递归聚合每个子节点的 subagentTiming.settledMs / byId[id].running
```

ADR §六 把"跨 session 视图"列在 out of scope。但 useSessions 拿到的拓扑数据，**v0.2 / v0.3 随时可用**。

### 4.3 状态聚合规则（subagent 子树专用）

| 子树节点状态 | 推断依据 |
| --- | --- |
| `running` | `byId[id].running === true` 或 `useProjection('subagentTiming').active !== undefined` |
| `done` | `running === false` 且 last step `step/end` 存在（待事件窗口接进来后可用） |
| `failed` | 无显式信号——**v0.1 不暴露 failed 视觉**（ADR §六） |
| `waiting` | 子节点有 `inbox` 待执行（`useProjection('inbox')['next-turn']` 非空） |
| `pending` | 节点存在但 `subagentTiming.settledMs === 0` 且无 active turn |

---

## 五、Task DAG：事件窗口接通后的推断规则

> **本节为设计草案，前提是 §三 出路 A 走通——events 进内存 store 后再写代码**。

### 5.1 节点边界推断

| 节点类型 | 边界事件 |
| --- | --- |
| `root` | 永远一个，session 的虚拟根 |
| `step` | `step/start` ... `step/end` 一对 |
| `tool-call` | 一个 `tool/call` + 后续 `tool/result`（不立即绘制中间——见下） |
| `approval` | `tool/call` 的 name 是 `approval_*` 时升级为 approval 节点（DSH 已知模式） |
| `subagent` | 该 step 内有 `tool/call` 触发了一个子 session（用 §4 的 `subagentCatalog` 反查） |
| `user-message` | `user/message` 事件，作为 step 的根 |
| `assistant-message` | `assistant/message` 事件，与所在 step 同生 |

### 5.2 父子关系

- `step` 的父：所在 `turn/start/end` 区间内的上一个 `user/message`（即"该 turn 触发的若干 step"）。
- `tool-call` 的父：所在 `step/start/end` 区间。
- `subagent` 节点的父：触发它的 `tool/call`。
- `subagent` 节点的子：递归到子 session 的 events。

### 5.3 状态映射

| DAG 节点状态 | 事件序列特征 |
| --- | --- |
| `pending` | `step/start` 还没出现 |
| `running` | `step/start` 出现，`step/end` 还没出现 |
| `done` | `step/end` 出现，且无 `tool/result.isError` |
| `failed` | `step/end` 出现，且区间内任一 `tool/result` 含 `error` 字段（[tool/result 类型](../../node_modules/.pnpm/@deepseek-ai+dsh-session@0._54d1a918d77e481567353c23a9e2039f/node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts#L351-L361)） |
| `waiting` | 区间内有 `tool/call` 是 approval 类（DSH 已知 approval 工具集），且 `tool/result` 未到 |

### 5.4 Label 推断

- `step`：第一个相邻的 `assistant/message.message.content` 的首段文字；若无则用 `第 N 步`。
- `tool-call`：`tool/call.name`（如 `Read`、`Grep`、`Bash`）。
- `subagent`：`subagent.label`（projection）。
- `user-message`：`user/message.content` 首段。

### 5.5 v0.1 不做的事（ADR §六 同步）

- ❌ 不画失败 elevation（节点状态自然承载）
- ❌ 不画时间成本（事件时间戳现成，但视觉密度低，留 v0.2）
- ❌ 不画工具 / 文件频率聚合
- ❌ 不画跨 session 视图
- ❌ 不支持编辑 / 标注任务结构

---

## 六、v0.1 落地清单（不动代码，只列影响面）

| 文件 | 改动 | 类型 | 备注 |
| --- | --- | --- | --- |
| `src/client/index.ts` | `inject` 列表追加 `'sessions'` | 修改 | 当前只声明 `['locale','slots']`；为拿 SessionBinding 必须加 sessions |
| `src/client/task-graph/register.ts` | 新增 connector：subscribe list.current → binding.eventSource → store | 修改 | apply 阶段执行；返回 disposer 跟着 `ctx.slots.inject` 一起清理 |
| `src/client/task-graph/` | 新增 `connector.ts`（or `events-bridge.ts`）+ `store.ts`（基于 `createSnapshotStore`） | 新增 | 内存 store 维护当前 session 的事件窗口 + subagent 拓扑 |
| `src/client/task-graph/view.tsx` | 从硬编码 `seed` 切到 `useStore` 读 store；保留 seed 作为 fallback（`binding === undefined` 时） | 修改 | React Flow 的 `nodes / edges` 来自推断函数 |
| `src/client/task-graph/` | 新增 `infer.ts`：events → DAG 推断（§5 规则） | 新增 | 纯函数，输入 SessionEventLikeEntry[]，输出 TaskNode[] + TaskEdge[] |
| `src/client/task-graph/types.ts` | `data` 类型扩展：`{ label, status, nodeType, refSeq?, parentRefSeq? }` | 修改 | subagent 节点 type 字段复用现有 `TaskNodeType` |
| `src/client/task-graph/register.ts` | `declare module '@deepseek-ai/cordis'` / `SlotMap` / `LocaleNamespaceMap` | 修改 | 需追加 `SessionStandardProps` / `useSession` / `useProjection` 的类型声明合并（参考 SKILL.md "Session and page data"） |
| `package.json#dsh.client` | `inject` 列表追加 `@deepseek-ai/dsh-api-session-controller` | 修改 | 保证运行时该 plugin 先于 skyaxis 加载，提供 `ctx.sessions` |
| `src/client/index.ts` | 同步更新顶部注释 | 修改 | `inject` 与 dsh.client 的关系，参考 register.ts §30-32 |

---

## 七、未决问题（留给后续 research / ADR）

1. **事件窗口接进来后是否需要 UI 层的"折叠/展开"**：subagent 子树在百级节点量级时是否默认折叠？现有 ADR §七.2 已留口子，但具体阈值要等接进真实数据后看实际会话大小才能定。
2. **多 subagent 嵌套的视觉深度**：subagent 还能 spawn subagent，递归 5 层以上画布就糊；是否在 v0.1 加 `delegationDepth` 截断（`SessionWireHeader.delegationDepth` 字段已有）？
3. **失败/卡点视觉**：ADR §六 推迟到 v0.2，但 events 接进来后实现成本很低（一行 `isError` 判断）；若 v0.1 demo 数据能看到失败案例，建议提前做。
4. **store seat 的所有权**：建议把 §6 的内存 store 注册为 **session-scope store**（store handle 的 `scope: 'session'`），session 退出时实例自动销毁。是否要单独 store handle，定义在 §6 文件里要拍。
5. **与 dsh-host-webserver 的协作**：当前 `apply` 是 no-op（`src/index.ts` §6），不需要；但 `apply` 阶段要不要订阅 host 端的 cron / scheduled session 列表？v0.1 不做，留 v0.2。

---

## 八、Sources

- [@deepseek-ai/dsh-client-ui-slots SlotMap / StandardSourceBinding / SlotScopeAdapter](file:///C:/Users/lorcan.lei/VSCodeProjects/skyaxis/node_modules/.pnpm/@deepseek-ai+dsh-client-ui-_b51bd2af0a8da26f448eb072f93127c9/node_modules/@deepseek-ai/dsh-client-ui-slots/lib/types/index.d.ts)
- [@deepseek-ai/dsh-client-ui-renderer bindings / standard-kit synthesis](file:///C:/Users/lorcan.lei/VSCodeProjects/skyaxis/node_modules/.pnpm/@deepseek-ai+dsh-client-ui-_47990e2cb23dc4be594f1a5142eb56fc/node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/client.js)
- [@deepseek-ai/dsh-client-store defineStore / createSnapshotStore](file:///C:/Users/lorcan.lei/VSCodeProjects/skyaxis/node_modules/@deepseek-ai/dsh-client-store/lib/types/index.d.ts)
- [@deepseek-ai/dsh-api-session-controller SessionFace / ISession / ISessions](file:///C:/Users/lorcan.lei/VSCodeProjects/skyaxis/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/contract/session.d.ts)
- [@deepseek-ai/dsh-api-session-controller SessionEventSource / SessionEventWindow / SessionEventLikeEntry](file:///C:/Users/lorcan.lei/VSCodeProjects/skyaxis/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/contract/events.d.ts)
- [@deepseek-ai/dsh-api-session-controller UseProjection / ProjectionValueStore](file:///C:/Users/lorcan.lei/VSCodeProjects/skyaxis/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/projection-store.d.ts)
- [@deepseek-ai/dsh-api-session-controller SessionListState / SessionSummary / SessionBinding](file:///C:/Users/lorcan.lei/VSCodeProjects/skyaxis/node_modules/@deepseek-ai/dsh-api-session-controller/lib/types/client/sessions/service.d.ts)
- [@deepseek-ai/dsh-session SessionEventMap（turn / user / assistant / tool 事件）](file:///C:/Users/lorcan.lei/VSCodeProjects/skyaxis/node_modules/.pnpm/@deepseek-ai+dsh-session@0._54d1a918d77e481567353c23a9e2039f/node_modules/@deepseek-ai/dsh-session/lib/types/types.d.ts)
- [@deepseek-ai/dsh-subagent SubagentCatalogEntry / SubagentIdentityProjection / SubagentTimingProjection](file:///C:/Users/lorcan.lei/VSCodeProjects/skyaxis/node_modules/.pnpm/@deepseek-ai+dsh-subagent@0_92c5d82562c9fe5f26cd1898719af442/node_modules/@deepseek-ai/dsh-subagent/lib/types/projection-types.d.ts)
- [@deepseek-ai/dsh-agent-presets cordis-plugin-development SKILL.md §"Session and page data"](file:///C:/Users/lorcan.lei/VSCodeProjects/skyaxis/node_modules/.pnpm/@deepseek-ai+dsh-agent-pres_fc9bf98ae5865ea9f109f84a7d78519a/node_modules/@deepseek-ai/dsh-agent-presets/presets/cordis/skills/cordis-plugin-development/SKILL.md)
- [ADR 0001 §五.3 数据来源 / §六 Out of Scope](file:///C:/Users/lorcan.lei/VSCodeProjects/skyaxis/docs/decisions/0001-单session可视化v0.1-任务图与subagent子树.md)
- [Research 0001 React Flow + Dagre Demo 调研](file:///C:/Users/lorcan.lei/VSCodeProjects/skyaxis/docs/research/0001-react-flow-dagre-minimal-demo.md)