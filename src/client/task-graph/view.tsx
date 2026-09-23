import { Component, useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ErrorInfo, JSX, ReactNode } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  useReactFlow,
} from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
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
 * skyaxis.taskGraph 命名空间的 i18n 函数；`navigate` 为 subagent 节点的
 * 点击导航回调（register 用 ctx.sessions 的 openSubagent/open 实现，
 * 视图层保持无 ctx）；`startConnector` 为连接器工厂——本视图首次挂载时
 * 启动、卸载时释放（懒启动：没打开任务图的标签页不持有事件窗口订阅）。
 */
interface TaskGraphViewProps {
  store: TaskGraphStore
  t: TaskGraphT
  navigate: (id: string) => void
  startConnector: () => () => void
}

export function TaskGraphView({ store, t, navigate, startConnector }: TaskGraphViewProps): JSX.Element {
  // 连接器生命周期 = 本组件挂载周期。effect 直接返回 disposer 作 cleanup。
  useEffect(() => startConnector(), [startConnector])
  return (
    <ReactFlowProvider>
      {/* 保险（dist/01 原则 4"失败可见 > 失败致命"）：任务图的渲染异常降级为
          视图内错误卡片，绝不波及宿主其它面板。 */}
      <TaskGraphErrorBoundary t={t}>
        <TaskGraphBoard store={store} t={t} navigate={navigate} />
      </TaskGraphErrorBoundary>
    </ReactFlowProvider>
  )
}

/** 居中占位卡片（空态 / 加载中 / 错误共用同一视觉）。 */
function Placeholder({ t, text }: { t: TaskGraphT; text: string }): JSX.Element {
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
      {text}
    </div>
  )
}

interface ErrorBoundaryProps {
  t: TaskGraphT
  children: ReactNode
}

interface ErrorBoundaryState {
  error: Error | null
}

/** 任务图渲染异常的兜底边界：降级为错误卡片 + Console 保留现场。 */
class TaskGraphErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[skyaxis task-graph] render failed:', error, info.componentStack)
  }

  render(): ReactNode {
    if (this.state.error !== null) {
      return <Placeholder t={this.props.t} text={this.props.t('view.error')} />
    }
    return this.props.children
  }
}

/**
 * 极简自定义节点（P2a）：状态色圆点 + label + navigable 可点击样式。
 * 同时补齐 ADR 0001 §七.1 "每个节点带状态颜色" 的验收项——此前默认节点
 * 不渲染 status。颜色用 CSS 变量优先、hex 兜底，主题接入时只需提供变量。
 */
/**
 * title 提示文案：label + 最近一次请求的路由事实（P2b）。effort 的来源
 * 用原始枚举值（request-config / adapter-default / not-recorded）——数据
 * 事实不加解释；本地化 tooltip 面板留 P3 自定义节点。
 */
function nodeTitle(data: TaskNode['data']): string {
  if (data.metrics === undefined) return data.label
  const m = data.metrics
  const effort =
    m.reasoningEffort === undefined
      ? 'not-recorded'
      : `${m.reasoningEffort} (${m.reasoningSource})`
  return `${data.label}\n${m.provider} · ${m.model} · ${effort}`
}

function TaskGraphNode({ data }: NodeProps<TaskNode>): JSX.Element {
  return (
    <div
      className="skyaxis-tg-node"
      data-status={data.status}
      data-navigable={data.navigable ? 'true' : undefined}
      title={nodeTitle(data)}
    >
      {/* 边的锚点：React Flow 的边必须挂在 <Handle> 上，没有 Handle 边整条不渲染。
          layout.ts 的 sourcePosition/targetPosition（Bottom/Top）与此对应。 */}
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span className="skyaxis-tg-node-dot" aria-hidden="true" />
      <span className="skyaxis-tg-node-label">{data.label}</span>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  )
}

/** nodeTypes 必须是稳定引用（模块级），否则 React Flow 每帧重挂节点。 */
const nodeTypes = {
  root: TaskGraphNode,
  'user-prompt': TaskGraphNode,
  task: TaskGraphNode,
  subagent: TaskGraphNode,
  approval: TaskGraphNode,
}

/** 自定义节点的样式（与 reactFlowCss 同一个 <style> 标签注入）。 */
const taskGraphNodeCss = `
.skyaxis-tg-node {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  padding: 6px 10px;
  border: 1px solid var(--skyaxis-border, #d0d4dc);
  border-radius: 8px;
  background: var(--skyaxis-surface, #fff);
  font-size: 12px;
}
.skyaxis-tg-node[data-navigable='true'] {
  cursor: pointer;
  border-style: dashed;
}
.skyaxis-tg-node-dot {
  flex: none;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--skyaxis-status-pending, #9aa2af);
}
.skyaxis-tg-node[data-status='running'] .skyaxis-tg-node-dot {
  background: var(--skyaxis-status-running, #2f6fed);
}
.skyaxis-tg-node[data-status='done'] .skyaxis-tg-node-dot {
  background: var(--skyaxis-status-done, #2ea84f);
}
.skyaxis-tg-node[data-status='failed'] .skyaxis-tg-node-dot {
  background: var(--skyaxis-status-failed, #d64545);
}
.skyaxis-tg-node[data-status='waiting'] .skyaxis-tg-node-dot {
  background: var(--skyaxis-status-waiting, #b8860b);
}
.skyaxis-tg-node-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-weight: 500;
}
.skyaxis-tg-node .react-flow__handle {
  width: 5px;
  height: 5px;
  min-width: 5px;
  min-height: 5px;
  border: none;
  border-radius: 50%;
  background: var(--skyaxis-border, #b7bdc9);
}
`

/**
 * 实际画布组件，必须包在 <ReactFlowProvider> 内才能用 useReactFlow。
 *
 * 数据流：`store`（connector 写入）→ `useSyncExternalStore` → `layoutTaskGraph`
 * → React Flow 受控 nodes/edges。
 */
/** 画布组件的 props（不消费 startConnector——连接器在外层 TaskGraphView 管理）。 */
interface TaskGraphBoardProps {
  store: TaskGraphStore
  t: TaskGraphT
  navigate: (id: string) => void
}

function TaskGraphBoard({ store, t, navigate }: TaskGraphBoardProps): JSX.Element {
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
    tag.textContent = `${reactFlowCss}\n${taskGraphNodeCss}`
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
    return <Placeholder t={t} text={t('view.empty')} />
  }

  // binding 还没 mint：list → scope 之间的过渡帧。
  if (loading) {
    return <Placeholder t={t} text={t('view.loading')} />
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
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeClick={(_, node) => {
          // navigable 节点（subagent）点击导航；task/user-prompt 无 navigationId。
          if (node.data.navigationId) navigate(node.data.navigationId)
        }}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>
    </div>
  )
}
