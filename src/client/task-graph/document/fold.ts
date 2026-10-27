/**
 * facts → SessionDocument 纯函数（v0.4 切片 A，ADR 0036）。
 *
 * 收编退役 infer.ts 的 turn 归属与 todo 折叠，语义修正（对齐 ADR 0036 §2.3）：
 *   - todo/write 是**整会话单一列表**的 whole-list 替换（现行按 turn 分域是
 *     概念性错误——续写列表每 turn 复制节点）。身份全局化：同 content 跨
 *     turn / 跨 write 复用同一 key，逐 write 追加修订史，最新列表缺席者退役。
 *   - turn/end 的七种 reason 全息保留（现行只读 error.kind 一个位）。
 *   - 一 turn 内全部人类 user/message 都记录（现行只留首条）。
 *
 * 切片 B 增（ADR 0036 §2.5 B 行）：activities 折叠——assistant 消息
 * （turn/step wire 显式）、tool/call ⊕ tool/result（callId 严格配对，
 * 孤儿/重复诚实跳过）、approval/asked ⊕ decided（id 配对）、subagent/catalog
 * （childId 收集）＋ spawn fact 级解析（result 文本 + catalog 双交叉验证，
 * research 0033 §六降级链第一级）。
 *
 * 环境回合计数原样移植（P1 生产 bug 的修法）：todo/write 的 wire payload
 * 没有 turn 字段（todo-write.d.ts 锚定），归属由环境事件决定——turn/start
 * 显式覆盖、user/message 自增；事件按 seq 排序后顺扫即得。turn/start 在
 * user/message 之后到达时会改写 currentTurn 而已生成的 prompt ref 留在自增
 * turn 下（P1 时代 infer.test.ts 钉过的微妙语义，git 历史可考；fold.test.ts
 * 同款用例保平移）。
 *
 * 失败标记**不在 fold 里做**：history 是 wire 真值，投影层按「末修订所属
 * turn 是否 error 收场」派生 failed——与退役 infer 的时序行为等价（turn/end
 * 后无新 write 则 failed 保持；后续 write 按 wire 状态覆盖）。
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  ActivityDoc,
  ApprovalActivity,
  AssistantMessageActivity,
  SessionDocument,
  TaskDocEntry,
  TaskGraphFacts,
  TodoStatusOf,
  ToolCallActivity,
  TurnDoc,
  TurnEndReasonOf,
} from './types.js'
import { WriteKeyAssigner } from './identity.js'

/** turn 建造期可变形态（fold 内部；产物 TurnDoc 只读）。 */
interface TurnBuilder {
  index: number
  promptRefs: string[]
  finalListKeys: string[]
  activityKeys: string[]
  endReason?: TurnEndReasonOf
  startTime?: number
  endTime?: number
}

export function foldSessionDocument(facts: TaskGraphFacts): SessionDocument {
  const events = [...facts.events].sort((a, b) => a.seq - b.seq)

  const turns = new Map<number, TurnBuilder>()
  const tasks = new Map<string, TaskDocEntry>()
  const activities = new Map<string, ActivityDoc>()
  const contents = new Map<string, SessionEvent>()

  // 切片 B 配对表：callId → 工具调用活动（result 配对）；审批 id → 活动
  // （decided 配对）；catalog childId 集（spawn fact 级解析的交叉验证）。
  const callsByCallId = new Map<string, ToolCallActivity>()
  const approvalsById = new Map<string, ApprovalActivity>()
  const catalogChildIds = new Set<string>()

  const turnOf = (index: number): TurnBuilder => {
    const existing = turns.get(index)
    if (existing !== undefined) return existing
    const created: TurnBuilder = {
      index,
      promptRefs: [],
      finalListKeys: [],
      activityKeys: [],
    }
    turns.set(index, created)
    return created
  }

  /** 环境回合计数：turn/start 显式覆盖 / user/message 自增（P1 语义原样）。 */
  let currentTurn = 0

  for (const event of events) {
    switch (event.type) {
      case 'turn/start': {
        const t = (event.data as unknown as { turn?: number }).turn ?? 0
        currentTurn = t
        turnOf(t).startTime = event.time
        break
      }

      case 'user/message': {
        // 只收人类直输（source.kind === 'user'）；plugin 注入 / 合成上下文
        // 不建 prompt 事实（ContextForm 归档是 B 以后的噪音折叠正路）。
        const userMsg = event.data as unknown as { source?: unknown }
        if (readUserSourceKind(userMsg.source) !== 'user') break
        currentTurn += 1
        const turn = currentTurn
        const ref = `ev:${event.seq}`
        contents.set(ref, event)
        turnOf(turn).promptRefs.push(ref)
        break
      }

      case 'todo/write': {
        const turn = currentTurn
        // 全局身份：同 write 内逐条目派生 key（重复 content 得 #N 后缀）。
        const assigner = new WriteKeyAssigner()
        const todos = event.data.todos ?? []
        const newKeys: string[] = []
        for (const todo of todos) {
          const key = assigner.keyFor(todo.content)
          let entry = tasks.get(key)
          if (entry === undefined) {
            entry = { key, content: todo.content, history: [] }
            tasks.set(key, entry)
          }
          if (entry.retired !== undefined) delete entry.retired // 再次出现即复活
          entry.history.push({
            seq: event.seq,
            time: event.time,
            turn,
            status: normalizeTodoStatus(todo.status),
          })
          newKeys.push(key)
        }
        // whole-list 替换：本次缺席的存活者退役（历史保留；复活清位）。
        const present = new Set(newKeys)
        for (const entry of tasks.values()) {
          if (entry.retired === undefined && !present.has(entry.key)) {
            entry.retired = { seq: event.seq }
          }
        }
        turnOf(turn).finalListKeys = newKeys
        break
      }

      case 'subagent/catalog': {
        // spawn fact 级解析的交叉验证集（research 0033 §六：result 文本里的
        // childId 必须在 catalog 在册才标 fact——双关过才挂 spawn）。
        catalogChildIds.add(String(event.data.childId))
        break
      }

      case 'assistant/message': {
        // wire 显式 turn/step（fact）——不像 todo 依赖环境计数。
        const data = event.data as unknown as {
          turn: number
          step: number
          message?: unknown
          usage?: { inputTokens?: number; outputTokens?: number }
          interrupted?: true
        }
        const key = `act:${event.seq}`
        const ref = `ev:${event.seq}`
        contents.set(ref, event)
        const source = readModelSource((data.message as { source?: unknown } | undefined)?.source)
        const activity: AssistantMessageActivity = {
          key,
          kind: 'assistant-message',
          turn: data.turn,
          step: data.step,
          ref,
          time: event.time,
          text: joinBlocks(data.message, 'text'),
          ...(joinBlocks(data.message, 'reasoning') === '' ? {} : { reasoningText: joinBlocks(data.message, 'reasoning') }),
          ...(source === undefined ? {} : { provider: source.provider, model: source.model }),
          ...(data.usage === undefined || typeof data.usage.inputTokens !== 'number'
            ? {}
            : { usage: { inputTokens: data.usage.inputTokens, outputTokens: data.usage.outputTokens ?? 0 } }),
          ...(data.interrupted === true ? { interrupted: true } : {}),
        }
        activities.set(key, activity)
        turnOf(data.turn).activityKeys.push(key)
        break
      }

      case 'tool/call': {
        const data = event.data
        const key = `act:${event.seq}`
        const ref = `ev:${event.seq}`
        contents.set(ref, event)
        const activity: ToolCallActivity = {
          key,
          kind: 'tool-call',
          turn: data.turn,
          step: data.step,
          ref,
          time: event.time,
          callId: String(data.callId),
          name: data.name,
          argumentsRaw: data.arguments,
        }
        activities.set(key, activity)
        callsByCallId.set(String(data.callId), activity)
        turnOf(data.turn).activityKeys.push(key)
        break
      }

      case 'tool/result': {
        // callId 配对（fact）：事件已按 seq 排序，call 恒先于 result；孤儿
        // result（无前导 call）诚实跳过；同 callId 重复 result 首个胜出（幂等）。
        const data = event.data as unknown as {
          message?: { toolCallId?: unknown; isError?: unknown; content?: readonly unknown[] }
          error?: { name?: unknown; code?: unknown; reason?: unknown }
        }
        const callId = data.message === undefined || typeof data.message.toolCallId !== 'string'
          ? undefined
          : data.message.toolCallId
        const call = callId === undefined ? undefined : callsByCallId.get(callId)
        if (call === undefined || call.result !== undefined) break
        const resultText = joinContentText(data.message?.content)
        contents.set(`ev:${event.seq}`, event)
        call.result = {
          isError: data.message?.isError === true,
          ...(data.error === undefined || typeof data.error.name !== 'string' ? {} : { errorName: data.error.name }),
          ...(data.error === undefined || typeof data.error.code !== 'string' ? {} : { errorCode: data.error.code }),
          ...(data.error === undefined || typeof data.error.reason !== 'string' ? {} : { errorReason: data.error.reason }),
          text: resultText,
          durationMs: event.time - call.time,
          ref: `ev:${event.seq}`,
        }
        // spawn fact 级解析（research 0033 §六降级链第一级）：result 文本
        // `started subagent <id>` 且 <id> ∈ catalog 在册 → 挂 spawn（含
        // arguments 的 description/prompt 防御解析）；任一不过 = 不标。
        const spawned = /^started subagent (\S+)/.exec(resultText)
        if (spawned !== null && catalogChildIds.has(spawned[1]!)) {
          call.spawn = parseSpawnArguments(call.argumentsRaw, spawned[1]!)
        }
        break
      }

      case 'approval/asked': {
        // payload 无 turn 字段——环境回合计数归属（同 todo/write）。
        const data = event.data
        const key = `act:${event.seq}`
        const ref = `ev:${event.seq}`
        contents.set(ref, event)
        const activity: ApprovalActivity = {
          key,
          kind: 'approval',
          turn: currentTurn,
          ref,
          time: event.time,
          approvalId: data.id,
          toolName: data.toolName,
          ...(typeof data.reason === 'string' ? { reason: data.reason } : {}),
          ...(typeof data.callId === 'string' ? { callId: data.callId } : {}),
        }
        activities.set(key, activity)
        approvalsById.set(data.id, activity)
        turnOf(currentTurn).activityKeys.push(key)
        break
      }

      case 'approval/decided': {
        // id 配对（fact）：孤儿 decided 诚实跳过；重复 decided 首个胜出（幂等）。
        const data = event.data
        const asked = approvalsById.get(data.id)
        if (asked === undefined || asked.outcome !== undefined) break
        asked.outcome = data.outcome
        asked.decidedTime = event.time
        break
      }

      case 'turn/end': {
        const builder = turnOf(event.data.turn)
        builder.endReason = event.data.reason
        builder.endTime = event.time
        break
      }

      // 切片 B 后仍不折叠：tool-workflow/*（D 收编）/ system/* / request/* /
      // developer/* / command/* / compaction/* / feedback/* / 其余 log-only
      // 词汇——C/D 需要时从这里扩展。
      default:
        break
    }
  }

  const turnDocs: TurnDoc[] = [...turns.values()]
    .sort((a, b) => a.index - b.index)
    .map((t) => ({
      index: t.index,
      userPromptRefs: t.promptRefs,
      finalListKeys: t.finalListKeys,
      activityKeys: t.activityKeys,
      ...(t.endReason === undefined ? {} : { endReason: t.endReason }),
      ...(t.startTime === undefined ? {} : { startTime: t.startTime }),
      ...(t.endTime === undefined ? {} : { endTime: t.endTime }),
    }))

  const document: SessionDocument = {
    sessionId: facts.sessionId,
    label: facts.label,
    rootStatus: facts.rootStatus,
    ...(facts.rootMetrics === undefined ? {} : { rootMetrics: facts.rootMetrics }),
    hasMore: facts.hasMore,
    turns: turnDocs,
    tasks,
    activities,
    contents,
    signature: documentSignature(turnDocs, tasks, activities, facts),
  }
  return document
}

/**
 * 文档结构签名（确定性）：turns 骨架 + 任务存活集与末修订状态 + 活动面 +
 * root 面。覆盖投影与面板的全部输入面（status/outcome 级变化都改输出，与
 * layoutSignature 的「结构签名」语义不同——那是布局门控，这是重投影门控）。
 */
function documentSignature(
  turns: readonly TurnDoc[],
  tasks: ReadonlyMap<string, TaskDocEntry>,
  activities: ReadonlyMap<string, ActivityDoc>,
  facts: TaskGraphFacts,
): string {
  const turnPart = turns
    .map(
      (t) =>
        `${t.index}:${t.userPromptRefs.length}:${t.finalListKeys.join(',')}:${
          t.activityKeys.length
        }:${t.endReason?.kind ?? '-'}:${t.startTime ?? ''}..${t.endTime ?? ''}`,
    )
    .join('|')
  const taskPart = [...tasks.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => {
      const last = entry.history[entry.history.length - 1]
      return `${key}=${entry.retired === undefined ? `live:${last?.turn}:${last?.status}` : `ret@${entry.retired.seq}`}`
    })
    .join('|')
  const activityPart = [...activities.values()]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((a) => {
      if (a.kind === 'tool-call') {
        return `${a.key}:t:${a.result === undefined ? '-' : a.result.isError ? 'e' : 'r'}${a.spawn === undefined ? '' : 's'}`
      }
      if (a.kind === 'approval') {
        return `${a.key}:a:${a.outcome ?? 'pending'}`
      }
      return `${a.key}:m:${a.usage === undefined ? '-' : a.usage.outputTokens}`
    })
    .join('|')
  return `${facts.label}|${facts.rootStatus}|${facts.hasMore}|T:${turnPart}||K:${taskPart}||A:${activityPart}`
}

/**
 * 运行时防御：todo status 经 wire 传输，字段漂移（上游新增枚举值等）时
 * 兜底为 'pending' —— 绝不误标 completed（诚实 > 漂亮，infer.ts 同款）。
 */
function normalizeTodoStatus(raw: string): TodoStatusOf {
  return raw === 'in_progress' || raw === 'completed' ? raw : 'pending'
}

/** 消息 content 里指定 type 的 text blocks 连接（'\n'；无则空串）。 */
function joinBlocks(message: unknown, blockType: 'text' | 'reasoning'): string {
  if (typeof message !== 'object' || message === null) return ''
  const content = (message as { content?: unknown }).content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue
    const p = part as { type?: unknown; text?: unknown }
    if (p.type === blockType && typeof p.text === 'string' && p.text !== '') {
      parts.push(p.text)
    }
  }
  return parts.join('\n')
}

/** tool/result 的 content blocks 文本连接（同 joinBlocks 但吃裸 content 数组）。 */
function joinContentText(content: readonly unknown[] | undefined): string {
  if (content === undefined) return ''
  const parts: string[] = []
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue
    const p = part as { type?: unknown; text?: unknown }
    if (p.type === 'text' && typeof p.text === 'string' && p.text !== '') {
      parts.push(p.text)
    }
  }
  return parts.join('\n')
}

/** AssistantMessage.source（kind:'model'）的 provider/model 防御读。 */
function readModelSource(source: unknown): { provider: string; model: string } | undefined {
  if (typeof source !== 'object' || source === null) return undefined
  const s = source as { kind?: unknown; provider?: unknown; model?: unknown }
  if (s.kind !== 'model' || typeof s.provider !== 'string' || typeof s.model !== 'string') {
    return undefined
  }
  return { provider: s.provider, model: s.model }
}

/**
 * 派生工具 arguments（JSON 原文）的 description/prompt 防御解析——坏 JSON、
 * 缺字段一律缺省（诚实，不臆造）。args 形状锚定 tool-subagent
 * （research 0033 §六：`{ prompt, description?, … }`）。
 */
function parseSpawnArguments(
  argumentsRaw: string,
  childId: string,
): { childId: import('@deepseek-ai/dsh-session').SessionId; description?: string; promptText?: string } {
  let parsed: unknown
  try {
    parsed = JSON.parse(argumentsRaw)
  } catch {
    return { childId: childId as import('@deepseek-ai/dsh-session').SessionId }
  }
  if (parsed === null || typeof parsed !== 'object') {
    return { childId: childId as import('@deepseek-ai/dsh-session').SessionId }
  }
  const args = parsed as { description?: unknown; prompt?: unknown }
  return {
    childId: childId as import('@deepseek-ai/dsh-session').SessionId,
    ...(typeof args.description === 'string' && args.description !== '' ? { description: args.description } : {}),
    ...(typeof args.prompt === 'string' && args.prompt !== '' ? { promptText: args.prompt } : {}),
  }
}

/**
 * 读取 user/message 事件的 source.kind（MessageSource 判别联合的防御读；
 * merge-extensible，未知 kind 落 'other' 不进 prompt 事实）。
 */
function readUserSourceKind(source: unknown): 'user' | 'plugin' | 'model' | 'tool' | 'other' {
  if (typeof source !== 'object' || source === null) return 'other'
  const s = source as { kind?: unknown }
  switch (s.kind) {
    case 'user':
      return 'user'
    case 'plugin':
      return 'plugin'
    case 'model':
      return 'model'
    case 'tool':
      return 'tool'
    default:
      return 'other'
  }
}
