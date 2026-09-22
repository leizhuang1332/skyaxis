# 05 异常环 fallback：让任何有向图都能被画出来

> 本文档详细拆解当输入图存在环时，`graphDepths` 如何降级到"残量分量"策略，保证渲染不中断、视觉不漂移。

## 1. 为什么会"有环"？

`task-dag-viewer` 消费的边来自四个来源，但只有一种**理论上**可能成环：

| 边 kind | 来源 | 可能成环？ |
| --- | --- | --- |
| `dependency` | Team task `blockedBy` | 否——Task 的 `blockedBy` 由上游协议保证无环 |
| `team` | Team 成员挂在根上 | 否——所有 `team` 边都从 `rootId` 出发 |
| `assignment` | 任务分配 owner | 否——owner 是人，不是任务 |
| `delegation` | 子代理挂在父上 | **可能**——上游如果允许 lineage 形成环会触发 |
| `workflow` / `phase` | Workflow run 阶段 | 否——同一 run 内阶段序数固定 |
| `communication` | 通信边 | **会**——但全部 `layout: false`，不参与 |

但插件仍然要兜底，因为：

1. **宿主平台数据源的契约可能在未来版本里变化**。
2. **用户上传的 Chat 节点可能含脏数据**。
3. **`addEdge` 的悬空过滤 + `lineageDepths` 的孤儿/环检测已经处理了大部分**，但还有"残量分量"这种特殊情形。

> 单元测试 `graphLayout is deterministic for deep lineages and cyclic dependency input` 显式构造了一个 a↔b 双向环，验证 fallback 能正常工作。

## 2. Fallback 策略：四道防线

```
┌────────────────────────────────────────────────────────────────┐
│  防线 1：addEdge 悬空过滤                                       │
│    边指向不存在的节点 → 丢弃                                      │
│ 防线 2：lineageDepths 血缘过滤                                    │
│    孤儿 / 环 → 不进入 depths（被排除出 Overview 的子代理）          │
│ 防线 3：通信边 layout:false                                       │
│    通信永远不进拓扑排序                                            │
│ 防线 4：residualComponents 分量 fallback                          │
│    主循环跑完后仍未分配的节点 → 按强连通分量压平                    │
└────────────────────────────────────────────────────────────────┘
```

下文按防线编号逐一拆解。

## 3. 防线 1：`addEdge` 悬空过滤

> 位置：`src/graph-model.js#createBuilder.addEdge`，行 222-226。

```js
const addEdge = (edge) => {
  if (!nodesById.has(edge.from) || !nodesById.has(edge.to)) return;
  const id = edge.id || `${edge.kind}:${edge.from}>${edge.to}`;
  edgesById.set(id, { ...edge, id });
};
```

**任何一端不存在的边都会被静默丢弃**。这是最简单、最便宜的兜底——脏数据根本进不了图结构。

> 注意这里的"静默"是有意的：单元测试 `scripts/team-projection.test.mjs` 验证缺失的 owner 节点会被自动 `ensureAgent` 兜底创建，所以**正常业务流程下不会触发悬空过滤**。只有在数据真的损坏时才走这条路。

## 4. 防线 2：`lineageDepths` 血缘过滤

> 位置：`src/graph-model.js#lineageDepths`，行 113-155。

```js
export function lineageDepths(rootId, summaries) {
  const depths = new Map([[rootId, 0]]);
  const invalid = new Set();
  for (const start of Object.values(summaries)) {
    if (start.id === rootId || depths.has(start.id) || invalid.has(start.id)) continue;
    const trail = [];
    const seen = new Set();
    let current = start;
    let baseDepth;
    while (true) {
      if (depths.has(current.id)) {
        baseDepth = depths.get(current.id);
        break;
      }
      if (invalid.has(current.id) || seen.has(current.id)
        || current.origin !== 'subagent' || current.parentId === undefined) {
        baseDepth = undefined;
        break;
      }
      seen.add(current.id);
      trail.push(current);
      if (current.parentId === rootId) {
        baseDepth = 0;
        break;
      }
      current = summaries[current.parentId];
      if (current === undefined) {
        baseDepth = undefined;
        break;
      }
    }
    if (baseDepth === undefined) {
      for (const node of trail) invalid.add(node.id);
      continue;
    }
    let depth = baseDepth;
    for (let index = trail.length - 1; index >= 0; index -= 1) {
      depth += 1;
      depths.set(trail[index].id, depth);
    }
  }
  return depths;
}
```

### 工作流

1. **初始化** `depths = { rootId: 0 }`。
2. **遍历每个 Session**，尝试向上爬到 `rootId`：
   - **途中遇到已在 `depths` 的祖先** → 用那个祖先的深度作为基准，把当前链路上的每个节点设为基准+1、+2、...
   - **遇到 `origin !== 'subagent'`**（非子代理血缘） → 标记为 `invalid`。
   - **遇到 `parentId === undefined`**（孤儿） → 标记为 `invalid`。
   - **遇到已访问的节点**（环） → 标记为 `invalid`。
   - **遇到 `summaries[parentId] === undefined`**（父 ID 找不到） → 标记为 `invalid`。
3. **`invalid` 集合的元素不会出现在 `depths`**——它们被排除出 Overview 的子代理图。

### 单测验证

```js
test('lineage resolution accepts descendants and rejects cycles and orphans', () => {
  const summaries = {
    root, direct: { id: 'direct', origin: 'subagent', parentId: 'root' },
    nested: { id: 'nested', origin: 'subagent', parentId: 'direct' },
    orphan: { id: 'orphan', origin: 'subagent', parentId: 'missing' },
    cycleA: { id: 'cycleA', origin: 'subagent', parentId: 'cycleB' },
    cycleB: { id: 'cycleB', origin: 'subagent', parentId: 'cycleA' },
  }
  const depths = lineageDepths('root', summaries)
  assert.equal(depths.get('direct'), 1)
  assert.equal(depths.get('nested'), 2)
  assert.equal(depths.has('orphan'), false)
  assert.equal(depths.has('cycleA'), false)
  assert.equal(depths.has('cycleB'), false)
})
```

### 设计取舍

- **保留 `trail` 中所有节点都被标记为 invalid**——而不是只标记第一个触发 break 的节点。这样**整圈环都被排除**，避免"半环进图"。
- **`invalid` 集合累计已知的"坏"节点**——后续遍历遇到它们直接跳过。
- **`seen` 集合是单次 walk 内的环检测器**——避免在同一轮 walk 中重复访问。

## 5. 防线 3：通信边 `layout: false`

> 位置：`src/graph-model.js#addTeamGraph`，行 364-382。

```js
builder.addEdge({
  id: `communication:${channel.senderId}>${channel.targetId}`,
  from: channel.from, to: channel.to,
  kind: 'communication',
  layout: false,                    // ← 关键
  count: channel.messages.length,
  pending, reverse, curve: ...,
  ...
});
```

**通信永远是覆盖层，不参与拓扑排序**。这是文档里反复强调的诚实原则：

> "Communication may be bidirectional and therefore cyclic; it must never participate in DAG layering."

`graphDepths` 里的过滤：

```js
if (edge.layout === false || ...) continue;
```

确保通信边在主循环里被跳过。

## 6. 防线 4：`residualComponents` 分量 fallback

> 位置：`src/graph-model.js#residualComponents`，行 553-611。

这是兜底的兜底：即使前面三道防线都漏掉了，**也保证图能画出来**。

### 6.1 触发条件

主循环跑完后：

```js
const residualIds = graph.nodes.filter(node => !processed.has(node.id)).map(node => node.id);
if (residualIds.length > 0) {
  // 进入 fallback
}
```

`processed` 是主循环里入过队的节点 ID 集合——**没进过队说明入度永远不为 0，必然成环**。

### 6.2 强连通分量提取

```js
function residualComponents(residualIds, outgoing, compareIds) {
  const residual = new Set(residualIds);
  const adjacent = new Map(residualIds.map(id => [id, []]));
  const reverse = new Map(residualIds.map(id => [id, []]));
  // 构建子图（只在 residual 内连边）
  for (const id of residualIds) {
    for (const target of outgoing.get(id)) {
      if (!residual.has(target)) continue;
      adjacent.get(id).push(target);
      reverse.get(target).push(id);
    }
  }
  // 排序 → 保证确定性
  for (const targets of adjacent.values()) targets.sort(compareIds);
  for (const targets of reverse.values()) targets.sort(compareIds);

  // 第一次 DFS：求完成顺序
  const visited = new Set();
  const finished = [];
  for (const start of [...residualIds].sort(compareIds)) {
    if (visited.has(start)) continue;
    visited.add(start);
    const stack = [{ id: start, index: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      const targets = adjacent.get(frame.id);
      if (frame.index < targets.length) {
        const target = targets[frame.index];
        frame.index += 1;
        if (!visited.has(target)) {
          visited.add(target);
          stack.push({ id: target, index: 0 });
        }
      } else {
        finished.push(frame.id);
        stack.pop();
      }
    }
  }

  // 第二次反向 DFS：按完成顺序倒序展开分量
  const components = [];
  const componentById = new Map();
  for (let index = finished.length - 1; index >= 0; index -= 1) {
    const start = finished[index];
    if (componentById.has(start)) continue;
    const component = [];
    const stack = [start];
    componentById.set(start, components.length);
    while (stack.length > 0) {
      const id = stack.pop();
      component.push(id);
      for (const target of reverse.get(id)) {
        if (componentById.has(target)) continue;
        componentById.set(target, components.length);
        stack.push(target);
      }
    }
    component.sort(compareIds);
    components.push(component);
  }
  return { components, componentById };
}
```

### 算法本质

**Tarjan-style Kosaraju 算法的迭代版本**：

1. **正向 DFS**：迭代版（用栈模拟递归）记录完成顺序。
2. **反向 DFS**：按完成顺序倒序遍历，每个起点对应一个强连通分量。
3. **节点排序**：`component.sort(compareIds)` 保证分量内节点的展示顺序确定。

> **为什么用迭代而不是递归？**——3000 节点链 + 嵌套环时递归版本可能爆栈。迭代版是常数空间（除了栈本身）。

### 6.3 分量拓扑排序

```js
const componentOutgoing = components.map(() => new Set());
const componentIndegree = components.map(() => 0);
const componentDepth = new Map();
for (let index = 0; index < components.length; index += 1) {
  for (const id of components[index]) {
    if (depths.has(id)) componentDepth.set(index, Math.max(componentDepth.get(index) || 0, depths.get(id)));
    for (const target of outgoing.get(id)) {
      const targetIndex = componentById.get(target);
      if (targetIndex === undefined || targetIndex === index || componentOutgoing[index].has(targetIndex)) continue;
      componentOutgoing[index].add(targetIndex);
      componentIndegree[targetIndex] += 1;
    }
  }
}
const fallbackDepth = Math.max(0, ...[...processed].map(id => depths.get(id) || 0)) + 1;
const compareComponents = (left, right) => compareIds(components[left][0], components[right][0]);
const componentQueue = [];
for (let index = 0; index < components.length; index += 1) {
  if (componentIndegree[index] === 0) insertSorted(componentQueue, index, compareComponents);
}
while (componentQueue.length > 0) {
  const index = componentQueue.shift();
  const depth = componentDepth.get(index) ?? fallbackDepth;
  componentDepth.set(index, depth);
  const targets = [...componentOutgoing[index]].sort(compareComponents);
  for (const target of targets) {
    componentDepth.set(target, Math.max(componentDepth.get(target) || 0, depth + 1));
    componentIndegree[target] -= 1;
    if (componentIndegree[target] === 0) insertSorted(componentQueue, target, compareComponents);
  }
}
```

### 三件事

1. **构建分量级别 DAG**：把每个分量当作一个超级节点，分量之间的边构成一个新 DAG。
2. **初始化 `componentDepth`**：如果分量内有节点已知深度（来自主循环的越界贡献），使用其最大值；否则用 `fallbackDepth = max(processed depth) + 1`。
3. **Kahn 算法再分一层**：对分量级别 DAG 做一次拓扑排序，得到每个分量的展示深度。

> **关键设计**：分量的 fallback 深度是 `max(processed depth) + 1`——确保环上的节点**始终在合法节点的下方**，避免环节点"飘到顶部"产生视觉混乱。

### 6.4 分量内压平

```js
for (let index = 0; index < components.length; index += 1) {
  const depth = componentDepth.get(index) ?? fallbackDepth;
  for (const id of components[index]) depths.set(id, depth);
}
```

分量内的所有节点被压到**同一个 depth**——这就是"环被压平"的视觉效果。

### 6.5 单测验证

```js
const cyclic = {
  rootId: 'root', mode: 'team',
  nodes: [
    { id: 'root', label: 'Root', order: 0 },
    { id: 'a',    label: 'A',    order: 1 },
    { id: 'b',    label: 'B',    order: 2 },
    { id: 'c',    label: 'C',    order: 3 },
  ],
  edges: [
    { from: 'root', to: 'a', kind: 'assignment', layout: true },
    { from: 'a',    to: 'b', kind: 'dependency', layout: true },
    { from: 'b',    to: 'a', kind: 'dependency', layout: true },  // 环
    { from: 'b',    to: 'c', kind: 'dependency', layout: true },
  ],
};
const cyclicLayout = graphLayout(cyclic);
assert.equal(cyclicLayout.positions.size, 4);
assert.equal(cyclicLayout.positions.get('a').y, cyclicLayout.positions.get('b').y);     // a 和 b 同层
assert.equal(cyclicLayout.positions.get('c').y > cyclicLayout.positions.get('b').y);    // c 在更深层
```

### 期望渲染

```
Layer 1                Layer 2                Layer 3
┌──────┐  assignment   ┌───┐ ← dep    ┌───┐
│ Root │ ────────────► │ A │           │ C │
└──────┘               │   │ ─────────►└───┘
                       │   │   dep
                       │   │ ◄─────────┐
                       └───┘           │
                        ↑              │
                        └──── dep ─────┘
```

`a` 和 `b` 在同一层（被压平），`c` 在下一层。

## 7. 兜底兜底：全空深度

```js
for (const node of graph.nodes)
  if (!depths.has(node.id))
    depths.set(node.id, node.id === graph.rootId ? 0 : 1);
```

理论上不会触发（`residualComponents` 已经给每个 residual 节点赋深度），但作为最后保险：

- 根节点 = 0
- 其它节点 = 1

## 8. 为什么 fallback 是确定性的？

| 步骤 | 确定性来源 |
| --- | --- |
| 起点遍历顺序 | `[...residualIds].sort(compareIds)` |
| DFS 出栈顺序 | `targets.sort(compareIds)` 后入栈 |
| 完成顺序 | 完全由 DFS 遍历顺序决定 |
| 反向 DFS 展开顺序 | `finished` 倒序 |
| 分量内排序 | `component.sort(compareIds)` |
| 分量级 Kahn 队列 | `compareComponents = (l, r) => compareIds(components[l][0], components[r][0])` |

**任何相同输入下两次 `residualComponents` 调用都返回完全相同的 `components` 数组**。

## 9. 视觉影响评估

### 视觉感受

- **环节点被压到同一层**——SVG 边会形成可视的环，但所有节点对齐在同一 baseline。
- **边还是会被画出来**——`edgesById` 仍然保留环上的边，用户能看到 `a → b → a` 的有向关系。
- **不会触发循环渲染**——React 不会因为 `depths` 是 1 而减少边数。

### 用户行为预期

- 普通用户**几乎看不到环**——因为宿主平台上游协议保证 `dependency / team / assignment / workflow / phase` 不成环。
- 环**只在脏数据场景**出现：例如 Session 列表同步过程中的瞬态、Chat 节点裁剪的瞬态。
- Fallback 后页面仍然可用，可以拖动节点、点击查看详情、刷新数据。

## 10. 通信成对的反向曲线

虽然通信不参与布局，但**通信成对时**会通过 `curve` 偏移防止 SVG 路径重叠：

```js
// src/graph-model.js#addTeamGraph
const reverse = channels.has(`${channel.targetId}>${channel.senderId}`);
builder.addEdge({
  ...
  reverse,
  curve: reverse ? (channel.senderId.localeCompare(channel.targetId) < 0 ? -1 : 1) : 0,
});

// src/client.js#communicationGeometry
function communicationGeometry(from, to, curve) {
  ...
  const offset = curve === 0 ? 34 : 54 * curve;
  ...
}
```

- 单向通信：横向偏移 34。
- 双向通信：左侧通道偏移 -54，右侧偏移 +54。

这样 SVG `<path d="M ... Q ...">` 不会重叠。

## 11. 小结：fallback 的核心契约

| 契约 | 实现 |
| --- | --- |
| 不抛错 | `graphDepths` 任何分支都不抛异常 |
| 不阻塞渲染 | 所有节点都有 depth，所有边都有 positions |
| 视觉一致 | 环节点对齐在 fallback 深度，不会"飘" |
| 完全确定性 | `residualComponents` 输出可重现 |
| 不污染主循环 | fallback 是独立分支，不影响主流程 |

> **环 fallback 不是 bug 修复，是契约的一部分**——上游协议保证主流程无环，fallback 保证脏数据下仍可用。

下一步：[06-metrics-honesty.md](06-metrics-honesty.md) 讲累计指标 vs 当次请求的诚实表达。
