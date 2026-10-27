/**
 * Task-graph 内存快照存储。
 *
 * 数据流（v0.4 切片 A 起）：
 *   ctx.sessions.list / binding(id).eventSource  →  connector（组装 facts）
 *        → document/fold → projections/task-chain ⊕ subagents/workflows
 *        →  store.set(...)  →  view.tsx useSyncExternalStore 读取
 *
 * v0.1 demo 范围内只用一个 store 实例（按 plan 决策 1：不走 defineStore / store seat）；
 * 实例跟随 `registerTaskGraphView` 的 disposer 一起销毁。
 */
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { TaskNode, TaskEdge } from './types.js'

export interface TaskGraphState {
  /** 当前订阅的 session；undefined 表示尚无 selection（fallback 到 seed）。 */
  sessionId: SessionId | undefined
  /** 推断出的图节点；初始为空，事件窗口接通后填充。 */
  nodes: TaskNode[]
  /** 推断出的图边。 */
  edges: TaskEdge[]
  /**
   * True 当 current 已变但 binding 还没就绪（list.current 早于 scope mint）。
   * 此时 UI 显示"加载中"占位，避免空画布误导。
   */
  loading: boolean
  /**
   * 事件窗口前缀截断位（SessionEventWindow.hasMore，research 0033 §八）：
   * true = 更早历史未载入，视图顶部诚实标注（v0.4 切片 A）。
   */
  hasMore: boolean
}

const INITIAL_STATE: TaskGraphState = {
  sessionId: undefined,
  nodes: [],
  edges: [],
  loading: false,
  hasMore: false,
}

/**
 * 新建一个 task-graph 快照存储。
 *
 * 用 `flush: 'raf'`：connector 一次性收到 N 条事件时合并成一帧通知，避免 React
 * Flow 渲染抖动；首屏同步读取仍走 getSnapshot()。
 */
export function createTaskGraphStore() {
  return createSnapshotStore<TaskGraphState>(INITIAL_STATE, { flush: 'raf' })
}

export type TaskGraphStore = ReturnType<typeof createTaskGraphStore>
