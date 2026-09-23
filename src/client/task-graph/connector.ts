/**
 * Task-graph ↔ Session Controller 数据桥接。
 *
 * 桥接模型（research/0002 §3.2 出路 A）：
 *   ctx.sessions.list  ──┐
 *                        │  subscribe
 *                        ▼
 *                list.current 变化
 *                        │
 *                        ▼
 *            ctx.sessions.binding(id)
 *                        │
 *                        ▼
 *              binding.eventSource
 *                        │  subscribe
 *                        ▼
 *            每次通知 → inferTaskGraph(entries) ⊕ buildSubagentGraph(list)
 *                        │
 *                        ▼
 *                     store.set(...)
 *
 * P2a：同一份 list 快照同时喂两个纯函数——事件窗口推断任务图，血缘投影
 * 构建 subagent 子树，connector 合并（id 命名空间不相交：root/user-N/todo-*
 * vs subagent:*）。同 current 但 root 摘要或子树签名变化时用缓存的 binding
 * 快照重推。
 *
 * connector 跟随 `apply` 的 disposer 一起清理；current 切换时先卸旧 listener
 * 再装新的，避免引用旧 binding。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ISessions, SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TaskStatus } from './types.js'
import type { TaskGraphStore } from './store.js'
import { inferTaskGraph } from './infer.js'
import { buildSubagentGraph, subagentSignature, summaryStatus } from './subagents.js'

/**
 * dsh-session 和 dsh-api-session-controller 都声明了 Context.sessions（前者是
 * service-side SessionStore，后者是 client-side ISessions），TS 合并后 ctx.sessions
 * 是交叉类型，但运行时 host 提供的是 ISessions 实例。显式收窄以拿到 binding/list
 * 方法。经过 unknown 中转：合并类型 SessionStore & ISessions 直接 as ISessions TS 会拒。
 * register.tsx 的导航回调也复用这一个收窄定义。
 */
export function sessionsFace(ctx: Context): ISessions {
  return ctx.sessions as unknown as ISessions
}

export interface TaskGraphConnectorOptions {
  /** subagent 节点 label 三级回退的最终兜底（i18n 文案，取值时机在每次 apply）。 */
  subagentFallbackLabel?: () => string
}

export function startTaskGraphConnector(
  ctx: Context,
  store: TaskGraphStore,
  options: TaskGraphConnectorOptions = {},
): () => void {
  const sessions = sessionsFace(ctx)

  // 闭包持有：当前订阅的 session id / eventSource listener / binding 缓存 /
  // 最近一次应用的变更签名（root 摘要 + subagent 子树）。
  let currentSessionId: SessionId | undefined
  let currentBinding: NonNullable<ReturnType<ISessions['binding']>> | undefined
  let eventUnsub: (() => void) | undefined
  let lastAppliedSignature: string | undefined

  /** root 摘要 + 子树签名（同 current 时判断是否需要重推）。 */
  const signatureFor = (sessionId: SessionId): string => {
    const snapshot = sessions.list.getSnapshot()
    const summary = snapshot.byId[sessionId]
    const label = summary?.displayTitle || sessionLabel(sessionId)
    const rootStatus: TaskStatus = summary ? summaryStatus(summary) : 'running'
    return `${label}|${rootStatus}|${subagentSignature(sessionId, snapshot.byId)}`
  }

  const applyWindow = (sessionId: SessionId, window: SessionEventWindow): void => {
    // 保险（dist/01 原则 4）：图构建异常降级为空画布 + Console 现场，
    // 绝不让推断层缺陷沿 apply 链波及宿主。lastAppliedSignature 不更新，
    // 后续 list 通知会自然重试。
    try {
      // P1 诚实性：root label 用 SessionSummary.displayTitle（0003 §二钉死的
      // 路径），占位符只在 byId 行缺失时兜底；root 状态从 running/completed
      // 如实映射（TaskStatus 闭集内）。
      const snapshot = sessions.list.getSnapshot()
      const summary = snapshot.byId[sessionId]
      const label = summary?.displayTitle || sessionLabel(sessionId)
      const rootStatus: TaskStatus = summary ? summaryStatus(summary) : 'running'
      // P2b：root 的"最近一次请求"路由事实（null → undefined，不挂字段）。
      const rootMetrics = summary?.projectionValues?.skyaxisAgentMetrics ?? undefined
      lastAppliedSignature = `${label}|${rootStatus}|${subagentSignature(sessionId, snapshot.byId)}`

      const taskGraph = inferTaskGraph(window.entries, label, rootStatus, rootMetrics)
      const subagentGraph = buildSubagentGraph({
        rootId: sessionId,
        byId: snapshot.byId,
        subagentsByParent: snapshot.subagentsByParent,
        ids: snapshot.ids,
        fallbackLabel: options.subagentFallbackLabel?.() ?? 'Subagent',
      })
      store.set({
        sessionId,
        nodes: [...taskGraph.nodes, ...subagentGraph.nodes],
        edges: [...taskGraph.edges, ...subagentGraph.edges],
        loading: false,
      })
    } catch (error) {
      console.error('[skyaxis task-graph] graph build failed:', error)
      store.set({ sessionId, nodes: [], edges: [], loading: false })
    }
  }

  const teardownBinding = (): void => {
    if (eventUnsub) {
      eventUnsub()
      eventUnsub = undefined
    }
    currentBinding = undefined
    lastAppliedSignature = undefined
  }

  const handleCurrent = (nextId: SessionId | undefined): void => {
    if (nextId === currentSessionId) {
      // 同 session：root 摘要（P1）或 subagent 子树签名（P2a）变化 →
      // 用缓存的 binding 快照重推。签名计算本身也兜底——异常时跳过本次
      // 通知（applyWindow 内部已有自己的 catch）。
      if (nextId && currentBinding && lastAppliedSignature !== undefined) {
        try {
          if (signatureFor(nextId) !== lastAppliedSignature) {
            applyWindow(nextId, currentBinding.eventSource.getSnapshot())
          }
        } catch (error) {
          console.error('[skyaxis task-graph] signature check failed:', error)
        }
      }
      return
    }
    currentSessionId = nextId
    teardownBinding()

    if (!nextId) {
      store.set({
        sessionId: undefined,
        nodes: [],
        edges: [],
        loading: false,
      })
      return
    }

    const binding = sessions.binding(nextId)
    if (!binding) {
      // current 已变但 binding 尚未 mint（list → scope mint 之间的一帧）；
      // UI 进入"加载中"占位，等下一次 list 通知时再尝试。
      store.set({
        sessionId: nextId,
        nodes: [],
        edges: [],
        loading: true,
      })
      return
    }

    currentBinding = binding
    applyWindow(nextId, binding.eventSource.getSnapshot())
    eventUnsub = binding.eventSource.subscribe(() => {
      applyWindow(nextId, binding.eventSource.getSnapshot())
    })
  }

  // 初始读一次 + 订阅后续 list 变化。
  handleCurrent(sessions.list.getSnapshot().current)
  const listUnsub = sessions.list.subscribe(() => {
    handleCurrent(sessions.list.getSnapshot().current)
  })

  return () => {
    listUnsub()
    teardownBinding()
    currentSessionId = undefined
  }
}

function sessionLabel(id: SessionId): string {
  // branded string 取前 8 位；UI 上有具体 session title 时再换 projection。
  return `Session ${String(id).slice(0, 8)}`
}
