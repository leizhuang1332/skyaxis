/**
 * 文档层契约（v0.4 切片 A，ADR 0036）：facts 一体化输入 + SessionDocument。
 *
 * 五层管线里文档层是「发生了什么」的规范化事实集，投影层（projections/）
 * 才决定「怎么画」。内容与拓扑分离：节点只挂 ContentRef（轻），原文进
 * contents 索引（零拷贝引用事件本体），明细面按 ref 解引用。
 *
 * 切片 A 范围：turns / tasks / contents / hasMore / signature。activities
 * （assistant/工具/审批）、delegations、workflows 的文档化在 B/D 切片收编
 * （现 subagents.ts / workflows.ts 继续作为并列 builder）。
 */
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SkyaxisAgentMetrics } from '../../../agent-metrics.js'
import type { TaskStatus } from '../types.js'

/** `turn/end` 的 wire reason 全息类型（从事件联合里提取，不依赖命名导出）。 */
export type TurnEndReasonOf = Extract<SessionEvent, { type: 'turn/end' }>['data']['reason']

/**
 * connector → 文档层的一体化输入。此前三个 builder 各取所需切片
 * （events/byId/ids/...），A 起任务链侧收敛为单对象传递；subagents/
 * workflows 在 B/D 收编前仍直接吃 list 快照。
 */
export interface TaskGraphFacts {
  sessionId: SessionId
  /** durable 事件（transient 已剔除）；fold 内部按 seq 防御性排序。 */
  events: readonly SessionEvent[]
  /** 事件窗口前缀截断位（SessionEventWindow.hasMore，research 0033 §八）。 */
  hasMore: boolean
  /** root 节点 label（connector 解析：displayTitle → `Session xxx` 兜底）。 */
  label: string
  /** root 节点状态（summaryStatus + waiting 现有派生）。 */
  rootStatus: TaskStatus
  /** root 的「最近一次请求」路由事实（skyaxisAgentMetrics 投影）；缺省不挂。 */
  rootMetrics?: SkyaxisAgentMetrics
}

/**
 * todo/write 的 wire status（normalize 后的闭集；上游漂移兜底 pending——
 * 绝不误标 completed，诚实 > 漂亮，与退役的 infer.ts 同款防御）。
 */
export type TodoStatusOf = 'pending' | 'in_progress' | 'completed'

/** 一条 todo 修订：某个 todo/write 里该任务的出现事实。 */
export interface TaskRevision {
  /** 所在 todo/write 的 seq / time（事件 envelope）。 */
  seq: number
  time: number
  /** 环境回合归属（todo/write 无 turn 字段，ambient 计数，见 fold.ts）。 */
  turn: number
  status: TodoStatusOf
}

/** 全局身份的任务条目（key 锚定 content，跨 turn 复用，ADR 0036 §2.3）。 */
export interface TaskDocEntry {
  /** 全局 key：`hash` / `hash#N`（同一次 write 内第 N+1 次出现，见 identity.ts）。 */
  key: string
  /** content 原文（不截断——截断是投影层的事，B 的明细面要全文）。 */
  content: string
  /** 逐 write 修订史：whole-list 覆盖不再吞历史。 */
  history: TaskRevision[]
  /** 该 key 从最新列表消失的退役事实（seq = 致其退役的 write）；再次出现即复活（清位）。 */
  retired?: { seq: number }
}

/** turn 分组事实。 */
export interface TurnDoc {
  /** 环境回合号（turn/start 显式值或 user/message 自增值，见 fold.ts）。 */
  index: number
  /** 该 turn 内全部**人类** user/message 的 ContentRef（`ev:{seq}`，按 seq 序；
   *  插件注入不进——投影层取首条做节点 label，B 的明细面吃全量）。 */
  userPromptRefs: readonly string[]
  /** 该 turn 最后一次 todo/write 的 key 序（空 = 该 turn 无 write）。 */
  finalListKeys: readonly string[]
  /** turn 结束原因全息（七种 TurnEndReason 原文；现役代码只读过 error.kind 一个位）。 */
  endReason?: TurnEndReasonOf
  /** turn/start 与 turn/end 的 wall-clock（research 0033 §五：耗时事实 B 用）。 */
  startTime?: number
  endTime?: number
}

/**
 * 内容索引的引用形态：`ev:{seq}` —— 零拷贝指向 facts.events 里的本体事件。
 * B 切片在同 scheme 上扩（tool 参数解析、错误链等都是对事件本体的视图）。
 */
export type ContentRef = string

/** 会话文档：事件流的规范化事实集（纯函数 foldSessionDocument 的产物）。 */
export interface SessionDocument {
  sessionId: SessionId
  label: string
  rootStatus: TaskStatus
  rootMetrics?: SkyaxisAgentMetrics
  hasMore: boolean
  /** 按 index 升序。 */
  turns: readonly TurnDoc[]
  /** 全局 key → 条目（含退役者——历史在档，投影按 retired 过滤）。 */
  tasks: ReadonlyMap<string, TaskDocEntry>
  /** ContentRef → 事件本体（零拷贝引用）。 */
  contents: ReadonlyMap<ContentRef, SessionEvent>
  /**
   * 文档结构签名（确定性拼接：turns 骨架 + 任务存活集 + 末修订状态）。
   * 切片 A 仅奠基（connector 重推门控沿旧签名，避免行为漂移）；C 切片
   * 投影 memo（fold/filter 参数化）接入。
   */
  signature: string
}
