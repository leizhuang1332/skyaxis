# 04 确定性布局算法：从节点列表到画布坐标

> 本文档详细拆解 `src/graph-model.js#graphLayout` 的工作原理。这是整个可视化插件的"几何引擎"。

## 1. 算法的目标与不变量

### 目标

给定一份 `{ nodes, edges }`（已折叠好的图），返回每个节点的画布左上角坐标 `(x, y)`。

### 必须满足的不变量

1. **确定性**：同一份输入 → 完全相同的坐标序列（用于单测和 UI 状态对齐）。
2. **层次感**：每个节点被分配一个整数 depth（层），从根往下单调不递减。
3. **同层有序**：每一层节点从左到右排序稳定（同 `order` 时按 `label` 字典序，按 `id`）。
4. **画布居中**：每层节点在画布内水平居中。
5. **无副作用**：纯函数式，可多次调用而不修改外部状态。
6. **可处理 3000 节点线性链**：不递归、不爆栈（`scripts/graph-model.test.mjs` 第 247 行验证）。
7. **可处理依赖环**：进入 fallback 分层（见 [05-cycle-fallback.md](05-cycle-fallback.md)），不抛错。

## 2. 算法全景

```
graphLayout(graph)
  ├── nodesById    = Map<id, node>
  ├── depths       = graphDepths(graph, nodesById)        ← 关键：分层
  │     ├── 主循环：BFS 拓扑排序（Kahn 算法变种）
  │     ├── 异常处理：residualComponents() + componentDepth
  │     └── 兜底：rootId=0, 其它=1
  ├── layers       = 按 depth 分桶
  │     └── 每桶内 nodeComparator 排序
  ├── width/height = 根据最宽层和总层数算画布大小
  └── positions    = 按层居中算 (x, y)
```

## 3. 比较器：`nodeComparator`

> 位置：`src/graph-model.js#nodeComparator`，行 195-200。

```js
function nodeComparator(left, right) {
  const orderDelta = (left.order || 0) - (right.order || 0);
  if (orderDelta !== 0) return orderDelta;
  const labelDelta = String(left.label).localeCompare(String(right.label));
  return labelDelta !== 0 ? labelDelta : left.id.localeCompare(right.id);
}
```

### 三级比较

| 优先级 | 字段 | 含义 |
| --- | --- | --- |
| 1 | `order` | 节点被分配的"出场顺序"（root=-1, member=seq, task=taskOrder, workflow-member=seq, agent=updatedAt...） |
| 2 | `label` | 标签字典序 |
| 3 | `id` | 最终兜底，确保完全确定性 |

### 用途

- **BFS 队列**中：保证同 indegree 的多个节点按确定顺序出队。
- **同层排序**：保证 `layers[depth]` 内部节点排序可重现。
- **`residualComponents` 中**：保证分量 / 分量内节点的排序可重现。

## 4. 二分插入：`insertSorted`

> 位置：`src/graph-model.js#insertSorted`，行 542-551。

```js
function insertSorted(queue, node, compare) {
  let low = 0;
  let high = queue.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (compare(queue[middle], node) <= 0) low = middle + 1;
    else high = middle;
  }
  queue.splice(low, 0, node);
}
```

把 `O(n)` 的 `array.sort()` 替换成二分插入：

- 每次入队 `O(log n)`
- 用于 3000 节点线性链时，`n * log n ≈ 30000` 次比较 → 远快于 `array.sort` 的 `O(n²)`。
- 同时**保持稳定排序语义**：同 `compare` 结果的元素按插入顺序排。

## 5. 核心：`graphDepths`

> 位置：`src/graph-model.js#graphDepths`，行 613-681。

### 5.1 入度表构建

```js
const indegree = new Map(graph.nodes.map(node => [node.id, 0]));
const outgoing = new Map(graph.nodes.map(node => [node.id, []]));
for (const edge of graph.edges) {
  if (edge.layout === false || edge.from === edge.to
    || !nodesById.has(edge.from) || !nodesById.has(edge.to)) continue;
  outgoing.get(edge.from).push(edge.to);
  indegree.set(edge.to, indegree.get(edge.to) + 1);
}
```

**四道过滤**：

| 过滤条件 | 原因 |
| --- | --- |
| `edge.layout === false` | 通信边永远是 `layout: false`，不参与分层 |
| `edge.from === edge.to` | 自环不进入拓扑排序 |
| `!nodesById.has(from/to)` | 悬空边（前文 `addEdge` 已过滤，这里再保险） |

### 5.2 主循环：BFS 拓扑排序

```js
const queue = [];
for (const node of graph.nodes) {
  if (indegree.get(node.id) === 0) insertSorted(queue, node.id, compareIds);
}
const depths = new Map([[graph.rootId, 0]]);
const processed = new Set();
while (queue.length > 0) {
  const id = queue.shift();
  processed.add(id);
  const baseDepth = depths.get(id) || 0;
  for (const target of outgoing.get(id)) {
    depths.set(target, Math.max(depths.get(target) || 0, baseDepth + 1));
    indegree.set(target, indegree.get(target) - 1);
    if (indegree.get(target) === 0) insertSorted(queue, target, compareIds);
  }
}
```

**关键点**：

1. **初始入度为 0 的节点优先进入队列**——根节点因为 `navigable:false, order:-1` 会最先入队。
2. **`Math.max(depths.get(target) || 0, baseDepth + 1)`**：**允许多入边**——同一个节点可能从多个上游到达，取最深的层。这正是 设计文档中提到的"显式多入边"。
3. **`processed` 集合**：用于环检测——主循环结束后没进 `processed` 的就是环上的节点。

### 5.3 异常环处理：`residualComponents`

详见 [05-cycle-fallback.md](05-cycle-fallback.md)。这里只说关键点：

```js
const residualIds = graph.nodes.filter(node => !processed.has(node.id)).map(node => node.id);
if (residualIds.length > 0) {
  const { components, componentById } = residualComponents(residualIds, outgoing, compareIds);
  // 对每个分量赋 fallback 深度：
  // 1. 如果该分量有任意节点已知深度，使用其最大值；
  // 2. 否则使用 fallbackDepth = max(processed depth) + 1；
  // 3. 分量之间也建边图，按 Kahn 算法再分一层。
  ...
}
for (const node of graph.nodes) if (!depths.has(node.id))
  depths.set(node.id, node.id === graph.rootId ? 0 : 1);
```

### 5.4 全兜底

```js
for (const node of graph.nodes)
  if (!depths.has(node.id))
    depths.set(node.id, node.id === graph.rootId ? 0 : 1);
```

极端情况下（根节点不在节点列表里、等等），强制给每个节点一个深度——根=0，其它=1。

## 6. 分桶与排序：`layers`

```js
const maxDepth = Math.max(0, ...depths.values());
const layers = Array.from({ length: maxDepth + 1 }, () => []);
for (const node of graph.nodes) layers[depths.get(node.id) || 0].push(node);
for (const layer of layers) layer.sort(nodeComparator);
```

- 数组下标即 depth。
- 每桶内 `nodeComparator` 排序 → 稳定可重现。
- `maxDepth = 0` 时只有一个空数组（除根外）——保证后续 `width/height` 计算不报 NaN。

## 7. 画布尺寸与坐标

```js
export const NODE_WIDTH  = 224;
export const NODE_HEIGHT = 76;
const X_GAP = 30;
const Y_GAP = 70;
const CANVAS_PAD = 38;
const MIN_CANVAS_WIDTH = 760;

const widest = Math.max(1, ...layers.map(layer => layer.length));
const width  = Math.max(MIN_CANVAS_WIDTH,
  CANVAS_PAD * 2 + widest * NODE_WIDTH + Math.max(0, widest - 1) * X_GAP);
const height = CANVAS_PAD * 2 + layers.length * NODE_HEIGHT
             + Math.max(0, layers.length - 1) * Y_GAP;

const positions = new Map();
for (let depth = 0; depth < layers.length; depth += 1) {
  const layer = layers[depth];
  const layerWidth = layer.length * NODE_WIDTH + Math.max(0, layer.length - 1) * X_GAP;
  const startX = (width - layerWidth) / 2;             // 水平居中
  for (let index = 0; index < layer.length; index += 1) {
    positions.set(layer[index].id, {
      x: startX + index * (NODE_WIDTH + X_GAP),
      y: CANVAS_PAD + depth * (NODE_HEIGHT + Y_GAP),
    });
  }
}
```

### 几何公式

```
x(i) = (canvas_width - layer_width) / 2 + i * (NODE_WIDTH + X_GAP)
y(d) = CANVAS_PAD + d * (NODE_HEIGHT + Y_GAP)
```

其中：

- `layer_width = n * NODE_WIDTH + (n-1) * X_GAP`（n=1 时 X_GAP 不算）。
- `canvas_width = max(MIN_CANVAS_WIDTH, PAD*2 + widest * NODE_WIDTH + (widest-1) * X_GAP)`。
- `canvas_height = PAD*2 + depth_count * NODE_HEIGHT + (depth_count-1) * Y_GAP`。

### 关键约束

- `widest` 用 `Math.max(1, ...)` 兜底，避免 0 节点时 width=0。
- `MIN_CANVAS_WIDTH = 760` 保证小图（如单节点）画布不至于太窄导致面板异常。
- `Math.max(0, n - 1) * GAP` 公式避免 n=1 时多算一个 gap。

## 8. 布局签名：`signature`

```js
return {
  width, height, positions,
  signature: `${graph.mode}|${graph.nodes.map(node => node.id).join('|')}|${graph.edges
    .filter(edge => edge.layout !== false).map(edge => `${edge.kind}:${edge.from}>${edge.to}`).join('|')}`,
};
```

### 用途

`signature` 是布局的"指纹"。当以下任一项变化时，`useMemo` / `useEffect` 会感知到布局变化：

- 视图 mode（overview / team / workflow）。
- 节点 ID 集合。
- 任何 `layout !== false` 的边集合。

### 不包含的内容

- **节点 status / label**：节点内容变了，positions 不变（因为 label 长度变化只影响 `truncate`，不改变 `NODE_WIDTH`）。
- **`layout === false` 的边**（即通信边）—— toggle 通信开关不会触发重布局。
- **手工布局**——用户拖动节点后通过 `nodePositions` 覆盖 `positions`，不影响 `signature`。

## 9. 完整示例：3000 节点线性链

```js
const summaries = { root };
let parentId = 'root';
for (let index = 0; index < 3000; index += 1) {
  const id = `node-${index}`;
  summaries[id] = { id, displayTitle: id, origin: 'subagent', parentId, updatedAt: index };
  parentId = id;
}
const graph = buildGraph({ ... });
const layout = graphLayout(graph);

// 单测断言
assert.equal(layout.positions.get('agent:node-2999').y > layout.positions.get('agent:node-0').y, true);
assert.deepEqual([...layout1.positions.entries()], [...layout2.positions.entries()]);
```

### 期望结果

| 节点 | depth | y 坐标 |
| --- | --- | --- |
| `agent:node-0` | 1 | `38 + 1 * 146 = 184` |
| `agent:node-1` | 2 | `38 + 2 * 146 = 330` |
| `agent:node-2` | 3 | `38 + 3 * 146 = 476` |
| ... | ... | ... |
| `agent:node-2999` | 3000 | `38 + 3000 * 146 = 438038` |

> 画布高度：`38*2 + 3001 * 76 + 3000 * 70 = 438078`——超过 4000 像素。这正是为什么 SVG 用 `viewBox` + `preserveAspectRatio="xMidYMin meet"`，外层 div 用 `overflow: auto` 实现可滚动画布。

## 10. 完整示例：双向环

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
    { from: 'root', to: 'a', kind: 'assignment',  layout: true },
    { from: 'a',    to: 'b', kind: 'dependency',  layout: true },
    { from: 'b',    to: 'a', kind: 'dependency',  layout: true },   // ← 形成环 a→b→a
    { from: 'b',    to: 'c', kind: 'dependency',  layout: true },
  ],
};
```

### 期望结果（来自单测）

- `a.y === b.y`（同一个 fallback 分量）
- `c.y > b.y`（`c` 是分量的下游）

```
   root
   assignment
     ↓
   ┌─ a ──→ b ──→ c
   └────────┘
       ↑
     dependency（环）
```

`a` 和 `b` 被压平到同一层；`c` 在更深的层。详见 [05-cycle-fallback.md](05-cycle-fallback.md)。

## 11. 算法的复杂度

| 阶段 | 复杂度 | 说明 |
| --- | --- | --- |
| 入度表构建 | `O(V + E)` | 单次遍历节点和边 |
| 拓扑排序主循环 | `O((V + E) log V)` | 二分插入 `O(log V)` × V 次 |
| 异常分量检测 | `O(V + E)` | DFS + 反向 DFS |
| 分桶 | `O(V)` | 单次遍历 |
| 坐标计算 | `O(V)` | 双重循环 |
| **总计** | `O((V + E) log V)` | 节点数 100 以内实际为常数级 |

## 12. 单测覆盖的边界

`scripts/graph-model.test.mjs` 验证的边界：

| 测试 | 验证点 |
| --- | --- |
| `lineage resolution accepts descendants and rejects cycles and orphans` | 血缘处理：合法深度、孤儿、环 |
| `graphLayout is deterministic for deep lineages and cyclic dependency input` | 3000 节点链 + 双向环的确定性 |
| `Agent Teams graph folds current tasks, owners, dependencies, and bidirectional communication` | 团队图的多入边 + 通信 reverse 标记 |

## 13. 小结：算法为什么这样设计

| 决策 | 理由 |
| --- | --- |
| **手写而不是用 dagre/elk** | 依赖体积大、递归布局对深度链不友好 |
| **Kahn + 入度表，而不是 DFS** | 拓扑排序稳定，结果可重现 |
| **`Math.max` 处理多入边** | 显式支持多入边，不简化成 DAG |
| **二分插入代替 `Array.sort`** | `O(n log n)` 优于 `O(n²)`，3000 节点也能秒级出图 |
| **同层排序用 `nodeComparator` 三级比较** | 完全确定性，单测断言 `deepEqual` 通过 |
| **`signature` 排除 `layout:false` 边** | toggle 通信不影响布局状态 |
| **每桶居中而不是从左到右堆** | 视觉重心稳定，多分支时左右对称 |

下一步：[05-cycle-fallback.md](05-cycle-fallback.md) 讲异常环 fallback 的完整细节。
