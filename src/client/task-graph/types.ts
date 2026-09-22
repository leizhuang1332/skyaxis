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
 * Task graph 节点类型 — v0.3 修订，P2a 起 subagent 落地。
 *
 *   root         session 根（永远 1 个）
 *   user-prompt  用户输入的 user/message（kind === 'user'），DAG 入口节点
 *   task         来自 todo/write 事件的 TodoItem，核心业务节点
 *   subagent     subagent session 节点（P2a：血缘来自 sessions.list 投影）
 *   approval     approval 节点占位（不生成，待后续）
 *
 * v0.2 时代的 `'step'` 已删除——不再以 assistant message 为粒度建图。
 */
export type TaskNodeType = 'root' | 'user-prompt' | 'task' | 'subagent' | 'approval'

/** Task graph 节点。`data` 携带渲染与导航所需的最小事实集。 */
export type TaskNode = Node<{
  label: string
  status?: TaskStatus
  /**
   * 导航诚实规则（dist/02 §2）：仅当目标 session 存在于 host 列表
   * （`SessionListState.ids`）时为 true——列表里没有的 session 不假装能打开。
   */
  navigable?: boolean
  /** 点击导航的目标 session id（仅 navigable 节点设置）。 */
  navigationId?: string
}>

/**
 * Task graph 边的语义类型。
 *
 *   sequence   推断的执行顺序（v0.3 起）——**不是**声明式依赖；与参考插件
 *              task-dag-viewer 的诚实边界对齐：只有 `dependency` 类的边才
 *              表达依赖关系，顺序边刻意不承担那个语义。
 *   delegation subagent 血缘边（P2a 起）：父 session 节点 → 子 session 节点，
 *              来自 parentId 结构关系（lineageDepths 已拒环/孤儿，构造上无环）。
 *
 * P2c 引入 `dependency` / `team` 等 kind 时从这里扩展。
 */
export type TaskEdgeKind = 'sequence' | 'delegation'

/** Task graph 边；透传至 React Flow 的 `Edge`，语义由 `data.kind` 携带。 */
export type TaskEdge = Edge<{ kind: TaskEdgeKind }>
