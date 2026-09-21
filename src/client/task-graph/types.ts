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
 * Task graph 节点类型 — ADR §5.1 最小集合。
 *
 *   root      session 根
 *   step      Step（assistant message 或工具调用序列推断出的任务步骤）
 *   subagent  subagent session（特殊节点，承载子树）
 *   approval  approval 节点
 */
export type TaskNodeType = 'root' | 'step' | 'subagent' | 'approval'

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
