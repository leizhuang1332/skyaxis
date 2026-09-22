# 03 数据处理：源数据 → 图数据 → 渲染 DAG

> 本文档衔接 [02-data-sources.md](02-data-sources.md)，讲清楚"拿到原始数据后到底发生了什么"。读完你应该能在脑里复现出 `buildGraph` 的每一步。

## 1. 数据处理流水线总览

```
                              (L1 数据源)
                                │
                                ▼
   ┌─────────────────────────────────────────────────────┐
   │  ① foldTeam()     折叠 Team snapshots              │
   │     ↓                                                 │
   │  ② catalogIndex()  索引所有目录条目                   │
   │     ↓                                                 │
   │  ③ createBuilder() 初始化根节点 + 容器                │
   │     ↓                                                 │
   │  ④ addTeamGraph()       Team 视图：成员+任务+通信      │
   │     ↓                                                 │
   │  ⑤ addWorkflowGraph()   Workflow 视图：run+阶段+成员  │
   │     ↓                                                 │
   │  ⑥ addGenericSubagents()  Overview：剩余普通子代理    │
   │     ↓                                                 │
   │  ⑦ 汇总：parentIds / activeCount / hasTeamData ...    │
   └─────────────────────────────────────────────────────┘
                                │
                                ▼
   ┌─────────────────────────────────────────────────────┐
   │  ⑧ graphLayout()  确定性分层 + 坐标赋值（见 04）      │
   └─────────────────────────────────────────────────────┘
                                │
                                ▼
   ┌─────────────────────────────────────────────────────┐
   │  ⑨ React 渲染    src/client.js  TaskGraph            │
   │      ├── GraphNode  每个 SVG <g>                     │
   │      ├── GraphEdge  每条边一个 <path> / <g>          │
   │      └── NodeMetricsTooltip  Portal 弹出的 tooltip   │
   └─────────────────────────────────────────────────────┘
```

下面按序号逐层讲解。

## 2. 步骤 ①：折叠 Team 事件（`foldTeam`）

> 位置：`src/graph-model.js#foldTeam`，行 157-182。

```js
function foldTeam(rootId, teamNodes) {
  const members = new Map();
  const tasks = new Map();
  const messages = new Map();
  const delivered = new Set();
  const snapshots = [...teamNodes].sort((left, right) => left.anchorSeq - right.anchorSeq);
  for (const node of snapshots) {
    const data = node.data;
    if (data?.teamId !== rootId) continue;          // ① 归属过滤
    if (data.type === 'member') {
      const previous = members.get(data.member.id);
      if (previous === undefined || data.seq >= previous.seq)
        members.set(data.member.id, data);           // ② 同一 memberId 只保留最新
    } else if (data.type === 'task') {
      const previous = tasks.get(data.task.id);
      if (previous === undefined
        || data.task.revision > previous.task.revision
        || (data.task.revision === previous.task.revision && data.seq >= previous.seq))
        tasks.set(data.task.id, data);               // ③ 同 taskId 取 revision 最大
    } else if (data.type === 'message') {
      messages.set(data.message.id, data);           // ④ 消息保留全部
    } else if (data.type === 'delivery') {
      delivered.add(data.messageId);                 // ⑤ 投递回执是 Set
    }
  }
  return { members, tasks, messages, delivered };
}
```

### 关键折叠规则

| 集合 | 折叠策略 | 原因 |
| --- | --- | --- |
| `members` | 同 ID 取 `seq` 最大 | 同一 teammate 可能有多次成员事件（创建→更新） |
| `tasks` | 同 ID 取 `revision` 最大；同 revision 取 `seq` 最大 | Team v1 协议用 `revision` 表达完整覆盖 |
| `messages` | 不折叠，按 ID 去重即可 | 历史消息用于通信边的时间线展示 |
| `delivered` | `Set<messageId>` | 用于把 `queued → delivered` 标记上去 |

### 关键过滤：归属过滤

`if (data?.teamId !== rootId) continue;` —— 当前根 Session 不是 Team Lead 时，整个 Team 块被跳过。这正是 **"Team 任务板只存在于 Team Lead Session"** 原则的落地。

### 输出

```js
{
  members:  Map<memberId, snapshot>,
  tasks:    Map<taskId,   snapshot>,
  messages: Map<messageId, snapshot>,
  delivered: Set<messageId>,
}
```

## 3. 步骤 ②：构建目录索引（`catalogIndex`）

> 位置：`src/graph-model.js#catalogIndex`，行 97-111。

```js
function catalogIndex(catalogs) {
  const indexed = new Map();
  for (const [parentId, catalog] of Object.entries(catalogs)) {
    for (const entry of catalog.entries || []) {
      if (entry.kind !== 'child') continue;
      indexed.set(entry.id, {
        parentId, activity, mode, label,
      });
    }
  }
  return indexed;
}
```

把 `subagentsByParent[parentId].entries[].kind === 'child'` 的条目扁平化为 `Map<sessionId, { parentId, activity, mode, label }>`。

用途：

- 解析 teammate 节点的 `mode`（决定节点 `type`）。
- 解析 `activity`（running / idle）→ 节点 `status`。
- 解析 `label`（人类可读名）。

## 4. 步骤 ③：初始化图构建器（`createBuilder`）

> 位置：`src/graph-model.js#createBuilder`，行 202-235。

```js
const builder = createBuilder(rootId, rootRunning, summaries, ordinaryIds, t);
```

### 三个核心 Map / Set

| 名字 | 类型 | 用途 |
| --- | --- | --- |
| `nodesById` | `Map<id, node>` | 去重添加节点；`addNode` 是幂等的 |
| `edgesById` | `Map<id, edge>` | 去重添加边；`addEdge` 是幂等的 |
| `ordinary` | `Set<sessionId>` | 只有这个集合里的节点 `navigable = true` |

### `addNode` / `addEdge` 规则

```js
const addNode = (node) => { nodesById.set(node.id, node); return node; };

const addEdge = (edge) => {
  if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) return;  // 自动忽略悬空边
  const id = edge.id || `${edge.kind}:${edge.from}>${edge.to}`;
  edgesById.set(id, { ...edge, id });
};
```

`addEdge` 自动剔除悬空边 → 这是**异常环 fallback 的第一道防线**（详见 [05-cycle-fallback.md](05-cycle-fallback.md)）。

### 根节点

```js
nodesById.set(rootId, {
  id: rootId,
  label: rootSummary?.displayTitle || t('node.fallback'),
  meta: t('node.current'),
  type: 'root',
  status: rootRunning ? 'running' : rootSummary?.completed ? 'completed' : 'idle',
  navigable: false,
  navigationId: null,
  order: -1,                     // 永远在最左侧
});
```

> 根节点的 `order = -1` 很重要——它让 `nodeComparator` 在排序时永远把它放在同层最前面。

## 5. 步骤 ④：Team 视图图构建（`addTeamGraph`）

> 位置：`src/graph-model.js#addTeamGraph`，行 237-384。

分四小步：

### ④.1 创建 teammate 节点

```js
for (const snapshot of memberSnapshots) {
  const id = `agent:${member.id}`;
  builder.addNode({
    id,
    label: member.name,
    meta: member.phase === 'failed' && member.error ? member.error : t('node.teammate'),
    type: 'teammate',
    status: member.phase === 'failed' ? 'failed'
           : member.phase === 'provisioning' ? 'provisioning'
           : summaryStatus(summary, detail),
    navigable: builder.ordinary.has(member.id),   // 只对仍在 Session 列表里的可见 teammate 可导航
    navigationId: member.id,
    order: snapshot.seq,                          // seq 越小越靠左
    description: member.description,
    metrics: agentMetrics(summary),
  });
  builder.addEdge({ from: rootId, to: id, kind: 'team', layout: true });
}
```

### ④.2 创建任务节点 + 分配边

```js
for (const snapshot of taskSnapshots) {
  const task = snapshot.task;
  const blockersComplete = task.blockedBy.length === 0 || task.blockedBy.every((id) => {
    const blocker = activeTasks.get(id);
    return blocker !== undefined && blocker.status === 'completed';
  });
  const status = task.status === 'completed' ? 'completed'
               : task.status === 'in_progress' ? 'running'
               : blockersComplete ? 'ready' : 'blocked';
  ...
  builder.addEdge({ from: ownerNode, to: id, kind: 'assignment', layout: true });
}
```

**任务状态折叠规则**：

| Task.status | Blockers 全部 completed | 节点 status |
| --- | --- | --- |
| `completed` | — | `completed` |
| `in_progress` | — | `running` |
| 其它 | 是 | `ready` |
| 其它 | 否 | `blocked` |

### ④.3 创建任务依赖边

```js
for (const snapshot of taskSnapshots) {
  for (const blockerId of snapshot.task.blockedBy) {
    if (!activeTasks.has(blockerId)) continue;       // 已删除任务的 blocker 忽略
    builder.addEdge({
      from: `team-task:${blockerId}`,
      to:   `team-task:${snapshot.task.id}`,
      kind: 'dependency',
      layout: true,
    });
  }
}
```

> 这是**唯一的真实 DAG 依赖边**——其它边（`team`、`assignment`、`workflow`、`phase`）都不是脚本依赖，**只有 `dependency` 才是**。

### ④.4 创建通信边（**永远 layout: false**）

```js
for (const channel of channels.values()) {
  const reverse = channels.has(`${channel.targetId}>${channel.senderId}`);
  builder.addEdge({
    id: `communication:${channel.senderId}>${channel.targetId}`,
    from: channel.from, to: channel.to,
    kind: 'communication',
    layout: false,           // ← 不参与布局，永远是覆盖层
    count: channel.messages.length,
    pending,
    reverse,
    curve: reverse ? (channel.senderId.localeCompare(channel.targetId) < 0 ? -1 : 1) : 0,
    senderName, targetName, messages: channel.messages,
  });
}
```

**两个关键诚实设计**：

1. `layout: false` —— 通信可能双向成环（`reverse === true`），**绝不能进入拓扑排序**，否则会触发 fallback。
2. **成对的反向通道 curve 偏移相反**（`-1` 与 `+1`），渲染时 SVG 路径自然分开不重叠。

### ④.5 `ensureAgent` 兜底

如果消息的 `senderId / targetId` 不在 `team.members` 里（例如对端是普通子代理或已离开的 teammate），调用 `ensureAgent(sessionId, fallbackName)` 兜底创建一个 `agent:<sessionId>` 节点，保证通信两端都能渲染。

## 6. 步骤 ⑤：Workflow 视图图构建（`addWorkflowGraph`）

> 位置：`src/graph-model.js#addWorkflowGraph`，行 386-457。

### ⑤.1 创建 Workflow run 节点

```js
const workflowId = `workflow:${viewNode.id}`;
builder.addNode({
  id: workflowId,
  label: data.name || t('node.workflow'),
  meta: metaParts.join(' · '),         // "3 个成员 · 2 个阶段 · 可预览代码"
  type: 'workflow',
  status: normalizeStatus(data.status),
  navigable: false,                    // run 不可点击导航（应该点定义详情）
  navigationId: null,
  inspectable: true,                   // 可点击打开定义详情
  definition: data.definition || null, // 由 attachWorkflowDefinitions 注入
  order: viewNode.anchorSeq,
});
builder.addEdge({ from: rootId, to: workflowId, kind: 'workflow', layout: true });
```

### ⑤.2 创建阶段分组节点（条件性）

```js
const usePhaseNodes = phases.length > 1 || phases.some(phase => phase.phase);
phases.forEach((phase, phaseIndex) => {
  let parentId = workflowId;
  if (usePhaseNodes) {
    parentId = `workflow-phase:${viewNode.id}:${phase.key || phaseIndex}`;
    const phaseStatus = members.some(m => normalizeStatus(m.status) === 'running') ? 'running'
                      : members.some(m => normalizeStatus(m.status) === 'failed') ? 'failed'
                      : members.length > 0 && members.every(m => normalizeStatus(m.status) === 'completed')
                        ? 'completed'
                        : normalizeStatus(data.status);
    builder.addNode({ id: parentId, label: phaseName(phase.phase, t), ... });
    builder.addEdge({ from: workflowId, to: parentId, kind: 'phase', layout: true });
  }
  members.forEach((member, memberIndex) => {
    const id = `workflow-member:${viewNode.id}:${member.seq}`;
    builder.addNode({ id, ..., metrics: agentMetrics(summaries[member.childId]) });
    builder.addEdge({ from: parentId, to: id, kind: 'workflow', layout: true });
  });
});
```

**关键诚实设计**：

- `phase` 边和 `workflow` 边**都不是脚本依赖**——它们只是展示分组。运行时 `parallel() / pipeline()` 的真实控制流在宿主平台内部，不在这里重建。
- 只有 `phases.length > 1` 或存在非空 `phase` 名时才创建 phase 节点，避免单阶段时多一层无意义的中间节点。

## 7. 步骤 ⑥：Overview 补全（`addGenericSubagents`）

> 位置：`src/graph-model.js#addGenericSubagents`，行 459-486。

```js
const depths = lineageDepths(rootId, summaries);
const descendants = Object.values(summaries)
  .filter(summary => summary.id !== rootId
    && depths.has(summary.id)             // 必须有合法血缘深度
    && !groupedIds.has(summary.id))       // 排除已被 Team/Workflow 占用的 Session
  .sort(...);

for (const summary of descendants) {
  const id = `agent:${summary.id}`;
  builder.addNode({
    id, label, meta: typeLabel(type, t),
    type, status, navigable: builder.ordinary.has(summary.id),
    navigationId: summary.id, order: summary.updatedAt || 0,
    metrics: agentMetrics(summary),
  });
  const parentId = summary.parentId === rootId
    ? rootId
    : groupedSessionNodes.get(summary.parentId) || `agent:${summary.parentId}`;
  builder.addEdge({ from: parentId, to: id, kind: 'delegation', layout: true });
}
```

**核心规则**：

- **已被 Team/Workflow 占用的 Session 不会被重复添加为 `agent:` 节点**——这就是为什么 `Overview` 视图里一个 Session 只会出现一次（`scripts/graph-model.test.mjs` 第 152-168 行验证）。
- **深度通过 `lineageDepths` 算出**——这个函数是处理孤儿/环的关键（见 [05-cycle-fallback.md](05-cycle-fallback.md)）。

## 8. 步骤 ⑦：汇总输出

```js
const parentIds = new Set([rootId]);
for (const summary of Object.values(summaries)) {
  if (summary.id !== rootId && depths.has(summary.id) && summary.parentId !== undefined)
    parentIds.add(summary.parentId);
}

return {
  rootId, mode,
  nodes: [...builder.nodesById.values()],
  edges: [...builder.edgesById.values()],
  parentIds: [...parentIds],
  activeCount: nodes.filter(node => node.id !== rootId && node.status === 'running').length,
  communicationCount: edges.filter(edge => edge.kind === 'communication').length,
  hasTeamData: ...,
  hasWorkflowData: workflowNodes.length > 0,
};
```

| 输出字段 | 用途 |
| --- | --- |
| `nodes` / `edges` | 给 `graphLayout` 和 React 渲染用 |
| `parentIds` | 给 `sessions.setSubagentCatalogOpen(parentIds, true)` 批量打开目录 |
| `activeCount` | 触发按钮的 "live dot" 闪动 |
| `communicationCount` | 控制通信覆盖层切换按钮的可见性 |
| `hasTeamData` / `hasWorkflowData` | 控制 EmptyState |

## 9. 步骤 ⑧：图布局（`graphLayout`）

> 详见 [04-layout-algorithm.md](04-layout-algorithm.md) 与 [05-cycle-fallback.md](05-cycle-fallback.md)。

签名：

```js
graphLayout(graph) → { width, height, positions: Map<id, {x,y}>, signature }
```

`positions` 在画布坐标系里，每个节点的左上角 `(x, y)`。

`signature` 是用于 `useEffect` 监听布局变化的指纹：

```
${mode}|${nodes.map(id).join('|')}|${edges.filter(layout).map(e => `${kind}:${from}>${to}`).join('|')}
```

> 注意 **filter `layout !== false`**——通信边不进签名，否则 toggle 通信开关会触发不必要的状态重置。

## 10. 步骤 ⑨：React 渲染

> 位置：`src/client.js#TaskDagDialog`。

### 9.1 容器 SVG

```jsx
<svg
  className="task-dag-viewer-svg"
  width={fit ? '100%' : layout.width}
  height={fit ? '100%' : layout.height}
  viewBox={`0 0 ${layout.width} ${layout.height}`}
  preserveAspectRatio="xMidYMin meet"
  role="group"
  aria-label={t('graph.aria')}
>
  <defs>
    <marker id="task-dag-viewer-arrow" ...><path d="M0 0 6 3.5 0 7Z" /></marker>
    <marker id="task-dag-viewer-communication-arrow" ...><path d="M0 0 7 4 0 8Z" /></marker>
  </defs>
  {structuralEdges.map(e => <GraphEdge key={e.id} edge={e} positions={positions} />)}
  {communicationEdges.map(e => <GraphEdge key={e.id} edge={e} ... />)}
  {graph.nodes.map(node => <GraphNode key={node.id} node={node} position={positions.get(node.id)} ... />)}
</svg>
```

### 9.2 节点 `<g>` 渲染（`GraphNode`）

```jsx
<g
  className="task-dag-viewer-node"
  transform={`translate(${position.x} ${position.y})`}
  data-node-id={node.id}
  data-type={node.type}
  data-status={node.status}
  data-clickable={actionable ? 'true' : undefined}
  role={actionable ? 'button' : metricsTarget ? 'group' : undefined}
  tabIndex={focusable ? 0 : undefined}
  aria-label={...}
  onClick={activate}
  onFocus={showMetrics}
  onBlur={hideMetrics}
  onPointerDown={...}
  onPointerMove={...}
  onPointerUp={...}
  onPointerCancel={...}
>
  <rect className="task-dag-viewer-node-card" width={NODE_WIDTH} height={NODE_HEIGHT} rx={11} />
  <rect className="task-dag-viewer-node-accent" width={4} height={NODE_HEIGHT-20} x={0} y={10} rx={2} />
  <NodeGlyph type={node.type} x={0} y={0} />
  <text className="task-dag-viewer-node-label" x={56} y={30}>{truncate(node.label, 19)}</text>
  <text className="task-dag-viewer-node-meta"  x={56} y={52}>{truncate(node.meta, 28)}</text>
  <circle className="task-dag-viewer-status-dot" cx={NODE_WIDTH-17} cy={19} r={3.5} />
</g>
```

每个 SVG 元素都带 `data-*` 属性，方便 CSS 状态化（`[data-status="running"] { ... }`）。

### 9.3 边 `<path>` 渲染（`GraphEdge`）

```js
function structuralPath(from, to) {
  // 贝塞尔曲线：从 from 底部 → 向下走 → 拐弯 → 进 to 顶部
  const x1 = from.x + NODE_WIDTH / 2;
  const y1 = from.y + NODE_HEIGHT;
  const x2 = to.x   + NODE_WIDTH / 2;
  const y2 = to.y;
  const middle = (y1 + y2) / 2;
  return `M${x1} ${y1}C${x1} ${middle} ${x2} ${middle} ${x2} ${y2 - 5}`;
}

function communicationGeometry(from, to, curve) {
  // 二次贝塞尔曲线 + 横向偏移，反向成对时 curve 互为相反数
  const offset = curve === 0 ? 34 : 54 * curve;
  ...
}
```

### 9.4 Tooltip（`NodeMetricsTooltip`）

通过 `ReactDOM.createPortal` 把 tooltip 渲染到 `document.body`：

```js
return ReactDOM.createPortal(
  <aside role="tooltip" ...>{...}</aside>,
  document.body
);
```

> 之所以用 portal 是因为 SVG 内部的 `position: absolute` 会受 `overflow: hidden` 影响，无法保证可见。

### 9.5 拖拽与平移

- **节点拖拽**（`beginNodeDrag/moveNodeDrag/endNodeDrag`）：把 pointer 坐标转换到 SVG 坐标系（`graphPoint`），用 `setNodePositions(current => ...)` 增量更新到 React state。
- **画布平移**（`beginCanvasDrag/moveCanvasDrag/endCanvasDrag`）：通过 `viewportRef.scrollLeft/scrollTop` 滚动原始尺寸画布。
- **面板拖拽**（`beginDrag/moveDrag/endDrag`）：通过 `panelRef.style.left/top` 移动整个 dialog。

> 手动布局存放在 `positionsByMode: { overview: {}, team: {}, workflow: {} }`，**每个 mode 独立一份**——切换视图不丢失；切换 Session 时通过 `useEffect([sessionId])` 重置。

## 11. 数据源 → 图数据 → 渲染 全景对照表

| 数据源 | 折叠层 | 节点 ID 前缀 | 边 kind | 布局参与 |
| --- | --- | --- | --- | --- |
| `useSession.running` | `createBuilder` | `rootId` | — | ✓ |
| `summaries.byId` + 血缘 | `addGenericSubagents` | `agent:` | `delegation` | ✓ |
| `catalogs.subagentsByParent` | `catalogIndex` | （只读元数据） | — | — |
| `summaries.byId[id].projectionValues.taskDagAgentMetrics` | `agentMetrics` | （节点 metrics 字段） | — | — |
| `summaries.byId[id].projectionValues.tokenUsage` | `agentMetrics` | （节点 metrics 字段） | — | — |
| Team snapshot `member` | `addTeamGraph` | `agent:` | `team` | ✓ |
| Team snapshot `task` | `addTeamGraph` | `team-task:` | `assignment` / `dependency` | ✓ |
| Team snapshot `message` | `addTeamGraph` | （两端 ensureAgent） | `communication` | ✗ |
| Team snapshot `delivery` | `addTeamGraph` | — | — | — |
| `workflow-run` node | `addWorkflowGraph` | `workflow:` / `workflow-phase:` / `workflow-member:` | `workflow` / `phase` | ✓ |
| `tool-call` node `argsRaw` | `attachWorkflowDefinitions` | （注入到 run 节点的 `definition`） | — | — |

## 12. 处理管线的小结

> **整个数据处理管线是单向无副作用的**：
>
> `原始数据源 → 折叠为 snapshot → 索引化 → 创建 builder → 三种 add*Graph 函数填充节点/边 → 输出统一 graph → graphLayout 算坐标 → React 渲染`。
>
> 中间没有 mutation，没有异步 IO，没有副作用。任何一个步骤都可以独立单测。

下一步：[04-layout-algorithm.md](04-layout-algorithm.md) 详细拆解 `graphLayout` 的确定性算法。
