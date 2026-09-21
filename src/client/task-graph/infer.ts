/**
 * Session 事件窗口 → 任务图推断（v0.3）。
 *
 * 节点：
 *   - root        永远 1 个，session 锚点
 *   - user-prompt 来自 user/message 事件（source.kind === 'user'）；plugin 注入忽略
 *   - task        来自 todo/write 事件的 TodoItem（content + status）
 *
 * 边（DAG，线性连续）：
 *   - 同 turn 内 user-prompt ──→ 该 turn 内首个 task
 *   - 同 turn 内 task_i ──→ task_{i+1}
 *   - 跨 turn：上一 turn 末 task ──→ 下一 turn 首 task
 *
 * 状态：
 *   - pending       ← TodoItem.status === 'pending'
 *   - running       ← TodoItem.status === 'in_progress'
 *   - done          ← TodoItem.status === 'completed'
 *   - failed        ← 所在 turn 的 turn/end.reason.kind === 'error'（错误覆盖 todo 完成态）
 *   - waiting       v0.3 不生成
 *
 * Subagent 子树 / approval 节点 / plan/mode / tool-call 节点 全部不在 v0.3 范围。
 *
 * 这是纯函数，相同入参必返回相同出参；connector 把它包成 store 写入。
 */
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TaskNode, TaskEdge, TaskStatus } from './types.js'

interface InferredNode extends TaskNode {
  data: TaskNode['data'] & {
    /** 仅推断期使用：当前 TodoItem.status 原文，方便 mapStatus 复用。 */
    _todoStatus?: TodoStatus
    /** 仅推断期使用：所在 turn 是否被 turn/end.reason.kind === 'error' 标记。 */
    _turnFailed?: boolean
    /** 仅推断期使用：当前 TodoItem.content 原文，用于跨 todo/write 复用节点 id。 */
    _todoContent?: string
  }
}

/** todo/write 事件 data.todos[i].status 的精确字符串。 */
type TodoStatus = 'pending' | 'in_progress' | 'completed'

export function inferTaskGraph(
  entries: readonly SessionEventLikeEntry[],
  sessionLabel: string,
): { nodes: TaskNode[]; edges: TaskEdge[] } {
  const events = entries
    .filter((e): e is Extract<SessionEventLikeEntry, { type: 'event' }> => e.type === 'event')
    .map((e) => e.event)
    .sort((a, b) => a.seq - b.seq)

  const rawNodes: InferredNode[] = []
  const rawEdges: TaskEdge[] = []

  // root 节点（永远 1 个）
  rawNodes.push({
    id: 'root',
    type: 'root',
    position: { x: 0, y: 0 },
    data: { label: sessionLabel, status: 'running' },
  })

  /** turn -> 已记录的 user-prompt node id；同 turn 多次 user/message 只取首条（kind === 'user'）。 */
  const firstUserPromptByTurn = new Map<number, string | null>()
  /** 节点 id -> 当前 node 引用（id 已分配但节点还在 rawNodes 里需要 in-place 更新）。 */
  // 注：rawNodes 数组本身允许 O(n) find，节点数 < 50 的 session 完全够用，不另存索引。
  /** turn -> 已确认的"首个 task 节点 id"（用于 user-prompt → task 边）。 */
  const firstTaskByTurn = new Map<number, string | null>()
  /** turn -> "末 task 节点 id"（用于跨 turn 链）。 */
  const lastTaskByTurn = new Map<number, string | null>()
  /** turn -> 该 turn 内所有 task id 列表（turn/end error 时批量升级 failed）。 */
  const taskIdsByTurn = new Map<number, string[]>()

  /**
   * 跨 todo/write 复用节点 id 的关键表：
   *   key = `${turn}:${writeSeq}:${index}`
   *   value = { id, content, status }
   *
   * writeSeq 是同 turn 内 todo/write 的写入次数（从 1 起步）。
   * 同一个 (turn, index) 在不同 writeSeq 下会换 key —— 因为 whole-list 替换后
   * 同位置可能内容不同，视为"新的 task 条目"。同 writeSeq 内顺序由 index 决定。
   */
  const todoState = new Map<
    string,
    { id: string; content: string; status: TodoStatus }
  >()
  /** turn 内 todo/write 已发生的次数。 */
  const todoWriteSeqByTurn = new Map<number, number>()

  /** turn 已经被 turn/end reason=error 关闭 → 该 turn 的 task 升级 failed。 */
  const turnFailedSet = new Set<number>()

  let lastEventTurn = 0

  /**
   * 当前 turn 计数器。
   * - turn/start 事件 → 显式覆盖（DSH 给出的 turn 编号）
   * - user/message 事件 → 自增（每个 user prompt 触发新 turn）
   * - 其他事件保持不变
   *
   * DSH SessionEventMap 里 user/message.data 是 UserMessage 本身，**没有 turn 字段**；
   * turn 来自事件 envelope 周围（turn/start 计数 / 用户 prompt 计数）。
   */
  let currentTurn = 0

  for (const ev of events) {
    switch (ev.type) {
      case 'turn/start': {
        const t = (ev.data as unknown as { turn?: number }).turn ?? 0
        currentTurn = t
        lastEventTurn = Math.max(lastEventTurn, t)
        break
      }

      case 'user/message': {
        // 过滤 plugin 注入（source.kind === 'plugin'）；只画人类直接输入。
        // ev.data 本身就是 UserMessage（不是包了一层 .message）；UserMessage 不含 turn。
        const userMsg = ev.data as unknown as {
          source?: unknown
          content?: readonly unknown[]
        }
        const sourceKind = readUserSourceKind(userMsg.source)
        if (sourceKind !== 'user') break
        // 每个 user message 触发新 turn
        currentTurn += 1
        const turn = currentTurn
        lastEventTurn = Math.max(lastEventTurn, turn)
        if (firstUserPromptByTurn.has(turn)) break // 同 turn 重复 user → 只取首条
        const text = extractFirstText(userMsg.content ?? [])
        const id = `user-${turn}`
        firstUserPromptByTurn.set(turn, id)
        rawNodes.push({
          id,
          type: 'user-prompt',
          position: { x: 0, y: 0 },
          data: { label: text || `(user turn ${turn})`, status: 'done' },
        })
        // 边：root → user_prompt（让 user prompt 在 root 子树下，避免孤立）
        rawEdges.push({ id: `e-root-${id}`, source: 'root', target: id })
        break
      }

      case 'todo/write' as never: {
        // todo/write 事件由 @deepseek-ai/dsh-tool-todo 通过 declare module 增强进
        // SessionEventMap；本仓库的 SessionEvent 类型看不到它，用 unknown 中转。
        const todoEv = (ev as unknown as { data: unknown }).data as {
          turn?: number
          todos?: readonly { content: string; status: TodoStatus }[]
        }
        const turn = todoEv.turn ?? 0
        lastEventTurn = Math.max(lastEventTurn, turn)
        const writeSeq = (todoWriteSeqByTurn.get(turn) ?? 0) + 1
        todoWriteSeqByTurn.set(turn, writeSeq)

        const todos = todoEv.todos ?? []

        // 1) 收集该 turn 的所有"已有 task 节点 id"（跨 writeSeq 共用），用于 whole-list 替换
        const priorTurnTaskIds = new Set<string>()
        for (const k of todoState.keys()) {
          const tStr = k.split(':')[0]
          if (Number(tStr) === turn) {
            priorTurnTaskIds.add(todoState.get(k)!.id)
          }
        }

        // 2) 删除该 turn 所有旧 task 节点（含它们连的边）—— whole-list 替换语义
        for (const id of priorTurnTaskIds) {
          removeNodeAndEdges(rawNodes, rawEdges, id)
        }
        // 清掉 todoState 里该 turn 的所有旧条目
        for (const k of Array.from(todoState.keys())) {
          if (Number(k.split(':')[0]) === turn) todoState.delete(k)
        }

        // 3) 按新数组顺序逐条创建 task 节点
        const isFirstTodoWriteInTurn = writeSeq === 1
        const turnTaskIds: string[] = []
        let lastTaskId: string | null = null

        // 跨 turn 链：仅当 writeSeq=1 且 turn>1 时，找上一个非空 turn 的末 task
        let crossTurnPrevLastId: string | null = null
        if (isFirstTodoWriteInTurn) {
          for (let t = turn - 1; t >= 1; t--) {
            const last = lastTaskByTurn.get(t)
            if (last) {
              crossTurnPrevLastId = last
              break
            }
          }
        }

        const userPromptId = firstUserPromptByTurn.get(turn) ?? null

        for (let i = 0; i < todos.length; i++) {
          const todo = todos[i]!
          const key = `${turn}:${writeSeq}:${i}`
          const status: TodoStatus = todo.status
          const content = todo.content
          const id = `todo-${turn}-${writeSeq}-${i}`
          todoState.set(key, { id, content, status })

          rawNodes.push({
            id,
            type: 'task',
            position: { x: 0, y: 0 },
            data: {
              label: truncate(content, 80),
              status: mapStatus(status, turnFailedSet.has(turn)),
              _todoStatus: status,
              _todoContent: content,
              _turnFailed: turnFailedSet.has(turn),
            },
          })

          // 边：上一 task → 当前 task（同 turn 内串联）
          if (lastTaskId && lastTaskId !== id) {
            rawEdges.push({ id: `e-${lastTaskId}-${id}`, source: lastTaskId, target: id })
          }
          // 边：跨 turn 上一 turn 末 task → 本 turn 首 task（仅 writeSeq=1）
          if (
            isFirstTodoWriteInTurn &&
            i === 0 &&
            crossTurnPrevLastId &&
            crossTurnPrevLastId !== id
          ) {
            rawEdges.push({
              id: `e-${crossTurnPrevLastId}-${id}`,
              source: crossTurnPrevLastId,
              target: id,
            })
          }
          // 边：user-prompt → 本 turn 首 task
          if (i === 0 && userPromptId && userPromptId !== id) {
            rawEdges.push({
              id: `e-${userPromptId}-${id}`,
              source: userPromptId,
              target: id,
            })
          }

          lastTaskId = id
          turnTaskIds.push(id)
        }

        firstTaskByTurn.set(turn, turnTaskIds[0] ?? null)
        lastTaskByTurn.set(turn, lastTaskId)
        taskIdsByTurn.set(turn, turnTaskIds)
        break
      }

      case 'turn/end': {
        const turn = ev.data.turn
        lastEventTurn = Math.max(lastEventTurn, turn)
        const reason = ev.data.reason
        if (reason.kind === 'error') {
          turnFailedSet.add(turn)
          // 该 turn 所有 task 升级 failed
          const ids = taskIdsByTurn.get(turn) ?? []
          for (const id of ids) {
            updateNode(rawNodes, id, { status: 'failed' })
            const n = rawNodes.find((nn) => nn.id === id)
            if (n) n.data._turnFailed = true
          }
        }
        break
      }

      // v0.3 不参与推断：assistant/message / tool/* / step/* / turn/start /
      // subagent/* / approval/* / plan/mode / system/* / request/* /
      // session/* / command/* / goal/* / team/* / compaction/* / 其他
      default:
        break
    }
  }

  // 剥离推断期私有字段
  const nodes: TaskNode[] = rawNodes.map((n) => {
    const { _todoStatus, _turnFailed, _todoContent, ...data } = n.data
    void _todoStatus
    void _turnFailed
    void _todoContent
    return { ...n, data }
  })
  // lastEventTurn 在 DAG 推断中未直接消费，保留以备调试
  void lastEventTurn
  return { nodes, edges: rawEdges }
}

// ---------- helpers ----------

function mapStatus(todoStatus: TodoStatus, turnFailed: boolean): TaskStatus {
  if (turnFailed) return 'failed'
  switch (todoStatus) {
    case 'pending':
      return 'pending'
    case 'in_progress':
      return 'running'
    case 'completed':
      return 'done'
  }
}

/**
 * 读取 user/message 事件的 source.kind。
 *
 * `MessageSource` 是判别联合；'plugin' 类型会被过滤掉，只保留 'user' 起源。
 * assistant/tool 不可能出现在 user/message.data.message.source 上，但保留 narrowing
 * 防御。
 */
function readUserSourceKind(
  source: unknown,
): 'user' | 'plugin' | 'model' | 'tool' | 'other' {
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

function extractFirstText(content: readonly unknown[]): string {
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue
    const p = part as { type?: unknown; text?: unknown }
    if (p.type === 'text' && typeof p.text === 'string') {
      const firstLine = p.text.split(/\r?\n/)[0]?.trim() ?? ''
      return truncate(firstLine, 80)
    }
  }
  return ''
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

function updateNode(
  nodes: InferredNode[],
  id: string,
  patch: Partial<TaskNode['data']>,
): void {
  const node = nodes.find((n) => n.id === id)
  if (node) node.data = { ...node.data, ...patch }
}

function removeNodeAndEdges(
  nodes: InferredNode[],
  edges: TaskEdge[],
  id: string,
): void {
  const idx = nodes.findIndex((n) => n.id === id)
  if (idx >= 0) nodes.splice(idx, 1)
  for (let i = edges.length - 1; i >= 0; i--) {
    const e = edges[i]!
    if (e.source === id || e.target === id) edges.splice(i, 1)
  }
}
