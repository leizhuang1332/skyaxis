import type { Node, Edge } from '@xyflow/react'

/**
 * Task node status — ADR §5.2 最小集合。
 *
 *   pending  未开始
 *   running  进行中
 *   done     完成
 *   failed   失败
 *   waiting  等待用户输入（如 approval）
 */
export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'waiting'

/**
 * Task graph 节点类型 — v0.3 修订。
 *
 *   root         session 根（永远 1 个）
 *   user-prompt  用户输入的 user/message（kind === 'user'），DAG 入口节点
 *   task         来自 todo/write 事件的 TodoItem，核心业务节点
 *   subagent     subagent session 占位（v0.3 不生成，留待后续 ADR）
 *   approval     approval 节点占位（v0.3 不生成）
 *
 * v0.2 时代的 `'step'` 已删除——不再以 assistant message 为粒度建图。
 */
export type TaskNodeType = 'root' | 'user-prompt' | 'task' | 'subagent' | 'approval'

/**
 * Task graph 节点。MVP 阶段 `data` 仅带 label + 可选 status；
 * v0.2 之后可扩展为 tool-call 子结构 / 时间戳 / 失败原因等。
 */
export type TaskNode = Node<{
  label: string
  status?: TaskStatus
}>

/** Task graph 边；透传至 React Flow 的 `Edge`。 */
export type TaskEdge = Edge
