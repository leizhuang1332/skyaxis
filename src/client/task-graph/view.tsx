import { useEffect, useMemo } from 'react'
import type { JSX } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from '@xyflow/react'
// 走 `?inline` 把 CSS 烤成字符串打进 bundle，DSH web 的 plugin loader 只接
// `*.module.css`，对裸 CSS（@tsdown/css 抽出来的 lib/style.css）不认，
// 所以我们自己在 mount 时 appendChild 一个 <style> 标签，卸载时清掉。
import reactFlowCss from '@xyflow/react/dist/style.css?inline'
import { layoutTaskGraph } from './layout.js'
import type { TaskNode, TaskEdge } from './types.js'

/**
 * 种子数据 — ADR §5.1 最小集合：root + 2 step + 1 subagent。
 * v0.1 后续迭代从 trajectory 推断出真实任务树时，此 seed 由数据源替换。
 */
const seed: { nodes: TaskNode[]; edges: TaskEdge[] } = {
  nodes: [
    { id: 'root', type: 'root',     position: { x: 0, y: 0 }, data: { label: 'Session root',         status: 'running' } },
    { id: 's1',   type: 'step',     position: { x: 0, y: 0 }, data: { label: 'Step 1: read file',    status: 'done' } },
    { id: 's2',   type: 'step',     position: { x: 0, y: 0 }, data: { label: 'Step 2: refactor',     status: 'running' } },
    { id: 'sa',   type: 'subagent', position: { x: 0, y: 0 }, data: { label: 'Subagent: search',     status: 'pending' } },
  ],
  edges: [
    { id: 'e-r-1', source: 'root', target: 's1' },
    { id: 'e-r-2', source: 'root', target: 's2' },
    { id: 'e-r-a', source: 'root', target: 'sa' },
  ],
}

/**
 * 实际画布组件，必须包在 <ReactFlowProvider> 内才能用 useReactFlow。
 */
function TaskGraphBoard(): JSX.Element {
  const initial = useMemo(() => layoutTaskGraph(seed.nodes, seed.edges, 'TB'), [])
  const [nodes, , onNodesChange] = useNodesState<TaskNode>(initial.nodes)
  const [edges, , onEdgesChange] = useEdgesState<TaskEdge>(initial.edges)
  const { fitView } = useReactFlow()

  // DSH web 的 plugin loader 只扫 `*.module.css`，对 `@tsdown/css` 抽出来的
  // `lib/style.css` 不做注入。React Flow 的样式不进 `<head>` 就全是浏览器默认
  // 渲染（节点变成黑方块）。所以这里手动挂一个 `<style data-plugin="@lz/skyaxis">`
  // 标签，命名风格对齐 DSH 其它 style 标签，DevTools 里一眼能认出。
  // `useEffect` 在浏览器里跑——SSR / 测试环境没 `document`，因此兜个 typeof 守卫。
  useEffect(() => {
    if (typeof document === 'undefined') return
    const tag = document.createElement('style')
    tag.dataset.plugin = '@lz/skyaxis'
    tag.textContent = reactFlowCss
    document.head.appendChild(tag)
    return () => {
      tag.remove()
    }
  }, [])

  // research §2.4：fitView 前包一层 rAF，等 React Flow 量完新坐标再 fit，
  // 否则 fitView 取到旧 bbox，首屏定位会偏。
  useEffect(() => {
    const id = window.requestAnimationFrame(() => fitView())
    return () => window.cancelAnimationFrame(id)
  }, [fitView])

  return (
    <div
      role="region"
      aria-label="任务图"
      style={{ width: '100%', height: '100%' }}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  )
}

/**
 * Slot entry: `conversation.view` 在 DSH 会话视图内渲染此组件。
 * 外层仅做 Provider 包装，把 hooks 留给内部画布组件使用。
 */
export function TaskGraphView(): JSX.Element {
  return (
    <ReactFlowProvider>
      <TaskGraphBoard />
    </ReactFlowProvider>
  )
}
