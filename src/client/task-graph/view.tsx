import { Component, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
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
import { applyManualPositions, layoutSignature, layoutTaskGraph } from './layout.js'
import { filterFailedAttempts } from './workflows.js'
import { formatDuration, panelModelFor } from './projections/panel-model.js'
import type { PanelModel } from './projections/panel-model.js'
import type { ActivityDoc, TodoStatusOf } from './document/types.js'
import type { TaskNode, TaskEdge } from './types.js'
import type { TaskGraphStore } from './store.js'
import type { TaskGraphT } from './dictionary.js'

/**
 * Slot entry: `conversation.view` 在 DSH 会话视图内渲染此组件。
 * 外层仅做 Provider 包装，把 hooks 留给内部画布组件使用。
 * `store` 由 register.ts 在 apply 阶段创建并通过 props 注入（plan 决策 1：
 * 不走 store seat，实例跟随 register 的 disposer）；`t` 为绑定到
 * skyaxis.taskGraph 命名空间的 i18n 函数；`navigate` 为 subagent 节点的
 * 点击导航回调（register 走宿主 UiWorkspace.openSession 实现——0033：
 * ctx.sessions 的 open/openSubagent 已退役，视图层保持无 ctx）；
 * `startConnector` 为连接器工厂——本视图首次挂载时
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
/** 状态 → 本地化文案（显式映射，不用模板字符串 cast）。 */
function statusLabel(status: TaskNode['data']['status'], t: TaskGraphT): string {
  switch (status) {
    case 'pending':
      return t('status.pending')
    case 'running':
      return t('status.running')
    case 'done':
      return t('status.done')
    case 'failed':
      return t('status.failed')
    case 'cancelled':
      return t('status.cancelled')
    case 'waiting':
      return t('status.waiting')
    case undefined:
      return ''
  }
}

// P3 修闪烁：memo 化——store tick 引起的画布重渲染不再 churn 节点 DOM
// （hover 面板闪烁的机制之一）。
// P4 后：不再挂原生 title 提示——指标面板已覆盖其信息，两者同现会互相
// 遮挡（用户裁定 2026-09-23）；无鼠标场景的可访问性由 aria/面板承担。
const TaskGraphNode = memo(function TaskGraphNode({ id, data }: NodeProps<TaskNode>): JSX.Element {
  return (
    <div
      className="skyaxis-tg-node"
      data-node-id={id}
      data-status={data.status}
      data-navigable={data.navigable ? 'true' : undefined}
    >
      {/* 边的锚点：React Flow 的边必须挂在 <Handle> 上，没有 Handle 边整条不渲染。
          layout.ts 的 sourcePosition/targetPosition（Bottom/Top）与此对应。 */}
      <Handle type="target" position={Position.Top} isConnectable={false} />
      <span className="skyaxis-tg-node-dot" aria-hidden="true" />
      <span className="skyaxis-tg-node-label">{data.label}</span>
      <Handle type="source" position={Position.Bottom} isConnectable={false} />
    </div>
  )
})

/** nodeTypes 必须是稳定引用（模块级），否则 React Flow 每帧重挂节点。 */
const nodeTypes = {
  root: TaskGraphNode,
  'user-prompt': TaskGraphNode,
  task: TaskGraphNode,
  subagent: TaskGraphNode,
  workflow: TaskGraphNode,
  'workflow-phase': TaskGraphNode,
  'workflow-member': TaskGraphNode,
  approval: TaskGraphNode,
}

/**
 * 自定义节点的样式（与 reactFlowCss 同一个 <style> 标签注入）。
 * 全部走 --dsw-alias-* / --dsw-elevation-* 语义 token（docs/web-styling.md
 * 规范）：亮暗两套与第三方主题插件换装随宿主级联，不再携带任何字面色。
 */
const taskGraphNodeCss = `
.skyaxis-tg-node {
  display: flex;
  align-items: center;
  gap: 6px;
  max-width: 220px;
  padding: 6px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
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
  background: var(--dsw-alias-label-tertiary);
}
.skyaxis-tg-node[data-status='running'] .skyaxis-tg-node-dot {
  background: var(--dsw-alias-state-business-primary);
}
.skyaxis-tg-node[data-status='done'] .skyaxis-tg-node-dot {
  background: var(--dsw-alias-state-success-primary);
}
.skyaxis-tg-node[data-status='failed'] .skyaxis-tg-node-dot {
  background: var(--dsw-alias-state-error-primary);
}
.skyaxis-tg-node[data-status='cancelled'] .skyaxis-tg-node-dot {
  background: var(--dsw-alias-label-dimmed);
}
.skyaxis-tg-node[data-status='waiting'] .skyaxis-tg-node-dot {
  background: var(--dsw-alias-state-warn-primary);
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
  background: var(--dsw-alias-border-l3);
}
/* P3 工具条 */
.skyaxis-tg-toolbar {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 5;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1);
  font-size: 12px;
  cursor: pointer;
}
/* v0.4 切片 A：事件窗口前缀截断的诚实标注（research 0033 §八——hasMore
   是窗口契约不是缺陷；右上角、只读、不抢工具条位置）。 */
.skyaxis-tg-morenote {
  position: absolute;
  top: 8px;
  right: 12px;
  z-index: 5;
  padding: 4px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-1);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px;
  pointer-events: none;
}
/* P3 tooltip 指标面板 */
.skyaxis-tg-tooltip {
  position: absolute;
  z-index: 6;
  min-width: 180px;
  max-width: 300px;
  padding: 8px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 8px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-panel);
  font-size: 12px;
  pointer-events: none;
}
.skyaxis-tg-tooltip-title {
  margin-bottom: 4px;
  font-weight: 600;
}
.skyaxis-tg-tooltip-row {
  color: var(--dsw-alias-label-secondary);
}
/* P3 workflow 定义面板 */
.skyaxis-tg-defpanel {
  position: absolute;
  top: 40px;
  right: 12px;
  z-index: 7;
  display: flex;
  flex-direction: column;
  width: min(480px, 60%);
  max-height: 70%;
  padding: 12px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1);
  box-shadow: var(--dsw-elevation-prominent);
  font-size: 12px;
}
.skyaxis-tg-defpanel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.skyaxis-tg-defpanel-head button {
  padding: 2px 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}
.skyaxis-tg-defpanel-desc {
  margin: 6px 0 0;
  color: var(--dsw-alias-label-secondary);
}
.skyaxis-tg-defpanel-phases {
  margin: 6px 0 0;
  padding-left: 18px;
}
.skyaxis-tg-defpanel h4 {
  margin: 10px 0 4px;
}
.skyaxis-tg-defpanel-script {
  overflow: auto;
  max-height: 40vh;
  margin: 0;
  padding: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  white-space: pre;
}
/* v0.4 切片 B：明细面板正文 / 活动展开区 / 边证据图例 */
.skyaxis-tg-panel {
  overflow-y: auto;
}
.skyaxis-tg-panel-pre {
  overflow-x: auto;
  margin: 4px 0;
  padding: 8px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 6px;
  background: var(--dsw-alias-bg-layer-2);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px;
  white-space: pre-wrap;
  word-break: break-word;
}
.skyaxis-tg-panel-row {
  margin: 2px 0;
  color: var(--dsw-alias-label-secondary);
}
.skyaxis-tg-panel-error {
  color: var(--dsw-alias-state-error-primary);
}
.skyaxis-tg-panel-warn {
  color: var(--dsw-alias-state-warn-primary);
}
.skyaxis-tg-panel-open {
  margin-top: 8px;
  padding: 4px 10px;
  border: 1px solid var(--dsw-alias-border-l2);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
}
.skyaxis-tg-act {
  border-top: 1px solid var(--dsw-alias-border-l2);
}
.skyaxis-tg-act summary {
  display: flex;
  gap: 6px;
  align-items: baseline;
  padding: 5px 0;
  cursor: pointer;
  font-size: 12px;
  list-style: none;
}
.skyaxis-tg-act summary::-webkit-details-marker {
  display: none;
}
.skyaxis-tg-act-kind {
  flex: none;
  color: var(--dsw-alias-label-secondary);
}
.skyaxis-tg-act-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.skyaxis-tg-act-meta {
  flex: none;
  color: var(--dsw-alias-label-secondary);
}
.skyaxis-tg-legend {
  position: absolute;
  top: 44px;
  left: 8px;
  z-index: 5;
  display: flex;
  gap: 10px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary);
  pointer-events: none;
}
.skyaxis-tg-legend-solid,
.skyaxis-tg-legend-dash {
  display: inline-block;
  width: 18px;
  border-top: 2px solid var(--dsw-alias-border-l3);
  vertical-align: middle;
  margin-right: 4px;
}
.skyaxis-tg-legend-dash {
  border-top-style: dashed;
}
/* 宿主会话壳的宽度拖拽柄在任务图 tab 下是孤儿元素（所属面板已隐藏但
   handle 仍可交互，悬在画布中间——用户报告 2026-09-23）。用稳定的
   data-width-handle 属性定位：class 前缀（wSkVaW_ 之流）是 CSS module
   hash，跨宿主构建会变，不可依赖。本规则随 <style data-plugin="@leizhuang1332/skyaxis">
   标签的生命周期生效——仅任务图视图挂载期间禁用拖拽，切回 chat 等 tab
   标签卸载即恢复（宿主修复此 bug 后本规则自然空转）。 */
[data-width-handle] {
  pointer-events: none !important;
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
  // `document: sessionDocument` —— 解构名避开 DOM 全局（下面 style 注入
  // effect 里的 `document.createElement` / `document.head` 依赖全局）。
  const {
    sessionId,
    nodes: inferredNodes,
    edges: inferredEdges,
    document: sessionDocument,
    loading,
    hasMore,
  } = useSyncExternalStore(
    (l) => store.subscribe(l),
    () => store.getSnapshot(),
  )

  // P3 opt-in（P2d 用户裁定，默认关）：隐藏同 run 内同名失败尝试。
  const [hideFailed, setHideFailed] = useState(false)
  // P3 拖拽保留：手工位置覆盖（signature 不变时不被重排冲掉）。
  const [manualPositions, setManualPositions] = useState<
    ReadonlyMap<string, { x: number; y: number }>
  >(() => new Map())
  // P3 tooltip 指标面板 / 切片 B 明细面板的视图状态。selected = 点击的节点
  // （点击语义变更：任意节点单击开面板；导航收进面板按钮——ADR 0036 B）。
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selected, setSelected] = useState<TaskNode | null>(null)

  // 切 session 重置手工布局（对齐 dist 的 per-session 手工布局语义）。
  useEffect(() => {
    setManualPositions(new Map())
    setHoveredId(null)
    setSelected(null)
  }, [sessionId])

  // DSH web 的 plugin loader 只扫 `*.module.css`，对 `@tsdown/css` 抽出来的
  // `lib/style.css` 不做注入。React Flow 的样式不进 `<head>` 就全是浏览器默认
  // 渲染（节点变成黑方块）。所以这里手动挂一个 `<style data-plugin="@leizhuang1332/skyaxis">`
  // 标签，命名风格对齐 DSH 其它 style 标签，DevTools 里一眼能认出。
  // `useEffect` 在浏览器里跑——SSR / 测试环境没 `document`，因此兜个 typeof 守卫。
  useEffect(() => {
    if (typeof document === 'undefined') return
    const tag = document.createElement('style')
    tag.dataset.plugin = '@leizhuang1332/skyaxis'
    tag.textContent = `${reactFlowCss}\n${taskGraphNodeCss}`
    document.head.appendChild(tag)
    return () => {
      tag.remove()
    }
  }, [])

  // opt-in 过滤在 layout 之前：signature 基于过滤后集合 → 切换时重排一次。
  const filtered = useMemo(
    () =>
      hideFailed
        ? filterFailedAttempts(inferredNodes, inferredEdges)
        : { nodes: inferredNodes, edges: inferredEdges },
    [hideFailed, inferredNodes, inferredEdges],
  )

  // P3 signature 门控：节点/边集合不变（status/label/metrics 变化不算）→
  // 不重跑 dagre，手工位置得以保留。
  const signature = useMemo(
    () => layoutSignature(filtered.nodes, filtered.edges),
    [filtered],
  )
  const layoutCache = useRef<{ signature: string; nodes: TaskNode[] } | null>(null)
  const laidOut = useMemo(() => {
    if (filtered.nodes.length === 0) {
      layoutCache.current = null
      return [] as TaskNode[]
    }
    if (layoutCache.current?.signature === signature) return layoutCache.current.nodes
    const out = layoutTaskGraph(filtered.nodes, filtered.edges, 'TB')
    layoutCache.current = { signature, nodes: out.nodes }
    return out.nodes
  }, [signature, filtered])

  // 手工位置叠加（拖拽保留的第二半）。
  const displayed = useMemo(
    () => applyManualPositions(laidOut, manualPositions),
    [laidOut, manualPositions],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState<TaskNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<TaskEdge>([])

  // P3 修闪烁：edges 引用也按 signature 门控——store tick 内容不变时保持
  // 同一引用，React Flow 不因新数组引用整画布重渲染。
  // 切片 B：evidence=inferred 的边注入虚线样式（fact 边保持默认实线）。
  const edgesCache = useRef<{ signature: string; edges: TaskEdge[] } | null>(null)
  const stableEdges = useMemo(() => {
    if (edgesCache.current?.signature === signature) return edgesCache.current.edges
    const styled = filtered.edges.map((e) =>
      e.data?.evidence === 'inferred'
        ? { ...e, style: { strokeDasharray: '6 4' } }
        : e,
    )
    edgesCache.current = { signature, edges: styled }
    return styled
  }, [signature, filtered.edges])

  useEffect(() => {
    setNodes(displayed)
    setEdges(stableEdges)
  }, [displayed, stableEdges, setNodes, setEdges])

  const { fitView } = useReactFlow()

  // research §2.4：fitView 前包一层 rAF，等 React Flow 量完新坐标再 fit，
  // 否则 fitView 取到旧 bbox，首屏定位会偏。依赖 signature 让"结构变化"
  // 触发一次 fitView；status-only 变化不触发（门控语义）。
  useEffect(() => {
    const id = window.requestAnimationFrame(() => fitView())
    return () => window.cancelAnimationFrame(id)
  }, [fitView, signature])

  const hoveredNode = hoveredId === null ? undefined : displayed.find((n) => n.id === hoveredId)

  // 切片 B：明细面板模型（纯选择器；sessionDocument/selected 任一变化重算）。
  const panelModel = useMemo(
    () =>
      selected !== null && sessionDocument !== undefined
        ? panelModelFor(sessionDocument, selected)
        : null,
    [selected, sessionDocument],
  )

  // P3 修定位：直接量节点 DOM（getBoundingClientRect）相对容器定位——不做
  // flow→screen 换算（此前 +230 偏移叠加 zoom 假设导致面板远离节点）。
  // useLayoutEffect 在 paint 前量测，避免闪烁。
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null)
  useLayoutEffect(() => {
    if (hoveredId === null) {
      setTooltipPos(null)
      return
    }
    const container = containerRef.current
    const el = container?.querySelector<HTMLElement>(`[data-node-id="${hoveredId}"]`)
    if (container === null || el === null || el === undefined) {
      setTooltipPos(null)
      return
    }
    const c = container.getBoundingClientRect()
    const r = el.getBoundingClientRect()
    setTooltipPos({ x: r.right - c.left + 10, y: r.top - c.top })
  }, [hoveredId, displayed])

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
      ref={containerRef}
      role="region"
      aria-label={t('view.taskGraph')}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      {/* P3 工具条：opt-in 过滤开关（默认关，P2d 裁定）。 */}
      <label className="skyaxis-tg-toolbar">
        <input
          type="checkbox"
          checked={hideFailed}
          onChange={(e) => setHideFailed(e.target.checked)}
        />
        <span>{t('view.hideFailedAttempts')}</span>
      </label>

      {/* 切片 B：边证据图例（实线 wire 事实 / 虚线推断顺序）。 */}
      <div className="skyaxis-tg-legend">
        <span className="skyaxis-tg-legend-solid" aria-hidden="true" /> {t('legend.fact')}
        <span className="skyaxis-tg-legend-dash" aria-hidden="true" /> {t('legend.inferred')}
      </div>

      {/* v0.4 切片 A：窗口前缀截断标注（hasMore=true 时的诚实提示）。 */}
      {hasMore ? <div className="skyaxis-tg-morenote">{t('view.earlierEvents')}</div> : null}

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodeDragStop={(_, node) => {
          setManualPositions((prev) => {
            const next = new Map(prev)
            next.set(node.id, { x: node.position.x, y: node.position.y })
            return next
          })
        }}
        onNodeClick={(_, node) => setSelected(node)}
        onPaneClick={() => setSelected(null)}
        onNodeMouseEnter={(_, node) => setHoveredId(node.id)}
        onNodeMouseLeave={() => setHoveredId(null)}
        fitView
      >
        <Background />
        <Controls />
        <MiniMap />
      </ReactFlow>

      {/* P3 tooltip 指标面板（hover 定位到节点右侧）。 */}
      {hoveredNode !== undefined && tooltipPos !== null ? (
        <div
          className="skyaxis-tg-tooltip"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
          role="tooltip"
        >
          <div className="skyaxis-tg-tooltip-title">{hoveredNode.data.label}</div>
          {hoveredNode.data.status !== undefined ? (
            <div className="skyaxis-tg-tooltip-row">
              {statusLabel(hoveredNode.data.status, t)}
            </div>
          ) : null}
          {hoveredNode.data.durationMs !== undefined ? (
            <div className="skyaxis-tg-tooltip-row">
              {t('panel.duration')}: {formatDuration(hoveredNode.data.durationMs)}
            </div>
          ) : null}
          {hoveredNode.data.metrics === undefined ? (
            <div className="skyaxis-tg-tooltip-row">{t('view.noMetrics')}</div>
          ) : (
            <>
              <div className="skyaxis-tg-tooltip-row">
                {t('metrics.provider')}: {hoveredNode.data.metrics.provider}
              </div>
              <div className="skyaxis-tg-tooltip-row">
                {t('metrics.model')}: {hoveredNode.data.metrics.model}
              </div>
              <div className="skyaxis-tg-tooltip-row">
                {t('metrics.reasoning')}:{' '}
                {hoveredNode.data.metrics.reasoningEffort === undefined
                  ? t('metrics.sourceMissing')
                  : `${hoveredNode.data.metrics.reasoningEffort} · ${
                      hoveredNode.data.metrics.reasoningSource === 'adapter-default'
                        ? t('metrics.sourceAdapter')
                        : hoveredNode.data.metrics.reasoningSource === 'request-config'
                          ? t('metrics.sourceRequest')
                          : t('metrics.sourceMissing')
                    }`}
              </div>
            </>
          )}
        </div>
      ) : null}

      {/* 切片 B：明细面板（任意节点单击打开；P3 defpanel 的 workflow 定义
          面板并入此处，definition 成为 run 面板的一个 section）。 */}
      {panelModel !== null ? (
        <TaskGraphPanel
          model={panelModel}
          t={t}
          navigate={navigate}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  )
}

/** todo wire status → 既有 status 词典键（修订时间线行复用状态词表）。 */
function todoStatusLabel(status: TodoStatusOf, t: TaskGraphT): string {
  switch (status) {
    case 'pending':
      return t('status.pending')
    case 'in_progress':
      return t('status.running')
    case 'completed':
      return t('status.done')
  }
}

const timeOf = (ms: number): string => new Date(ms).toLocaleTimeString()

/** 指标三行（tooltip 与面板共用同一形状）。 */
function MetricsRows({
  metrics,
  t,
}: {
  metrics: NonNullable<TaskNode['data']['metrics']>
  t: TaskGraphT
}): JSX.Element {
  return (
    <>
      <div className="skyaxis-tg-tooltip-row">
        {t('metrics.provider')}: {metrics.provider}
      </div>
      <div className="skyaxis-tg-tooltip-row">
        {t('metrics.model')}: {metrics.model}
      </div>
      <div className="skyaxis-tg-tooltip-row">
        {t('metrics.reasoning')}:{' '}
        {metrics.reasoningEffort === undefined
          ? t('metrics.sourceMissing')
          : `${metrics.reasoningEffort} · ${
              metrics.reasoningSource === 'adapter-default'
                ? t('metrics.sourceAdapter')
                : metrics.reasoningSource === 'request-config'
                  ? t('metrics.sourceRequest')
                  : t('metrics.sourceMissing')
            }`}
      </div>
    </>
  )
}

/** 活动展开区（<details> 展开后的正文——按 kind 出全文/参数/结果/错误）。 */
function ActivityDetails({ activity, t }: { activity: ActivityDoc; t: TaskGraphT }): JSX.Element {
  switch (activity.kind) {
    case 'assistant-message':
      return (
        <div>
          <pre className="skyaxis-tg-panel-pre">{activity.text}</pre>
          {activity.reasoningText !== undefined ? (
            <>
              <h4>{t('panel.reasoning')}</h4>
              <pre className="skyaxis-tg-panel-pre">{activity.reasoningText}</pre>
            </>
          ) : null}
          {activity.provider !== undefined && activity.model !== undefined ? (
            <div className="skyaxis-tg-panel-row">
              {t('metrics.provider')}: {activity.provider} · {t('metrics.model')}: {activity.model}
            </div>
          ) : null}
          {activity.usage !== undefined ? (
            <div className="skyaxis-tg-panel-row">
              {t('panel.tokens')}: {activity.usage.inputTokens.toLocaleString()} →{' '}
              {activity.usage.outputTokens.toLocaleString()}
            </div>
          ) : null}
          {activity.interrupted === true ? (
            <div className="skyaxis-tg-panel-row">{t('panel.interrupted')}</div>
          ) : null}
        </div>
      )
    case 'tool-call':
      return (
        <div>
          <h4>{t('panel.tool.args')}</h4>
          <pre className="skyaxis-tg-panel-pre">{activity.argumentsRaw}</pre>
          {activity.result !== undefined ? (
            <>
              <h4>{t('panel.tool.result')}</h4>
              {activity.result.text !== '' ? (
                <pre className="skyaxis-tg-panel-pre">{activity.result.text}</pre>
              ) : null}
              {activity.result.isError ? (
                <div className="skyaxis-tg-panel-row skyaxis-tg-panel-error">
                  {t('panel.tool.error')}:{' '}
                  {activity.result.errorName !== undefined ? `${activity.result.errorName} ` : ''}
                  {activity.result.errorCode !== undefined ? `(${activity.result.errorCode}) ` : ''}
                  {activity.result.errorReason ?? ''}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      )
    case 'approval':
      return (
        <div>
          {activity.reason !== undefined ? (
            <>
              <h4>{t('panel.approval.reason')}</h4>
              <pre className="skyaxis-tg-panel-pre">{activity.reason}</pre>
            </>
          ) : null}
          <div className="skyaxis-tg-panel-row">
            {t('panel.approval.outcome')}:{' '}
            {activity.outcome ?? t('panel.approval.pending')}
            {activity.decidedTime !== undefined ? ` · ${timeOf(activity.decidedTime)}` : ''}
          </div>
        </div>
      )
  }
}

/** 明细面板（切片 B）：PanelModel 的唯一渲染面。 */
function TaskGraphPanel({
  model,
  t,
  navigate,
  onClose,
}: {
  model: PanelModel
  t: TaskGraphT
  navigate: (id: string) => void
  onClose: () => void
}): JSX.Element {
  return (
    <div className="skyaxis-tg-defpanel skyaxis-tg-panel" role="dialog" aria-label={model.label}>
      <header className="skyaxis-tg-defpanel-head">
        <strong>{model.label}</strong>
        <button type="button" onClick={onClose}>
          {t('view.close')}
        </button>
      </header>

      {model.kind === 'root' ? (
        <div>
          {model.status !== undefined ? (
            <div className="skyaxis-tg-panel-row">{statusLabel(model.status, t)}</div>
          ) : null}
          {model.metrics !== undefined ? <MetricsRows metrics={model.metrics} t={t} /> : null}
          {model.hasMore ? (
            <div className="skyaxis-tg-panel-row">{t('view.earlierEvents')}</div>
          ) : null}
        </div>
      ) : null}

      {model.kind === 'turn' ? (
        <div>
          {model.durationMs !== undefined ? (
            <div className="skyaxis-tg-panel-row">
              {t('panel.duration')}: {formatDuration(model.durationMs)}
            </div>
          ) : null}
          <h4>{t('panel.turnMessages')}</h4>
          {model.messages.map((m, i) => (
            <pre key={i} className="skyaxis-tg-panel-pre">
              {m.text}
            </pre>
          ))}
          {model.endReason !== undefined ? (
            <>
              <h4>{t('panel.endReason')}</h4>
              <div className="skyaxis-tg-panel-row">
                {model.endReason.kind}
                {model.endReason.message !== undefined ? ` — ${model.endReason.message}` : ''}
                {model.endReason.code !== undefined ? ` (${model.endReason.code})` : ''}
              </div>
            </>
          ) : null}
          <h4>{t('panel.turnActivities')}</h4>
          {model.activities.length === 0 ? (
            <div className="skyaxis-tg-panel-row">{t('panel.noActivities')}</div>
          ) : (
            model.activities.map((line) => (
              <details key={line.key} className="skyaxis-tg-act">
                <summary>
                  <span className="skyaxis-tg-act-kind">
                    {line.kind === 'tool-call'
                      ? t('panel.activity.tool')
                      : line.kind === 'approval'
                        ? t('panel.activity.approval')
                        : t('panel.activity.assistant')}
                  </span>
                  <span className="skyaxis-tg-act-title">{line.title}</span>
                  {line.durationMs !== undefined ? (
                    <span className="skyaxis-tg-act-meta">{formatDuration(line.durationMs)}</span>
                  ) : null}
                  {line.isError === true ? (
                    <span className="skyaxis-tg-act-meta skyaxis-tg-panel-error">
                      {t('status.failed')}
                    </span>
                  ) : null}
                  {line.pending === true ? (
                    <span className="skyaxis-tg-act-meta skyaxis-tg-panel-warn">
                      {t('panel.approval.pending')}
                    </span>
                  ) : null}
                </summary>
                <ActivityDetails activity={line.activity} t={t} />
              </details>
            ))
          )}
        </div>
      ) : null}

      {model.kind === 'task' ? (
        <div>
          <pre className="skyaxis-tg-panel-pre">{model.content}</pre>
          <h4>{t('panel.history')}</h4>
          {model.history.map((r, i) => (
            <div key={i} className="skyaxis-tg-panel-row">
              turn {r.turn} · {timeOf(r.time)} · {todoStatusLabel(r.status, t)}
            </div>
          ))}
        </div>
      ) : null}

      {model.kind === 'subagent' ? (
        <div>
          {model.status !== undefined ? (
            <div className="skyaxis-tg-panel-row">{statusLabel(model.status, t)}</div>
          ) : null}
          {model.metrics !== undefined ? <MetricsRows metrics={model.metrics} t={t} /> : null}
          {model.spawn !== undefined ? (
            <>
              <h4>{t('panel.spawn')}</h4>
              {model.spawn.description !== undefined ? (
                <div className="skyaxis-tg-panel-row">{model.spawn.description}</div>
              ) : null}
              {model.spawn.promptText !== undefined ? (
                <>
                  <div className="skyaxis-tg-panel-row">{t('panel.spawnPrompt')}:</div>
                  <pre className="skyaxis-tg-panel-pre">{model.spawn.promptText}</pre>
                </>
              ) : null}
            </>
          ) : null}
          {model.navigable && model.navigationId !== undefined ? (
            <button
              type="button"
              className="skyaxis-tg-panel-open"
              onClick={() => navigate(model.navigationId!)}
            >
              {t('panel.openSession')}
            </button>
          ) : null}
        </div>
      ) : null}

      {model.kind === 'workflow' ? (
        <div>
          {model.status !== undefined ? (
            <div className="skyaxis-tg-panel-row">{statusLabel(model.status, t)}</div>
          ) : null}
          {model.durationMs !== undefined ? (
            <div className="skyaxis-tg-panel-row">
              {t('panel.duration')}: {formatDuration(model.durationMs)}
            </div>
          ) : null}
          {model.definition !== undefined ? (
            <>
              {model.definition.meta.description !== undefined ? (
                <p className="skyaxis-tg-defpanel-desc">{model.definition.meta.description}</p>
              ) : null}
              {model.definition.meta.phases !== undefined && model.definition.meta.phases.length > 0 ? (
                <ul className="skyaxis-tg-defpanel-phases">
                  {model.definition.meta.phases.map((p) => (
                    <li key={p.title}>
                      {p.title}
                      {p.detail !== undefined ? ` — ${p.detail}` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
              <h4>{t('view.definitionScript')}</h4>
              <pre className="skyaxis-tg-defpanel-script">{model.definition.script}</pre>
            </>
          ) : null}
        </div>
      ) : null}

      {model.kind === 'node' ? (
        <div>
          {model.status !== undefined ? (
            <div className="skyaxis-tg-panel-row">{statusLabel(model.status, t)}</div>
          ) : null}
          {model.metrics !== undefined ? <MetricsRows metrics={model.metrics} t={t} /> : null}
          {model.navigable === true && model.navigationId !== undefined ? (
            <button
              type="button"
              className="skyaxis-tg-panel-open"
              onClick={() => navigate(model.navigationId!)}
            >
              {t('panel.openSession')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
