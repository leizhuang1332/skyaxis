/**
 * Session 事件窗口 → 任务图推断（v0.3 + P0 节点身份稳定化）。
 *
 * 节点：
 *   - root        永远 1 个，session 锚点
 *   - user-prompt 来自 user/message 事件（source.kind === 'user'）；plugin 注入忽略
 *   - task        来自 todo/write 事件的 TodoItem（content + status）
 *
 * 边（DAG，线性连续；kind = 'sequence'，表示推断的执行顺序而非声明式依赖）：
 *   - 同 turn 内 user-prompt ──→ 该 turn 内首个 task
 *   - 同 turn 内 task_i ──→ task_{i+1}
 *   - 跨 turn：上一 turn 末 task ──→ 下一 turn 首 task
 *
 * turn 归属（P1）：todo/write 的 wire payload 没有 turn 字段（见
 * todo-write.d.ts），归属由环境回合计数决定（turn/start 设置 / user/message
 * 自增），事件按 seq 排序后顺扫即得。
 *
 * 状态：
 *   - pending       ← TodoItem.status === 'pending'（未知 status 也兜底到此）
 *   - running       ← TodoItem.status === 'in_progress'
 *   - done          ← TodoItem.status === 'completed'
 *   - failed        ← 所在 turn 的 turn/end.reason.kind === 'error' 且任务
 *                     自身未 completed（任务完成是事实，turn 失败不篡改）；
 *                     同时该 turn 的 user-prompt 节点标 failed
 *
 * 节点身份（P0）：task 节点 ID = `todo-{turn}-{contentHash}`，按 content 锚定。
 *   todo/write 是 whole-list 替换语义——每次 todo 状态更新，同 content 的任务
 *   **复用同一个节点**（原位更新 status），只有 content 消失的任务才被删除。
 *   这样同一逻辑节点跨 writeSeq 是同一个 React key，避免整树 remount / 拖拽丢失。
 *
 * Subagent 子树 / approval 节点 / plan/mode / tool-call 节点 全部不在 v0.3 范围。
 *
 * 这是纯函数，相同入参必返回相同出参；connector 把它包成 store 写入。
 */
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SkyaxisAgentMetrics } from '../../agent-metrics.js'
import type { TaskNode, TaskEdge, TaskStatus } from './types.js'

interface InferredNode extends TaskNode {
  data: TaskNode['data'] & {
    /** 仅推断期使用：当前 TodoItem.status 原文，方便 mapStatus 复用。 */
    _todoStatus?: TodoStatus
    /** 仅推断期使用：所在 turn 是否被 turn/end.reason.kind === 'error' 标记。 */
    _turnFailed?: boolean
  }
}

/** todo/write 事件 data.todos[i].status 的精确字符串。 */
type TodoStatus = 'pending' | 'in_progress' | 'completed'

/**
 * content 字符串 → ID 片段的稳定哈希（FNV-1a 32 位，输出 base36）。
 *
 * 不引入加密库；todo 级别（单 turn 数十条）碰撞概率可忽略，碰撞的后果
 * 只是两个任务共用一个节点（可接受的退化）。同 content 必同 hash——
 * 这是跨 todo/write 复用节点身份的锚定依据。
 */
function hashContent(content: string): string {
  let h = 0x811c9dc5 // FNV offset basis
  for (let i = 0; i < content.length; i += 1) {
    h ^= content.charCodeAt(i)
    h = Math.imul(h, 0x01000193) // FNV prime
  }
  return (h >>> 0).toString(36) // 归一为无符号 32 位 + base36
}

export function inferTaskGraph(
  entries: readonly SessionEventLikeEntry[],
  sessionLabel: string,
  rootStatus: TaskStatus = 'running',
  rootMetrics?: SkyaxisAgentMetrics,
): { nodes: TaskNode[]; edges: TaskEdge[] } {
  const events = entries
    .filter((e): e is Extract<SessionEventLikeEntry, { type: 'event' }> => e.type === 'event')
    .map((e) => e.event)
    .sort((a, b) => a.seq - b.seq)

  const rawNodes: InferredNode[] = []
  const rawEdges: TaskEdge[] = []

  // root 节点（永远 1 个）。状态由调用方传入（connector 从 SessionSummary
  // 映射：running → running / completed → done / 其余 → pending）；默认
  // 'running' 仅为保持无参调用的旧契约。metrics 为 P2b 的"最近一次请求"
  // 路由事实（skyaxisAgentMetrics 投影），undefined = 尚无请求。
  rawNodes.push({
    id: 'root',
    type: 'root',
    position: { x: 0, y: 0 },
    data: {
      label: sessionLabel,
      status: rootStatus,
      ...(rootMetrics === undefined ? {} : { metrics: rootMetrics }),
    },
  })

  /** turn -> 已记录的 user-prompt node id；同 turn 多次 user/message 只取首条（kind === 'user'）。 */
  const firstUserPromptByTurn = new Map<number, string | null>()
  /** 节点 id -> 当前 node 引用（id 已分配但节点还在 rawNodes 里需要 in-place 更新）。 */
  // 注：rawNodes 数组本身允许 O(n) find，节点数 < 50 的 session 完全够用，不另存索引。
  /** turn -> 该 turn 已确认的"首个 task 节点 id"（用于 user-prompt → task 边）。 */
  const firstTaskByTurn = new Map<number, string | null>()
  /** turn -> 该 turn 所有 task 节点 id 列表（按当前列表顺序）。 */
  const taskIdsByTurn = new Map<number, string[]>()

  /**
   * 跨 todo/write 复用节点身份的索引（P0）：
   *   外层按 turn，内层按 contentHash 索引节点引用。
   *
   * 同 content 的 todo 即使跨 writeSeq 也复用同一个节点引用（连同它的 id），
   * 只原位更新 status；content 从列表消失时才删除节点。这是节点身份稳定的根。
   */
  const turnTasks = new Map<number, Map<string, InferredNode>>()

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
        rawEdges.push({
          id: `e-root-${id}`,
          source: 'root',
          target: id,
          data: { kind: 'sequence' },
        })
        break
      }

      case 'todo/write': {
        // 事件形状来自本目录 todo-write.d.ts 的 module augmentation（对齐
        // typert 线协议表：{ todos } —— payload 没有 turn 字段）。
        // turn 归属用环境回合计数：事件已按 seq 排序，turn/start 显式设置、
        // user/message 自增；生产时序保证 turn/start 先于其内的 todo/write。
        const turn = currentTurn
        lastEventTurn = Math.max(lastEventTurn, turn)
        const todos = ev.data.todos ?? []

        // P0：按 content 锚定复用节点，而非 whole-list 全删重建。
        // 该 turn 内，content 没变的任务原位更新 status / label；
        // content 消失的任务删除；新 content 才新建节点。
        const turnIndex = turnTasks.get(turn) ?? new Map<string, InferredNode>()
        turnTasks.set(turn, turnIndex)
        const PREFIX = `todo-${turn}-`

        // 删除本 turn 内 content 已消失的节点（含它们连的边）。
        const keepHashes = new Set(todos.map((t) => hashContent(t.content)))
        for (const existing of [...turnIndex.values()]) {
          const key = existing.id.slice(PREFIX.length)
          const baseHash = key.split('#')[0] // 去重后缀，回取 content 锚点
          if (!keepHashes.has(baseHash)) {
            turnIndex.delete(key)
            removeNodeAndEdges(rawNodes, rawEdges, existing.id)
          }
        }

        // 清掉本 turn 存活节点之间残留的旧顺序边，下方统一重建。
        for (let i = rawEdges.length - 1; i >= 0; i--) {
          const e = rawEdges[i]!
          if (e.source.startsWith(PREFIX) && e.target.startsWith(PREFIX)) {
            rawEdges.splice(i, 1)
          }
        }

        const isFirstTodoWriteInTurn = taskIdsByTurn.get(turn) === undefined
        const userPromptId = firstUserPromptByTurn.get(turn) ?? null

        const nextIds: string[] = []
        let lastTaskId: string | null = null

        // 跨 turn 链：找上一个非空 turn 的末 task。
        let crossTurnPrevLastId: string | null = null
        if (isFirstTodoWriteInTurn) {
          for (let t = turn - 1; t >= 1; t--) {
            const ids = taskIdsByTurn.get(t)
            if (ids && ids.length > 0) {
              crossTurnPrevLastId = ids[ids.length - 1]!
              break
            }
          }
        }

        // 追踪本 write 内每个 content 已出现的次数，用于把同 content 的多个
        // 条目集合到独立的节点上（同 write 内是两个独立 todo，跨 write 时按
        // 第 N 次出现对齐到上一 write 留下的同序节点，实现复用）。
        const writeCountByHash = new Map<string, number>()

        for (let i = 0; i < todos.length; i++) {
          const todo = todos[i]!
          const status: TodoStatus = normalizeTodoStatus(todo.status)
          const content = todo.content
          const hash = hashContent(content)

          // 本 write 内该 content 第几次出现（从 0 起）——用作后缀基数。
          const occurrence = writeCountByHash.get(hash) ?? 0
          writeCountByHash.set(hash, occurrence + 1)
          // N=0 → 基础 key；N>0 → 取上一 write 留下的 `#N-1` 节点复用 / 新建。
          const key = occurrence === 0 ? hash : `${hash}#${occurrence - 1}`

          const id = `todo-${turn}-${key}`

          let node = turnIndex.get(key)
          if (node === undefined) {
            node = {
              id,
              type: 'task',
              position: { x: 0, y: 0 },
              data: {
                label: truncate(content, 80),
                status: mapStatus(status, turnFailedSet.has(turn)),
                _todoStatus: status,
                _turnFailed: turnFailedSet.has(turn),
              },
            }
            rawNodes.push(node)
            turnIndex.set(key, node)
          }
          // 原位更新：status 可能随 turnFailed 状态变化。
          node.data.status = mapStatus(status, turnFailedSet.has(turn))
          node.data._todoStatus = status
          node.data._turnFailed = turnFailedSet.has(turn)

          // 边：上一 task → 当前 task（同 turn 内串联）
          if (lastTaskId && lastTaskId !== node.id) {
            rawEdges.push({
              id: `e-${lastTaskId}-${node.id}`,
              source: lastTaskId,
              target: node.id,
              data: { kind: 'sequence' },
            })
          }
          // 边：跨 turn 上一 turn 末 task → 本 turn 首 task（仅 isFirstTodoWriteInTurn）
          if (
            isFirstTodoWriteInTurn &&
            i === 0 &&
            crossTurnPrevLastId &&
            crossTurnPrevLastId !== node.id
          ) {
            rawEdges.push({
              id: `e-${crossTurnPrevLastId}-${node.id}`,
              source: crossTurnPrevLastId,
              target: node.id,
              data: { kind: 'sequence' },
            })
          }
          // 边：user-prompt → 本 turn 首 task
          if (i === 0 && userPromptId && userPromptId !== node.id) {
            rawEdges.push({
              id: `e-${userPromptId}-${node.id}`,
              source: userPromptId,
              target: node.id,
              data: { kind: 'sequence' },
            })
          }

          lastTaskId = node.id
          nextIds.push(node.id)
        }

        firstTaskByTurn.set(turn, nextIds[0] ?? null)
        taskIdsByTurn.set(turn, nextIds)
        break
      }

      case 'turn/end': {
        const turn = ev.data.turn
        lastEventTurn = Math.max(lastEventTurn, turn)
        const reason = ev.data.reason
        if (reason.kind === 'error') {
          turnFailedSet.add(turn)
          // 诚实语义：todo 自身的 completed 是事实，turn 失败不篡改它；
          // 只有未完成的任务才因 turn 中止而升级 failed。
          const ids = taskIdsByTurn.get(turn) ?? []
          for (const id of ids) {
            const n = rawNodes.find((nn) => nn.id === id)
            if (n && n.data._todoStatus !== 'completed') {
              n.data.status = 'failed'
              n.data._turnFailed = true
            }
          }
          // turn 级失败标在触发改 turn 的 user-prompt 节点（turn/end 事实投影）。
          const userPromptId = firstUserPromptByTurn.get(turn)
          if (userPromptId) updateNode(rawNodes, userPromptId, { status: 'failed' })
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
    const { _todoStatus, _turnFailed, ...data } = n.data
    void _todoStatus
    void _turnFailed
    return { ...n, data }
  })
  // lastEventTurn 在 DAG 推断中未直接消费，保留以备调试
  void lastEventTurn
  return { nodes, edges: rawEdges }
}

// ---------- helpers ----------

/**
 * 运行时防御：todo status 经 wire 传输，字段漂移（上游新增枚举值等）时
 * 兜底为 'pending' —— 绝不误标 completed（诚实 > 漂亮）。
 */
function normalizeTodoStatus(raw: string): TodoStatus {
  return raw === 'in_progress' || raw === 'completed' ? raw : 'pending'
}

function mapStatus(todoStatus: TodoStatus, turnFailed: boolean): TaskStatus {
  // turn 失败只升级未完成任务；completed 是任务自身的事实，不被篡改。
  if (turnFailed && todoStatus !== 'completed') return 'failed'
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
