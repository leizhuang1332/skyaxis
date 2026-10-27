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
  SessionDocument,
  TaskDocEntry,
  TaskGraphFacts,
  TodoStatusOf,
  TurnDoc,
  TurnEndReasonOf,
} from './types.js'
import { WriteKeyAssigner } from './identity.js'

/** turn 建造期可变形态（fold 内部；产物 TurnDoc 只读）。 */
interface TurnBuilder {
  index: number
  promptRefs: string[]
  finalListKeys: string[]
  endReason?: TurnEndReasonOf
  startTime?: number
  endTime?: number
}

export function foldSessionDocument(facts: TaskGraphFacts): SessionDocument {
  const events = [...facts.events].sort((a, b) => a.seq - b.seq)

  const turns = new Map<number, TurnBuilder>()
  const tasks = new Map<string, TaskDocEntry>()
  const contents = new Map<string, SessionEvent>()

  const turnOf = (index: number): TurnBuilder => {
    const existing = turns.get(index)
    if (existing !== undefined) return existing
    const created: TurnBuilder = { index, promptRefs: [], finalListKeys: [] }
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

      case 'turn/end': {
        const builder = turnOf(event.data.turn)
        builder.endReason = event.data.reason
        builder.endTime = event.time
        break
      }

      // 切片 A 不折叠：assistant/message / tool/* / approval/* / subagent/* /
      // tool-workflow/*（B/D 收编）/ system/* / request/* / 其余 —— B 起
      // activities 进文档时从这里扩展。
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
    contents,
    signature: documentSignature(turnDocs, tasks, facts),
  }
  return document
}

/**
 * 文档结构签名（确定性）：turns 骨架 + 任务存活集与末修订状态 + root 面。
 * 覆盖投影输出的全部输入面（status 级变化都改投影输出，与 layoutSignature
 * 的「结构签名」语义不同——那是布局门控，这是重投影门控）。
 */
function documentSignature(
  turns: readonly TurnDoc[],
  tasks: ReadonlyMap<string, TaskDocEntry>,
  facts: TaskGraphFacts,
): string {
  const turnPart = turns
    .map(
      (t) =>
        `${t.index}:${t.userPromptRefs.length}:${t.finalListKeys.join(',')}:${
          t.endReason?.kind ?? '-'
        }:${t.startTime ?? ''}..${t.endTime ?? ''}`,
    )
    .join('|')
  const taskPart = [...tasks.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => {
      const last = entry.history[entry.history.length - 1]
      return `${key}=${entry.retired === undefined ? `live:${last?.turn}:${last?.status}` : `ret@${entry.retired.seq}`}`
    })
    .join('|')
  return `${facts.label}|${facts.rootStatus}|${facts.hasMore}|T:${turnPart}||K:${taskPart}`
}

/**
 * 运行时防御：todo status 经 wire 传输，字段漂移（上游新增枚举值等）时
 * 兜底为 'pending' —— 绝不误标 completed（诚实 > 漂亮，infer.ts 同款）。
 */
function normalizeTodoStatus(raw: string): TodoStatusOf {
  return raw === 'in_progress' || raw === 'completed' ? raw : 'pending'
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
