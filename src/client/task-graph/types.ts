import type { Node, Edge } from '@xyflow/react'
import type { SkyaxisAgentMetrics } from '../../agent-metrics.js'
import type { WorkflowDefinition } from './workflows.js'

/**
 * Task node status — ADR §5.2 最小集合，P2d 起扩 cancelled。
 *
 *   pending    未开始
 *   running    进行中
 *   done       完成
 *   failed     失败
 *   cancelled  被取消（P2d：workflow run/member 的 wire 事实，不映射成 failed）
 *
 * 'waiting' 自 P2b 回引：生产者是 waterfall 待决追踪（uiSession.pendingInteractions
 * 只读订阅——approval/user-questions 待决的 sessionId 集，经 connector 叠加），
 * 文档折叠不产出它；待决压过 running（更精确事实，research 0007 §1.1+§1.2）。
 */
export type TaskStatus = 'pending' | 'running' | 'done' | 'failed' | 'cancelled' | 'waiting'

/**
 * Task graph 节点类型 — v0.4 修订（ADR 0036），P2a 起 subagent 落地，P2d 起
 * workflow 落地。
 *
 *   root             session 根（永远 1 个）
 *   user-prompt      用户输入的 user/message（kind === 'user'），DAG 入口节点
 *                    ——v0.4 切片 A 起无 status 位（用户输入不是任务）
 *   task             来自 todo/write 事件的 TodoItem，核心业务节点
 *                    ——v0.4 切片 A 起全局身份：`todo-{contentHash}`（无 turn 段）
 *   subagent         subagent session 节点（P2a：血缘来自 sessions.list 投影）
 *   workflow         workflow run 记录（P2d：tool-workflow/run-start|run-end）
 *   workflow-phase   run 内的展示分组（P2d：agent-start.phase 折叠）
 *   workflow-member  run 的成员子会话（P2d：agent-start|agent-end）
 *   approval         approval 节点占位（不生成，待后续）
 *
 * v0.2 时代的 `'step'` 已删除——不再以 assistant message 为粒度建图（B 切片的
 * activity 节点会以更丰富的形态重新引入 assistant/tool 事实）。
 */
export type TaskNodeType =
  | 'root'
  | 'user-prompt'
  | 'task'
  | 'subagent'
  | 'workflow'
  | 'workflow-phase'
  | 'workflow-member'
  | 'approval'

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
  /**
   * "最近一次请求"的模型路由事实（P2b）：来自 skyaxisAgentMetrics 投影
   * （request/header 折叠），经 projectionValues 推送，零客户端订阅。
   * undefined = 尚无请求事实。
   */
  metrics?: SkyaxisAgentMetrics
  /**
   * workflow run 的调用定义（P3 定义预览）：tool/call arguments 折叠，
   * attachWorkflowDefinitions 匹配注入；无匹配则缺省（点击不响应）。
   */
  definition?: WorkflowDefinition
}>

/**
 * Task graph 边的语义类型。
 *
 *   sequence   推断的执行顺序（v0.3 起）——**不是**声明式依赖；与参考插件
 *              task-dag-viewer 的诚实边界对齐：只有 `dependency` 类的边才
 *              表达依赖关系，顺序边刻意不承担那个语义。
 *   delegation subagent 血缘边（P2a 起）：父 session 节点 → 子 session 节点，
 *              来自 parentId 结构关系（lineageDepths 已拒环/孤儿，构造上无环）。
 *   workflow   workflow 归属边（P2d 起）：root → run、phase/run → member。
 *              展示归属，不是脚本控制流（dist/03 §5 诚实边界）。
 *   phase      run → phase 分组边（P2d 起），同为展示分组。
 *
 * P2c 引入 `dependency` / `team` 等 kind 时从这里扩展。
 */
export type TaskEdgeKind = 'sequence' | 'delegation' | 'workflow' | 'phase'

/** Task graph 边；透传至 React Flow 的 `Edge`，语义由 `data.kind` 携带。 */
export type TaskEdge = Edge<{ kind: TaskEdgeKind }>
