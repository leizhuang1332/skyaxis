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
 * v0.4 切片 A（ADR 0036）：任务链侧改为 facts → document/fold →
 * projections/task-chain（退役 inferTaskGraph）；subagents/workflows 仍是
 * 并列 builder（B/D 切片收编进文档层）。
 *
 * connector 跟随 `apply` 的 disposer 一起清理；current 切换时先卸旧 listener
 * 再装新的，避免引用旧 binding。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {
  ISessions,
  SessionEventLikeEntry,
  SessionEventWindow,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { TaskStatus } from './types.js'
import type { TaskGraphStore } from './store.js'
import { foldSessionDocument } from './document/fold.js'
import type { TaskGraphFacts } from './document/types.js'
import { projectTaskChain } from './projections/task-chain.js'
import { buildSubagentGraph, subagentSignature, summaryStatus } from './subagents.js'
import { buildWorkflowGraph, foldWorkflowRuns, workflowSignature, attachWorkflowDefinitions, extractWorkflowDefinitions } from './workflows.js'

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
  /** workflow run 节点 name 缺失时的兜底（i18n）。 */
  workflowRunFallbackLabel?: () => string
  /** workflow member 节点 label 缺失时的兜底（i18n）。 */
  workflowMemberFallbackLabel?: () => string
  /** Waiting-input face (P2b) — pending approval/question sessionIds. */
  waiting?: import('../waiting-tracker.js').WaitingFace
}

/**
 * 0.2.1-rc.3（0033）：SessionListState 退役 subagentsByParent / current 两字段。
 * 目录改读每父会话的投影值（宿主 ui-workspace tree.ts 同款读法：
 * projectionsBySession[parent].values.subagentCatalog）；防御性最小形状读，
 * 不 import dsh-subagent 类型（subagents.ts CatalogLike 先例）。
 */
export const subagentsByParentOf = (
  snapshot: ReturnType<ISessions['list']['getSnapshot']>,
): Record<SessionId, { entries?: readonly { id: SessionId; label?: string }[] }> => {
  const map: Record<SessionId, { entries?: readonly { id: SessionId; label?: string }[] }> = {}
  for (const [parent, projection] of Object.entries(snapshot.projectionsBySession)) {
    const values = projection.values as Readonly<Record<string, readonly { id: SessionId; label?: string }[] | undefined>>
    if (values.subagentCatalog !== undefined && values.subagentCatalog.length > 0) {
      map[parent as SessionId] = { entries: values.subagentCatalog }
    }
  }
  return map
}
/**
 * 0.2.1-rc.3（0033）：主视图正在显示的会话 = retainedBy.mainView 计数为正的
 * summary（宿主 DocumentTitle 的官方判据，替代退役的 list state current。mainView 键由宿主 UI 包对 SessionReferenceSourceMap 声明合并贡献，skyaxis 类型视野不可见——防御索引读）。
 */
export const mainViewSessionIdOf = (
  snapshot: ReturnType<ISessions['list']['getSnapshot']>,
): SessionId | undefined =>
  Object.values(snapshot.byId).find((s) => ((s.retainedBy as Readonly<Record<string, number | undefined>>).mainView ?? 0) > 0)?.id

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

  /** 事件窗口里的持久事件（transient 排除）——infer 与 workflow 折叠共用。 */
  const durableEvents = (window: SessionEventWindow): readonly SessionEvent[] =>
    window.entries
      .filter((e): e is Extract<SessionEventLikeEntry, { type: 'event' }> => e.type === 'event')
      .map((e) => e.event)

  /** root 摘要 + 子树签名 + workflow 签名 + waiting 段（同 current 时判断是否需要重推）。 */
  const waitingSet = (): ReadonlySet<SessionId> => (options.waiting?.getSnapshot() ?? new Set<string>()) as ReadonlySet<SessionId>
  const signatureFor = (sessionId: SessionId, window: SessionEventWindow): string => {
    const snapshot = sessions.list.getSnapshot()
    const summary = snapshot.byId[sessionId]
    const label = summary?.displayTitle || sessionLabel(sessionId)
    const waiting = waitingSet()
    const rootStatus: TaskStatus = summary ? summaryStatus(summary, waiting.has(sessionId)) : 'running'
    return (
      `${label}|${rootStatus}|${subagentSignature(sessionId, snapshot.byId)}`
      + `|${workflowSignature(foldWorkflowRuns(durableEvents(window)))}`
      // P2b 复合 waiting 段：一处覆盖 root/subagent/member 的 waiting 翻转——
      // subagentSignature 加 :w: 位覆盖不到 workflow member，三签名各加位成本翻倍。
      + `|w:${[...waiting].sort().join(',')}`
    )
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
      const rootStatus: TaskStatus = summary ? summaryStatus(summary, waitingSet().has(sessionId)) : 'running'
      // P2b：root 的"最近一次请求"路由事实（null → undefined，不挂字段）。
      const rootMetrics = summary?.projectionValues?.skyaxisAgentMetrics ?? undefined
      lastAppliedSignature = signatureFor(sessionId, window)

      // v0.4 切片 A（ADR 0036）：facts → 文档 → 任务链投影（退役 inferTaskGraph）。
      // B/D 切片再把 activities / delegations / workflows 收编进文档层。
      const facts: TaskGraphFacts = {
        sessionId,
        events: durableEvents(window),
        hasMore: window.hasMore,
        label,
        rootStatus,
        ...(rootMetrics === undefined ? {} : { rootMetrics }),
      }
      const taskGraph = projectTaskChain(foldSessionDocument(facts))
      // P2d：workflow 图（第三命名空间，零新增订阅——同一事件窗口折叠）。
      // P3：先 attach 定义（tool/call 提取 + 时序/name 匹配）再 build。
      const workflowRuns = attachWorkflowDefinitions(
        foldWorkflowRuns(durableEvents(window)),
        extractWorkflowDefinitions(durableEvents(window)),
      )
      const workflowGraph = buildWorkflowGraph({
        rootId: sessionId,
        runs: workflowRuns,
        byId: snapshot.byId,
        ids: snapshot.ids,
        fallbackLabels: {
          run: options.workflowRunFallbackLabel?.() ?? 'Workflow',
          member: options.workflowMemberFallbackLabel?.() ?? 'Workflow member',
        },
        waiting: waitingSet(),
      })
      // P2d 修正（dist/03 §6 grouped 规则）：workflow 成员的 childId → member
      // 节点 id；subagent 图据此跳过已占用会话、后代再父化到 member 节点。
      const grouped = new Map<SessionId, string>()
      for (const run of workflowRuns.values()) {
        for (const member of run.members.values()) {
          grouped.set(member.childId, `workflow-member:${run.runId}:${member.seq}`)
        }
      }
      const subagentGraph = buildSubagentGraph({
        rootId: sessionId,
        byId: snapshot.byId,
        subagentsByParent: subagentsByParentOf(snapshot),
        ids: snapshot.ids,
        fallbackLabel: options.subagentFallbackLabel?.() ?? 'Subagent',
        grouped,
        waiting: waitingSet(),
      })
      store.set({
        sessionId,
        nodes: [...taskGraph.nodes, ...subagentGraph.nodes, ...workflowGraph.nodes],
        edges: [...taskGraph.edges, ...subagentGraph.edges, ...workflowGraph.edges],
        loading: false,
        hasMore: window.hasMore,
      })
    } catch (error) {
      console.error('[skyaxis task-graph] graph build failed:', error)
      store.set({ sessionId, nodes: [], edges: [], loading: false, hasMore: window.hasMore })
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
          const window = currentBinding.eventSource.getSnapshot()
          if (signatureFor(nextId, window) !== lastAppliedSignature) {
            applyWindow(nextId, window)
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
        hasMore: false,
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
        hasMore: false,
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
  handleCurrent(mainViewSessionIdOf(sessions.list.getSnapshot()))
  const listUnsub = sessions.list.subscribe(() => {
    handleCurrent(mainViewSessionIdOf(sessions.list.getSnapshot()))
  })
  // P2b：waiting 面变化 → 同 current 重走签名比对（w 段变化触发重推）。零轮询。
  const waitingUnsub = options.waiting?.subscribe(() => {
    const nextId = mainViewSessionIdOf(sessions.list.getSnapshot())
    if (nextId !== undefined) handleCurrent(nextId)
  })

  return () => {
    waitingUnsub?.()
    listUnsub()
    teardownBinding()
    currentSessionId = undefined
  }
}

function sessionLabel(id: SessionId): string {
  // branded string 取前 8 位；UI 上有具体 session title 时再换 projection。
  return `Session ${String(id).slice(0, 8)}`
}
