/**
 * 文档层契约（v0.4 切片 A，ADR 0036）：facts 一体化输入 + SessionDocument。
 *
 * 五层管线里文档层是「发生了什么」的规范化事实集，投影层（projections/）
 * 才决定「怎么画」。内容与拓扑分离：节点只挂 ContentRef（轻），原文进
 * contents 索引（零拷贝引用事件本体），明细面按 ref 解引用。
 *
 * 切片 A 范围：turns / tasks / contents / hasMore / signature。切片 B 增：
 * activities（assistant 消息 / 工具调用配对 / 审批配对 / spawn 事实）。
 * delegations、workflows 的文档化在 D 切片收编（现 subagents.ts /
 * workflows.ts 继续作为并列 builder）。
 */
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SkyaxisAgentMetrics } from '../../../agent-metrics.js'
import type { TaskStatus } from '../types.js'

/**
 * 会话内「工作」事件的 kind（v0.4 切片 B，ADR 0036 §2.3）。todo 任务不在其列
 * （tasks 表）；subagent-spawn 不是独立 kind——它是 tool-call 活动上的
 * `spawn` 事实位（fact 级解析，research 0033 §六）。
 */
export type ActivityKind = 'assistant-message' | 'tool-call' | 'approval'

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
  /**
   * 该 turn 的活动 key 序（`act:{seq}`，切片 B）——assistant 消息 / 工具调用 /
   * 审批。turn 面板（panel-model 的 turn 模型）据此聚合本轮工作清单。
   */
  activityKeys: readonly string[]
  /** turn 结束原因全息（七种 TurnEndReason 原文；现役代码只读过 error.kind 一个位）。 */
  endReason?: TurnEndReasonOf
  /** turn/start 与 turn/end 的 wall-clock（research 0033 §五：耗时事实 B 用）。 */
  startTime?: number
  endTime?: number
}

/** tool-call 活动的结果事实（callId 配对的 `tool/result`，fold 预提取）。 */
export interface ToolResultFacts {
  /** 是否失败（ToolResultMessage.isError === true）。 */
  isError: boolean
  /** 失败身份三件套（wire `error` 字段，仅 isError 时在场）——reason 是人类可读原文。 */
  errorName?: string
  errorCode?: string
  errorReason?: string
  /** 结果 content 的 text blocks 连接（面板正文）。 */
  text: string
  /** result.time − call.time（fact 级派生，research 0033 §五）。 */
  durationMs: number
  /** 结果事件的 ContentRef（零拷贝）。 */
  ref: ContentRef
}

/** subagent 派生事实（fact 级解析，research 0033 §六三级降级链的第一级）。 */
export interface SpawnFacts {
  /** 派生工具结果文本字面包含的 childId（`started subagent <id>`）。 */
  childId: SessionId
  /** 派生 arguments 的 description（防御解析，坏 JSON 缺省）。 */
  description?: string
  /** 派生 arguments 的 prompt 全文（防御解析，坏 JSON 缺省）。 */
  promptText?: string
}

/** assistant 消息活动（`assistant/message`）。 */
export interface AssistantMessageActivity {
  key: string
  kind: 'assistant-message'
  /** wire 显式 turn/step（fact——不像 todo 依赖环境计数）。 */
  turn: number
  step: number
  ref: ContentRef
  time: number
  /** text blocks 连接的全文。 */
  text: string
  /** reasoning blocks 连接（在场才挂）。 */
  reasoningText?: string
  /** 逐消息 provider/model（dsh-llm source——比会话级 metrics 投影更细）。 */
  provider?: string
  model?: string
  /** 逐 step token 记账（wire usage，在场才挂）。 */
  usage?: { inputTokens: number; outputTokens: number }
  /** 中断前缀标记（wire interrupted）。 */
  interrupted?: true
}

/** 工具调用活动（`tool/call` ⊕ callId 配对的 `tool/result`）。 */
export interface ToolCallActivity {
  key: string
  kind: 'tool-call'
  turn: number
  step: number
  ref: ContentRef
  time: number
  callId: string
  name: string
  /** 模型原文 JSON 字符串（未解析；spawn 的 description/prompt 防御解析另行提取）。 */
  argumentsRaw: string
  /** 配对结果（孤儿/未决 = 缺省——诚实，不臆造）。 */
  result?: ToolResultFacts
  /** 派生事实（result 文本 + catalog 交叉验证双过关才挂）。 */
  spawn?: SpawnFacts
}

/** 审批活动（`approval/asked` ⊕ id 配对的 `approval/decided`）。 */
export interface ApprovalActivity {
  key: string
  kind: 'approval'
  /** payload 无 turn 字段——环境回合计数归属（fold.ts）。 */
  turn: number
  ref: ContentRef
  time: number
  approvalId: string
  toolName: string
  /** 问题文案（asker 的人类可读解释，research 0033 §四）。 */
  reason?: string
  /** 被审批的工具调用（有则链到 ToolCallActivity.callId——fact）。 */
  callId?: string
  /** 结局（配对 decided；缺 = 待决）。 */
  outcome?: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
  decidedTime?: number
}

export type ActivityDoc = AssistantMessageActivity | ToolCallActivity | ApprovalActivity

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
  /**
   * 活动 key（`act:{seq}`）→ 活动事实（切片 B：assistant/工具/审批；
   * spawn 是 tool-call 上的事实位）。turn 面板与 subagent 面板据此下钻。
   */
  activities: ReadonlyMap<string, ActivityDoc>
  /** ContentRef → 事件本体（零拷贝引用）。 */
  contents: ReadonlyMap<ContentRef, SessionEvent>
  /**
   * 文档结构签名（确定性拼接：turns 骨架 + 任务存活集 + 末修订状态 +
   * 活动面）。切片 A 仅奠基（connector 重推门控沿旧签名，避免行为漂移）；
   * C 切片投影 memo（fold/filter 参数化）接入。
   */
  signature: string
}
