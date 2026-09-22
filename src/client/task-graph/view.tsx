import { useEffect, useMemo, useSyncExternalStore } from 'react'
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
import type { TaskGraphStore } from './store.js'
import type { TaskGraphT } from './dictionary.js'

/**
 * Slot entry: `conversation.view` 在 DSH 会话视图内渲染此组件。
 * 外层仅做 Provider 包装，把 hooks 留给内部画布组件使用。
 * `store` 由 register.ts 在 apply 阶段创建并通过 props 注入（plan 决策 1：
 * 不走 store seat，实例跟随 register 的 disposer）；`t` 为绑定到
 * skyaxis.taskGraph 命名空间的 i18n 函数（P1：占位文案不再硬编码中文）。
 */
interface TaskGraphViewProps {
  store: TaskGraphStore
  t: TaskGraphT
}

export function TaskGraphView({ store, t }: TaskGraphViewProps): JSX.Element {
  return (
    <ReactFlowProvider>
      <TaskGraphBoard store={store} t={t} />
    </ReactFlowProvider>
  )
}

/**
 * 实际画布组件，必须包在 <ReactFlowProvider> 内才能用 useReactFlow。
 *
 * 数据流：`store`（connector 写入）→ `useSyncExternalStore` → `layoutTaskGraph`
 * → React Flow 受控 nodes/edges。
 */
function TaskGraphBoard({ store, t }: TaskGraphViewProps): JSX.Element {
  const { sessionId, nodes: inferredNodes, edges: inferredEdges, loading } =
    useSyncExternalStore(
      (l) => store.subscribe(l),
      () => store.getSnapshot(),
    )

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

  const laidOut = useMemo(() => {
    if (inferredNodes.length === 0) return null
    return layoutTaskGraph(inferredNodes, inferredEdges, 'TB')
  }, [inferredNodes, inferredEdges])

  const [nodes, setNodes, onNodesChange] = useNodesState<TaskNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<TaskEdge>([])

  // 推断结果变化时同步到 React Flow 的内部 state（用户拖动后会被新数据覆盖——
  // 数据源是真相，拖动只是视图层临时位移；新事件到来意味着布局整体更新）。
  useEffect(() => {
    if (laidOut) {
      setNodes(laidOut.nodes)
      setEdges(laidOut.edges)
    } else {
      setNodes([])
      setEdges([])
    }
  }, [laidOut, setNodes, setEdges])

  const { fitView } = useReactFlow()

  // research §2.4：fitView 前包一层 rAF，等 React Flow 量完新坐标再 fit，
  // 否则 fitView 取到旧 bbox，首屏定位会偏。依赖 laidOut 让"新 session 进
  // 数据"也触发一次 fitView。
  useEffect(() => {
    const id = window.requestAnimationFrame(() => fitView())
    return () => window.cancelAnimationFrame(id)
  }, [fitView, laidOut])

  // 无 selection：empty placeholder（fallback 路径）。
  if (!sessionId) {
    return (
      <div
        role="region"
        aria-label={t('view.taskGraph')}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.6,
          fontSize: 14,
        }}
      >
        {t('view.empty')}
      </div>
    )
  }

  // binding 还没 mint：list → scope 之间的过渡帧。
  if (loading) {
    return (
      <div
        role="region"
        aria-label={t('view.taskGraph')}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          opacity: 0.6,
          fontSize: 14,
        }}
      >
        {t('view.loading')}
      </div>
    )
  }

  return (
    <div
      role="region"
      aria-label={t('view.taskGraph')}
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
