# 02 数据源接入：每个数据源的类型、用途与获取方式

> 本文档梳理 `task-dag-viewer` 实际依赖的全部数据源。每个数据源都对应宿主平台已有的一个稳定接口；插件没有引入任何新的持久层。

## 1. 数据源全景图

```
┌──────────────────────────────────────────────────────────────────┐
│                    task-dag-viewer 全部 6 个数据源                   │
├─────────────┬────────────────────┬──────────────┬────────────────┤
│ 数据源      │ 类型               │ 解决问题      │ 读取方式       │
├─────────────┼────────────────────┼──────────────┼────────────────┤
│ SessionList │ Client 投影 (React │ 子代理血缘 +  │ useSessions    │
│  State      │ Hook)              │ 目录健康      │                │
├─────────────┼────────────────────┼──────────────┼────────────────┤
│ Session     │ Client 投影        │ 当前 Session  │ useSession     │
│ State       │ (React Hook)       │ 的运行状态    │                │
├─────────────┼────────────────────┼──────────────┼────────────────┤
│ Chat view   │ Client 投影        │ 持久事件流    │ useConversation│
│ (conversa-  │ (React Hook)       │              │                │
│ tion nodes) │                    │              │                │
├─────────────┼────────────────────┼──────────────┼────────────────┤
│ Team v1     │ Host 持久事件      │ Agent Teams  │ 由 plugin 自己 │
│ event       │                    │ 状态          │ 注册的 convo   │
│             │                    │              │ definition     │
├─────────────┼────────────────────┼──────────────┼────────────────┤
│ workflow-   │ Conversation Node  │ 持久 Workflow │ Chat view      │
│ run node    │ (宿主平台原生)         │ run + 阶段    │ 内 kind==='    │
│             │                    │              │ workflow-run'  │
├─────────────┼────────────────────┼──────────────┼────────────────┤
│ tool-call   │ Conversation Node  │ Workflow 编排 │ Chat view      │
│ node        │ (宿主平台原生)         │ 脚本 + 定义   │ 内 kind==='    │
│             │                    │              │ tool-call'     │
└─────────────┴────────────────────┴──────────────┴────────────────┘
```

> 此外还有**插件自己注册的第 7 个数据源**——`taskDagAgentMetrics` Session 投影，在 [06-metrics-honesty.md](06-metrics-honesty.md) 详细讨论。

## 2. 数据源 1：`useSessions` —— Session 列表与目录

### 类型

宿主平台提供的 React Hook，订阅全局 Session Store。

### 解决什么问题

- 哪些 Session 仍存在于 Session 列表中（**这是"能否打开"的唯一根据**）。
- 每个 Session 的标签、模式、活动状态、目录健康情况。
- Session 之间的父子血缘（`origin: "subagent"` + `parentId`）。
- 每个 Session 自带的"完整日志"投影（`tokenUsage`、`sessionStats`、插件注册的 `taskDagAgentMetrics`）。

### 怎么获取

```js
// src/client.js
const summaries    = useSessions(state => state.byId);
const catalogs     = useSessions(state => state.subagentsByParent);
const ordinaryIds  = useSessions(state => state.ids);
```

| 选择器 | 含义 | 用途 |
| --- | --- | --- |
| `state.byId` | 按 ID 索引的 Session 摘要 Map | 反查血缘、状态、投影值 |
| `state.subagentsByParent` | 按父 Session 索引的目录（catalog） | 解析 teammate / 子代理的 mode、activity、label |
| `state.ids` | 当前所有可见 Session 的 ID 列表 | 判定某个节点是否可导航 |

### 字段约定

```js
summaries[sessionId] = {
  id, displayTitle, origin, parentId,
  completed, running, updatedAt,
  projectionValues: {
    tokenUsage:       { uncachedInputTokens, outputTokens, cacheReadTokens, cacheWriteTokens },
    sessionStats:     { turns, steps },
    taskDagAgentMetrics: { provider, model, reasoningEffort?, reasoningSource },
  },
}

catalogs[parentId] = {
  entries: [
    { kind: 'child', id, activity, mode, label },
    ...
  ]
}
```

### 关键约束

- **只接受 `origin === 'subagent'` 的血缘链路**。其他 origin（手动创建、群组导入等）会被 `lineageDepths()` 忽略（`src/graph-model.js` 第 113-155 行）。
- **孤儿（parentId 找不到）会丢弃**；**环（A.parent=B 且 B.parent=A）会丢弃整圈**。
- **只有 `ordinaryIds` 里出现的 Session 才能被点击导航**——这是用户期待的诚实行为：列表里都没有的 Session 不要假装能打开。

## 3. 数据源 2：`useSession` —— 当前 Session 的实时状态

### 类型

宿主平台提供的 React Hook，订阅当前 Session 的状态机。

### 解决什么问题

- 当前 Session 是否 `running` → 决定根节点状态。
- `rootRunning` 在画布右上角的 "live dot" 上展示。

### 怎么获取

```js
const rootRunning = useSession(state => state.running);
```

### 字段约定

只有 `running: boolean` 一个字段被消费。

## 4. 数据源 3：`useConversation` —— 持久 Conversation 节点流

### 类型

宿主平台提供的 React Hook，订阅 Session 的 `chat` 视图节点流。

### 解决什么问题

插件消费的**核心数据源**。所有 Agent Teams、Workflow、Tool-Call 事件都从这里来。

### 怎么获取

```js
// src/client.js
const chatNodes = useConversation(
  state => state.views.get('chat')?.legacy.nodes ?? EMPTY_CHAT_NODES,
  sameArray,  // 自定义相等比较，避免每次 nodes 浅不等就重渲
);
```

### 节点类型

| `kind` | 来源 | 用途 |
| --- | --- | --- |
| `'workflow-run'` | 宿主平台原生 | Workflow 运行记录 |
| `'tool-call'` | 宿主平台原生 | 工具调用；用于提取 `workflow` 工具的 `argsRaw` |
| `'task-dag-team-snapshot'` | **本插件自己注册** | Team 事件折叠后的隐藏节点 |

### 关键约束

- **节点流是事件式的**——同一个 Task 可能出现多次快照，每次 `revision` 更大。
- **Plugin 不会直接订阅 Chat 事件**，而是通过 `createTeamSnapshotDefinition()` 注册一个 Conversation Node Definition，让宿主平台自己负责折叠。
- **`sameArray` 比较器**：因为 `useConversation` 默认返回新数组，必须用引用相等或浅比较避免下游 `useMemo` 频繁失效。

### 节点结构示例

```js
chatNodes[i] = {
  id, kind, anchorSeq, location, visibility,
  data: { /* 业务载荷 */ },
}
```

`workflow-run` 节点 data 结构（宿主平台持久化形态）：

```js
{
  name, status,
  phases: [
    { key, phase, members: [{ childId, seq, label, status }] },
  ],
}
```

`tool-call` 节点 data 结构（宿主平台持久化形态）：

```js
{
  root: {
    kind: 'tool-result',          // 可能是 'tool-result' 或 'tool-call'
    callId,
    call: { name: 'workflow', argsRaw: '{"script":"...","meta":{...}}' },
  },
}
```

`task-dag-team-snapshot` 节点 data 结构（插件自定义）见 [02-data-sources.md §6](#6-数据源-4team-v1-event--本插件自己产生的隐藏-conversation-node)。

## 5. 数据源 4：`uiConversation.events` —— 本插件自己产生的隐藏 Conversation Node

### 类型

宿主平台 `0.1.2-rc.1` 引入的注册中心，插件通过它声明"如何把事件折叠成节点"。

### 解决什么问题

宿主平台的 Team v1 事件（`team/member`、`team/task`、`team/message/queued`、`team/message/delivered`）只在 Team Lead Session 内出现，且分散在事件流里。插件需要一种**跨视图、跨刷新**的"小型快照"形态，让 `useConversation` 可以读到。

### 怎么获取

插件**自己注册**一个 Conversation Node Definition：

```js
// src/team-projection.js
export function createTeamSnapshotDefinition() {
  return {
    kind: TEAM_SNAPSHOT_KIND,           // 'task-dag-team-snapshot'
    target: 'chat',
    match(event) {
      const snapshot = projectTeamEvent(event);
      return snapshot === null ? null : { id: String(snapshot.seq), role: 'start' };
    },
    start(_context, match) { return projectTeamEvent(match.event); },
    update(context) { return context.state; },  // 一次性 snapshot，不累积
    buildViewNode(context) { return { kind: TEAM_SNAPSHOT_KIND, /* ... */ data: context.state }; },
  };
}

// src/client.js
ctx.effect(() => ctx.uiConversation.events.register(createTeamSnapshotDefinition()),
           'task-dag: Team snapshots');
```

### 事件 → snapshot 的折叠规则（`projectTeamEvent`）

| 事件 | 必要字段 | 折叠结果 |
| --- | --- | --- |
| `team/member` | `member.{id,name,phase}` | `{ type: 'member', member: { id,name,description,phase,error? } }` |
| `team/task` | `task.{id,revision,subject,status}` | `{ type: 'task', task: { id,revision,subject,description,status,ownerId?,blockedBy } }` |
| `team/message/queued` | `message.{id,senderId,targetId,senderName}` | `{ type: 'message', message: { id,senderId,senderName,targetId,delivery,text,nonText } }` |
| `team/message/delivered` | `messageId, targetId` | `{ type: 'delivery', messageId, targetId }` |

### 关键约束

- **只折叠 `version === 1` 的事件**（`src/team-projection.js` 第 26 行）——上游 schema 升到 v2 时本插件的折叠器会自动忽略它而不是猜测。
- **每个事件只能产出一个 snapshot**——这是 `role: 'start'` 的含义（`update` 函数返回原 state，不在 update 上累积）。
- **节点 `visibility: 'hidden'`**——它不会被宿主平台渲染到主聊天区，但 `useConversation` 仍然能读到。

## 6. 数据源 5：`workflow-run` Conversation Node

### 类型

宿主平台原生的 Conversation Node，由宿主平台的 Workflow runtime 写入。

### 解决什么问题

持久化每一个 Workflow run 的：

- 名称、整体状态（`running / completed / failed`）。
- 阶段列表（`phases`），每个阶段带成员 Session ID 列表。
- 每个成员 Session 的状态、标签、序号。

### 怎么获取

不需要专门订阅。它是 `chat` 视图普通节点，`kind === 'workflow-run'`。插件通过 `chatNodes.filter(node => node.kind === 'workflow-run')` 拿到。

### 字段约定

```js
{
  id: 'run-42',                  // 用于命名空间 workflow:run-42
  anchorSeq: 17,                 // 在 Chat 中的位置
  data: {
    name: 'workflow-root-visual-validation',
    status: 'running',
    phases: [
      {
        key: 'parallel-checks',  // 用于命名空间 workflow-phase:run-42:parallel-checks
        phase: 'parallel-checks',// 阶段显示名
        members: [
          { childId: 'sess-alpha', seq: 1, label: 'Alpha', status: 'running' },
          { childId: 'sess-beta',  seq: 2, label: 'Beta',  status: 'completed' },
        ],
      },
      ...
    ],
  },
}
```

### 关键约束

- **`phases` 字段是宿主平台持久化的"展示分组"，不是脚本内部的 `parallel()/pipeline()` 控制流**——这是 Workflow 视图反复强调的诚实边界。
- **不存在阶段节点时（`phases.length === 1` 且 phase 为空）不创建 phase 节点**，成员直接挂在 workflow 节点下（`src/graph-model.js` 第 412-413 行）。

## 7. 数据源 6：`tool-call` Conversation Node（用于 Workflow 定义）

### 类型

宿主平台原生的 Conversation Node，由宿主平台在执行工具调用时持久化。

### 解决什么问题

Workflow 工具调用时的原始 `argsRaw` JSON 包含：

- `script`: 完整的 JavaScript 编排代码。
- `meta`: 名称、描述、适用场景、阶段声明。

### 怎么获取

不需要专门订阅。它是 `chat` 视图普通节点，`kind === 'tool-call'`。

### 提取规则（`extractWorkflowDefinition`）

```js
// src/workflow-definition.js
function toolCallMaterial(viewNode) {
  if (!viewNode || viewNode.kind !== 'tool-call' || !isRecord(viewNode.data)) return null;
  const root = viewNode.data.root;
  if (!isRecord(root)) return null;
  const settled = root.kind === 'tool-result';
  const call = settled ? root.call : root;
  if (!isRecord(call) || call.name !== 'workflow' || typeof call.argsRaw !== 'string') return null;
  return { callId, toolName, argsRaw, anchorSeq };
}
```

### 匹配规则（`attachWorkflowDefinitions`）

```js
// 给每个 workflow-run 节点匹配同名 workflow tool-call：
//   1. 取出所有 tool-call 节点，提取定义；
//   2. 按 anchorSeq 排序（最新在前）；
//   3. 对每个 run，按 anchorSeq 升序匹配 callId 未被占用、
//      definition.anchorSeq ≤ run.anchorSeq 且 meta.name === run.name 的最早定义。
```

> **关键设计：按 `callId + anchorSeq` 唯一标识**，避免同一个 `name` 的多次 call/run 在批量到达时混淆。

## 8. 数据源 7（本插件注册的）：`taskDagAgentMetrics` Session 投影

### 类型

Cordis Session Projection，由 `src/index.js` 注册。

### 解决什么问题

把"最近一次请求的 Provider / 模型 / 思考深度 / 来源"折叠成 Session 级别的小型持久值，Client 可以从 `summaries[sessionId].projectionValues.taskDagAgentMetrics` 读取。

### 怎么获取

```js
// Host 注册
ctx.inject(['sessionProjections'], scope =>
  scope.sessionProjections.register(metricsProjection)
);

// Client 读取（src/graph-model.js#agentMetrics）
const route = summaries[sessionId].projectionValues.taskDagAgentMetrics;
```

### 折叠规则（`apply` 状态机）

```js
// src/index.js
apply(state, event) {
  if (event.type !== 'request/header') return state;
  const config = event.data.header.config;
  return {
    provider: config.provider,
    model: config.model,
    ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
    reasoningSource: reasoningEffort === undefined
      ? 'not-recorded'
      : event.data.header.adapterDefaults?.reasoningEffort === true
        ? 'adapter-default'
        : 'request-config',
  };
}
```

> 详细语义和"诚实表达"原则请见 [06-metrics-honesty.md](06-metrics-honesty.md)。

## 9. 跨数据源汇总：`graph-model.js` 怎么融合它们

```js
// src/graph-model.js#buildGraph 签名
buildGraph({
  rootId,          // 来自 useSession
  rootRunning,     // 来自 useSession
  summaries,       // 来自 useSessions.state.byId
  catalogs,        // 来自 useSessions.state.subagentsByParent
  ordinaryIds,     // 来自 useSessions.state.ids
  teamNodes,       // 来自 chatNodes.filter(kind === TEAM_SNAPSHOT_KIND)
  workflowNodes,   // 来自 attachWorkflowDefinitions(chatNodes.filter(kind === 'workflow-run'), chatNodes)
  mode,            // 'overview' | 'team' | 'workflow'
  t,               // i18n
})
```

六个数据源全部在此汇聚，然后按 mode 决定哪些层进入图（见 [03-data-processing.md](03-data-processing.md)）。

## 10. 数据源获取的边界

| 你**应该**做的 | 你**不应该**做的 |
| --- | --- |
| 通过 `useSessions / useSession / useConversation` Hook 订阅宿主平台状态 | 自行通过 WebSocket / fetch 拉取宿主平台内部状态 |
| 通过 `uiConversation.events.register` 注册自己的折叠器 | 直接监听 Chat 原始事件 |
| 通过 `sessionProjections.register` 注册 Session 级别投影 | 写入 `tokenUsage` / `sessionStats` 等宿主平台自有投影 |
| 通过 `ctx.slots.inject` 注入 UI 入口 | 直接操作宿主平台标题栏 DOM |
| 复用宿主平台 UI Primitives（`CodeBlock`、`IconCloseOutline16` 等） | 引入第三方 UI 组件库 |

下一步：[03-data-processing.md](03-data-processing.md) 讲述拿到原始数据后如何折叠成图节点/边并交给渲染层。
