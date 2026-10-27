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
 * workflow 落地，C 切片起 activity / turns-aggregate 落地。
 *
 *   root             session 根（永远 1 个）
 *   user-prompt      用户输入的 user/message（kind === 'user'），DAG 入口节点
 *                    ——v0.4 切片 A 起无 status 位（用户输入不是任务）
 *   task             来自 todo/write 事件的 TodoItem，核心业务节点
 *                    ——v0.4 切片 A 起全局身份：`todo-{contentHash}`（无 turn 段）
 *   activity         会话内活动节点（v0.4 切片 C：assistant 消息 / 工具调用 / 审批
 *                    ——task-chain 恒发全量，view-policy 按详略三档过滤）
 *   subagent         subagent session 节点（P2a：血缘来自 sessions.list 投影）
 *   workflow         workflow run 记录（P2d：tool-workflow/run-start|run-end）
 *   workflow-phase   run 内的展示分组（P2d：agent-start.phase 折叠）
 *   workflow-member  run 的成员子会话（P2d：agent-start|agent-end）
 *   turns-aggregate  已完成轮次的折叠聚合节点（v0.4 切片 C：view-policy 产出，
 *                    error/aborted 轮不折——卡点永远可见）
 *   approval         approval 节点占位（approval 事实经 activity 节点呈现，此占位保留词表兼容）
 *
 * v0.2 时代的 `'step'` 已删除——不再以 assistant message 为粒度建图（C 切片的
 * activity 节点以活动事实形态重新引入 assistant/tool/approval）。
 */
export type TaskNodeType =
  | 'root'
  | 'user-prompt'
  | 'task'
  | 'activity'
  | 'subagent'
  | 'workflow'
  | 'workflow-phase'
  | 'workflow-member'
  | 'turns-aggregate'
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
   * wall-clock 时长（v0.4 切片 B）：turn 时长（user-prompt 节点，TurnDoc
   * start/end 派生）或 workflow run 时长（run 节点，fold 事件 time 派生）——
   * fact 级（research 0033 §五）。tooltip 与明细面板呈现；画布 label 不塞。
   */
  durationMs?: number
  /**
   * workflow run 的调用定义（P3 定义预览）：tool/call arguments 折叠，
   * attachWorkflowDefinitions 匹配注入；无匹配则缺省（点击不响应）。
   */
  definition?: WorkflowDefinition
  /**
   * activity 节点回查文档活动的 key（`act:{seq}`，v0.4 切片 C）——
   * panel-model 据此反查 ActivityDoc，节点本体保持轻。
   */
  activityKey?: string
  /**
   * activity 节点的类型角标（切片 C 渲染注册表用）：assistant / tool / approval。
   */
  activityKind?: 'assistant-message' | 'tool-call' | 'approval'
  /**
   * 折叠聚合徽标（v0.4 切片 C，ADR 0001 §七.1 欠账）：turns-aggregate 节点带
   * 轮次聚合，subagent 节点折叠子树后带后代状态计数（X running / Y done / Z failed）。
   */
  aggregate?: AggregateBadge
}>

/** 折叠聚合徽标（判别联合）。 */
export type AggregateBadge =
  | {
      kind: 'turns'
      /** 折叠进的已完成轮数。 */
      count: number
      /** 各轮 (end−start) 之和（有缺省轮不计）。 */
      totalDurationMs?: number
    }
  | {
      kind: 'subtree'
      /** 折叠掉的后代节点数。 */
      count: number
      /** 后代节点状态计数（键为 TaskStatus）。 */
      statuses: Partial<Record<TaskStatus, number>>
    }

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

/**
 * 边的证据标注（v0.4 切片 B，ADR 0036 §2.2）：`fact` = wire 上有的结构
 * （callId/parentId/agent-start childId 等配对），`inferred` = 我们的启发式
 * （顺序、邻接）。渲染面区分（推断=虚线），把「顺序 ≠ 依赖」从注释搬到
 * 用户眼前。缺省视为 fact（历史边族全部是结构事实；唯 sequence 标 inferred）。
 */
export type TaskEdgeEvidence = 'fact' | 'inferred'

/** Task graph 边；透传至 React Flow 的 `Edge`，语义由 `data.kind` 携带。 */
export type TaskEdge = Edge<{ kind: TaskEdgeKind; evidence?: TaskEdgeEvidence }>
