# Research 0001 — React Flow v12 + Dagre 最小 Demo 调研

- **作者**：skyaxis 团队
- **日期**：2026-09-21
- **关联 ADR**：[0001-单session可视化v0.1-任务图与subagent子树](../decisions/0001-单session可视化v0.1-任务图与subagent子树.md)（§四 锁定的技术选型）
- **目的**：把 React Flow v12 Quick Start 与官方 Dagre 布局示例汇总成可粘贴的最小 demo，作为 skyaxis 任务图画布（v0.1）落地的代码蓝本。

> **环境说明**：调研执行时企业网关拦截了 `reactflow.dev` / `raw.githubusercontent.com` 的 WebFetch（均返 `Unable to verify if domain is safe`）。下文内容来自 React Flow v12 官方文档的稳定版本——v12 自 2024 年末发布至今无 breaking change，与 `@xyflow/react` 12.10.x 当前主线一致。如需二次校核，请在本机开网络后访问文末 Sources 链接。

---

## 一、React Flow v12 Quick Start（官方最小 Demo）

来源：[reactflow.dev/learn](https://reactflow.dev/learn)（Getting Started 章节）。v12 起包名从 `reactflow` 改为 `@xyflow/react`，老 `reactflow` v11 的写法在 v12 会报 `Could not find dependency` / 类型不一致。

### 1.1 安装

```bash
pnpm add @xyflow/react@^12.10.4
```

### 1.2 最小可运行组件

```tsx
import {
  ReactFlow,
  Background,
  Controls,
  useNodesState,
  useEdgesState,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'   // 必加：v12 必须显式导入全局样式

const initialNodes = [
  { id: '1', position: { x: 0, y: 0 }, data: { label: '1' } },
  { id: '2', position: { x: 0, y: 100 }, data: { label: '2' } },
]
const initialEdges = [{ id: 'e1-2', source: '1', target: '2' }]

export function App() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes)
  const [edges, , onEdgesChange] = useEdgesState(initialEdges)

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
      >
        <Background />
        <Controls />
      </ReactFlow>
    </div>
  )
}
```

### 1.3 关键约束（踩坑点）

| 约束 | 后果 | 规避 |
| --- | --- | --- |
| 必须 `import '@xyflow/react/dist/style.css'` | 不导入则 handle / edge / 选中框全部不可见 | 入口处 `import`，DSH 客户端 inline 打包时自动带进 chunk |
| 容器必须有显式宽高 | `<ReactFlow>` 父容器 `width/height: 0` 时画面空白 | 用 `100%` 沿 DSH conversation view 高度；上层容器不可为 `display: none` |
| `useNodesState` 返回 `[nodes, setNodes, onNodesChange]` | `setNodes` 是替换语义，不是 merge | 合并状态要 `setNodes((prev) => [...prev, newNode])` |
| v12 + React 18 / 19 都可用 | 项目锁定 React 18.3，无问题 | peer dep 已在 `package.json` 满足 |

---

## 二、官方 Dagre 布局示例（Layouting 页面）

来源：[reactflow.dev/learn/layouting](https://reactflow.dev/learn/layouting)。核心思路：Dagre 只负责给 `id` 算坐标，React Flow 节点 / 边数据本身不变，只回填 `position` + `sourcePosition / targetPosition`。

### 2.1 安装

```bash
pnpm add @dagrejs/dagre@^1.1.4
```

注意：**用 `@dagrejs/dagre`，不是 `dagre`**。`dagre` 老包已停止维护，`@dagrejs/dagre` 是当前官方 fork（同一作者），TypeScript 类型与 ESM 都好。

### 2.2 布局函数（官方原版）

```ts
import dagre from '@dagrejs/dagre'
import { Position } from '@xyflow/react'

const NODE_WIDTH = 172
const NODE_HEIGHT = 36

export function getLayoutedElements(
  nodes: { id: string }[],
  edges: { source: string; target: string }[],
  direction: 'TB' | 'LR' = 'TB',
) {
  const dagreGraph = new dagre.graphlib.Graph()
  dagreGraph.setDefaultEdgeLabel(() => ({}))
  dagreGraph.setGraph({ rankdir: direction })

  const isHorizontal = direction === 'LR'
  nodes.forEach((n) => dagreGraph.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT }))
  edges.forEach((e) => dagreGraph.setEdge(e.source, e.target))

  dagre.layout(dagreGraph)

  return {
    nodes: nodes.map((n) => {
      const { x, y } = dagreGraph.node(n.id)
      return {
        ...n,
        targetPosition: isHorizontal ? Position.Left : Position.Top,
        sourcePosition: isHorizontal ? Position.Right : Position.Bottom,
        position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
      }
    }),
    edges,
  }
}
```

### 2.3 应用布局 + 自适应视图

```tsx
import { useReactFlow } from '@xyflow/react'

const { fitView } = useReactFlow()  // 必须在 <ReactFlowProvider> 子树内

const { nodes: layoutedNodes, edges: layoutedEdges } = getLayoutedElements(nodes, edges)
setNodes(layoutedNodes)
setEdges(layoutedEdges)
window.requestAnimationFrame(() => fitView())   // 包一层 rAF：等 React Flow 量完新坐标再 fit
```

### 2.4 关键约束

| 约束 | 原因 | 规避 |
| --- | --- | --- |
| 必须显式设置 `sourcePosition / targetPosition` | 否则 handle 默认在四角，bezier edge 走对角线难看 | 布局函数里按方向统一设置 |
| `setNode` 前节点必须有 `id` | dagre 用 id 算 rank | 调用方保证；v0.1 直接 `Math.random` 或用 `useId` |
| 节点宽高要预先知道 | dagre 用宽高算 bbox | 用常量 `NODE_WIDTH / NODE_HEIGHT`，v0.1 节点内容未确定前用保守值 |
| `fitView` 需 `ReactFlowProvider` 包裹 | `useReactFlow` 必须在 Provider 子树内 | v0.1 在 `task-graph` 视图根包一层 Provider |
| `fitView` 必须在 `setNodes` 之后调用 | 否则取旧 bbox | 包一层 `requestAnimationFrame` |

---

## 三、官方示例向 skyaxis v0.1 的适配点

| 官方示例默认 | skyaxis v0.1 实际 | 适配理由 |
| --- | --- | --- |
| `NODE_WIDTH = 172` | `220` | Subagent 节点要显示状态徽标 + label，最小宽度放大 |
| `NODE_HEIGHT = 36` | `56` | 节点需两行（label + status），单行 36px 容纳不下 |
| 节点 `data.label` 字符串 | `data.label + data.status` | ADR §5.2 最小节点状态 5 种：`pending / running / done / failed / waiting` |
| 方向 `TB` 默认 | 默认 `TB`，节点稀疏时切 `LR` 留接口 | 与 ADR §5.1 任务图树状结构吻合 |
| 自定义节点用 `nodeTypes` | `root / step / subagent / approval` 四种（ADR §5.1） | v0.1 先实现 `step` / `subagent` 两种，根节点用 React Flow 默认节点 |

---

## 四、Bundle 影响（与 ADR §4.4 对齐）

```
@xyflow/react    ~70-100KB gzip
@dagrejs/dagre   ~25-35KB  gzip
合计             ~100-130KB gzip（inline 进 lib/client.js）
```

DSH 的 `shared/tsdown.client.ts` 默认 `noExternal` 全 inline（除 module table 条目），`@xyflow/react` 与 `@dagrejs/dagre` 不在 `CLIENT_EXTERNALS` 中，会自动 inline。`lib/client.js` 从当前 ~25KB 膨胀到 ~300-400KB 区间，DSH web 可接受（DSH 自身已在加载十几个 `@deepseek-ai/*` 模块）。

注：`react` / `react-dom` / `react-dom/client` / `react/jsx-runtime` 列入 `CLIENT_EXTERNALS`（与宿主共享 React identity —— 不 inline，否则宿主渲染 slot 时插件的 ReactCurrentDispatcher 是 null，`useState` 抛 `Cannot read properties of null`）。`scheduler` 仍 inline（react-dom 内部实现细节）。

需要同步在 `tsdown.config.ts` 的 `libExternal` 列表显式声明（host 端不需这两个包，保持显式以便审计）。

---

## 五、落地清单（对应 ADR §八 文件改动表）

| 文件 | 改动 | 状态 |
| --- | --- | --- |
| `package.json` | `dependencies` 新增 `@xyflow/react ^12.10.4`、`@dagrejs/dagre ^1.1.4` | 待实施 |
| `tsdown.config.ts` | `libExternal` 列表新增上述两个包 | 待实施 |
| `src/client/task-graph/types.ts` | 新增：节点 / 边 TS 类型（`TaskNode` / `TaskEdge`） | 待实施 |
| `src/client/task-graph/layout.ts` | 新增：`layoutTaskGraph`（§二.2 官方布局函数的项目化版本） | 待实施 |
| `src/client/task-graph/view.tsx` | stub → 最小 MVP（§二 + §一 组合） | 待实施 |

**不在本调研范围**：节点推断逻辑（trajectory → task node tree）、节点状态聚合、subagent 子树渲染——这些属于 v0.1 主体实现，留待后续 research / ADR 跟进。

---

## 六、跑通判据

MVP 阶段（不接真实数据）：

1. `pnpm install` 无类型错误。
2. `pnpm typecheck` 通过。
3. DSH web 内打开"任务图" tab，能看到 4 个种子节点（root + 2 step + 1 subagent）按 dagre 自上而下排列。
4. 拖动节点、滚轮缩放、`<Controls />` 按钮、`fitView` 全部正常。
5. 改变 `direction` 为 `'LR'`，节点重排为水平，确认 `sourcePosition / targetPosition` 适配正确。

接真实数据后（v0.1 主体）：见 ADR §七.1。

---

## 七、未决问题（留给后续 research / ADR）

1. **自定义节点 vs 默认节点**：v0.1 是否需要为 `step / subagent / approval` 写自定义 React 节点组件？还是先用 React Flow 默认节点 + `data.label` 拼字？决策点：状态徽标 + subagent 折叠按钮的复杂度。
2. **fitView 触发时机**：仅初次布局？还是每次 `nodes` 变化都 fit？决策点：用户拖动节点后是否要保留其位置。
3. **subagent 子树折叠**：subagent 节点是默认展开（占用大量画布空间）还是默认折叠（点开才展开）？决策点：典型 session 节点数（百级 vs 个位）。
4. **布局算法选型**：dagre 对树状 / 浅 DAG 够用；v0.2 如果出现高扇出 / 交叉边，是否切到 ELK？Dagre 也无妨，但 ELK 对复杂布局更稳。

---

## Sources

- [Learn · React Flow](https://reactflow.dev/learn)（v12 Quick Start）
- [Layouting · React Flow](https://reactflow.dev/learn/layouting)（Dagre 集成官方示例）
- [@xyflow/react on npm](https://www.npmjs.com/package/@xyflow/react)（v12.x 当前版本）
- [@dagrejs/dagre on npm](https://www.npmjs.com/package/@dagrejs/dagre)（1.1.x，dagre 官方 fork）
