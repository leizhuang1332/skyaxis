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
 *            每次通知 → inferTaskGraph(entries)
 *                        │
 *                        ▼
 *                     store.set(...)
 *
 * connector 跟随 `apply` 的 disposer 一起清理；current 切换时先卸旧 listener
 * 再装新的，避免引用旧 binding。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { ISessions, SessionEventWindow } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TaskGraphStore } from './store.js'
import { inferTaskGraph } from './infer.js'

export function startTaskGraphConnector(ctx: Context, store: TaskGraphStore): () => void {
  // dsh-session 和 dsh-api-session-controller 都声明了 Context.sessions（前者是
  // service-side SessionStore，后者是 client-side ISessions），TS 合并后 ctx.sessions
  // 是交叉类型，但运行时 host 提供的是 ISessions 实例。显式收窄以拿到 binding/list 方法。
  // 经过 unknown 中转：合并类型 SessionStore & ISessions 直接 as ISessions TS 会拒。
  const sessions = ctx.sessions as unknown as ISessions

  // 闭包持有：当前订阅的 session id / eventSource listener / 旧值。
  let currentSessionId: SessionId | undefined
  let eventUnsub: (() => void) | undefined

  const applyWindow = (sessionId: SessionId, window: SessionEventWindow): void => {
    const label = sessionLabel(sessionId)
    const { nodes, edges } = inferTaskGraph(window.entries, label)
    store.set({
      sessionId,
      nodes,
      edges,
      loading: false,
    })
  }

  const teardownBinding = (): void => {
    if (eventUnsub) {
      eventUnsub()
      eventUnsub = undefined
    }
  }

  const handleCurrent = (nextId: SessionId | undefined): void => {
    if (nextId === currentSessionId) return
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
