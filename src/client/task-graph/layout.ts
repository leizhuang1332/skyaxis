/**
 * Dagre 自动布局函数。
 *
 * 来自 React Flow 官方 Layouting 示例（@xyflow/react v12 + @dagrejs/dagre），
 * 项目化版本见 docs/research/0001-react-flow-dagre-minimal-demo.md §二。
 *
 * 入参：任意 position 的 nodes / edges。
 * 出参：position 已按 Dagre 计算好的新数组；并按方向统一设置
 *       sourcePosition / targetPosition（否则 bezier edge 走对角线）。
 *
 * MVP 阶段节点宽高用常量；v0.2 接自定义节点组件后再读 ref 实测尺寸。
 */
import dagre from '@dagrejs/dagre'
import { Position } from '@xyflow/react'
import type { TaskNode, TaskEdge } from './types.js'

const NODE_WIDTH = 220 // research §三：subagent 标签宽度 + 状态徽标
const NODE_HEIGHT = 56 // research §三：双行（label + status）

export function layoutTaskGraph(
  nodes: TaskNode[],
  edges: TaskEdge[],
  direction: 'TB' | 'LR' = 'TB',
): { nodes: TaskNode[]; edges: TaskEdge[] } {
  const g = new dagre.graphlib.Graph()
  g.setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: direction, nodesep: 40, ranksep: 60 })

  const horizontal = direction === 'LR'
  for (const n of nodes) g.setNode(n.id, { width: NODE_WIDTH, height: NODE_HEIGHT })
  for (const e of edges) g.setEdge(e.source, e.target)

  dagre.layout(g)

  return {
    nodes: nodes.map((n) => {
      const { x, y } = g.node(n.id)
      return {
        ...n,
        targetPosition: horizontal ? Position.Left : Position.Top,
        sourcePosition: horizontal ? Position.Right : Position.Bottom,
        position: { x: x - NODE_WIDTH / 2, y: y - NODE_HEIGHT / 2 },
      }
    }),
    edges,
  }
}

/**
 * 布局指纹（P3 signature 门控）：节点 id 集 + 全部边（source>target）的
 * 确定性拼接。status / label / metrics 变化**不改**指纹（P0 稳定 ID 的
 * 前提）→ 视图可跳过重排、保留手工位置。增删节点或边 → 指纹变化 → 重排。
 */
export function layoutSignature(nodes: readonly TaskNode[], edges: readonly TaskEdge[]): string {
  const nodePart = nodes
    .map((n) => n.id)
    .slice()
    .sort()
    .join('|')
  const edgePart = edges
    .map((e) => `${e.source}>${e.target}`)
    .slice()
    .sort()
    .join('|')
  return `${nodePart}||${edgePart}`
}

/**
 * 把手工位置叠到布局结果上（P3 拖拽保留）：manual 里存在的 id 覆盖
 * position，其余用布局值。返回新数组，不改入参。
 */
export function applyManualPositions(
  nodes: readonly TaskNode[],
  manual: ReadonlyMap<string, { x: number; y: number }>,
): TaskNode[] {
  if (manual.size === 0) return [...nodes]
  return nodes.map((n) => {
    const pos = manual.get(n.id)
    return pos === undefined ? n : { ...n, position: { x: pos.x, y: pos.y } }
  })
}
