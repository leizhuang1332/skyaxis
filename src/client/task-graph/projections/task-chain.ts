/**
 * 任务链投影（v0.4 切片 A，ADR 0036 §2.4）：SessionDocument → 图节点/边。
 *
 * 与退役 inferTaskGraph 的行为对齐面（invariants + 迁移用例钉住）：
 *   - root / user-prompt / task 三类节点、sequence 边语义不变；
 *   - turn/end error 只升级**非 completed** 任务（completed 是任务自身的
 *     事实，turn 失败不篡改）；派生改为「末修订所属 turn 是否 error 收场」；
 *   - 未知 status 兜底 pending；plugin 注入不建节点；环境回合计数归属。
 *
 * 切片 A 语义修正（ADR 0036）：
 *   - 身份全局化——跨 turn 同 content 一个节点（竖蛇按 turn 数倍增的修法）；
 *   - user-prompt 节点退役 status 位（用户输入不是任务，恒 done/failed 是
 *     在撒无意义的谎）；
 *   - 边按 id 去重 + **构造性无环守卫**：共享节点使同 source→target 跨 turn
 *     复现（React Flow 边 id 重复会炸）；任务「重开/回头」会产生回头边
 *     （a→b 后又 b→a），线性顺序语义表达不了它——诚实丢弃，改写史在
 *     文档层保留（B 的明细面呈现）。守卫顺带保证 Kahn 无环性质测试绿。
 */
import type { TaskNode, TaskEdge, TaskStatus } from '../types.js'
import type { SessionDocument, TodoStatusOf } from '../document/types.js'
import { taskNodeId } from '../document/identity.js'

export function projectTaskChain(document: SessionDocument): {
  nodes: TaskNode[]
  edges: TaskEdge[]
} {
  const nodes: TaskNode[] = []

  // root（永远 1 个）：label / 状态 / 指标均为 connector 传入的事实。
  nodes.push({
    id: 'root',
    type: 'root',
    position: { x: 0, y: 0 },
    data: {
      label: document.label,
      status: document.rootStatus,
      ...(document.rootMetrics === undefined ? {} : { metrics: document.rootMetrics }),
    },
  })

  // error 收场的 turn 集（failed 派生输入）。
  const failedTurns = new Set(
    document.turns.filter((t) => t.endReason?.kind === 'error').map((t) => t.index),
  )

  // user-prompt 节点：每 turn 一个（label 取首条人类消息；无 status 位）。
  for (const turn of document.turns) {
    if (turn.userPromptRefs.length === 0) continue
    const firstEvent = document.contents.get(turn.userPromptRefs[0]!)
    const text = firstEvent === undefined ? '' : extractFirstText(firstEvent)
    nodes.push({
      id: `user-${turn.index}`,
      type: 'user-prompt',
      position: { x: 0, y: 0 },
      data: { label: text || `(user turn ${turn.index})` },
    })
  }

  // task 节点：全局存活集（最新 write 缺席者退役，不投影）。
  for (const entry of document.tasks.values()) {
    if (entry.retired !== undefined) continue
    const last = entry.history[entry.history.length - 1]
    if (last === undefined) continue // 构造上不可达（创建即有修订），防御兜底
    nodes.push({
      id: taskNodeId(entry.key),
      type: 'task',
      position: { x: 0, y: 0 },
      data: {
        label: truncate(entry.content, 80),
        status: mapStatus(last.status, failedTurns.has(last.turn)),
      },
    })
  }

  // ---- 边（全 sequence；id 去重 + 构造性无环守卫）----

  const edges: TaskEdge[] = []
  const edgeIds = new Set<string>()
  const adjacency = new Map<string, string[]>()
  for (const n of nodes) adjacency.set(n.id, [])

  /** u 可达 v（含自身，DFS；图小不做记忆化）。 */
  const reaches = (from: string, to: string): boolean => {
    if (from === to) return true
    const seen = new Set<string>([from])
    const stack = [from]
    while (stack.length > 0) {
      const current = stack.pop()!
      for (const next of adjacency.get(current) ?? []) {
        if (next === to) return true
        if (!seen.has(next)) {
          seen.add(next)
          stack.push(next)
        }
      }
    }
    return false
  }

  /**
   * 加边守卫：自环跳过；id 已存在跳过（跨 turn 复现的同向边）；
   * 回头边诚实丢弃——加 source→target 成环当且仅当 target 已可达 source
   * （target→…→source 路径存在，再补 source→target 即闭环）。
   */
  const addEdge = (source: string, target: string): void => {
    if (source === target) return
    const id = `e-${source}-${target}`
    if (edgeIds.has(id)) return
    if (reaches(target, source)) return
    edgeIds.add(id)
    adjacency.get(source)!.push(target)
    edges.push({ id, source, target, data: { kind: 'sequence' } })
  }

  const liveKeys = new Set(
    [...document.tasks.values()]
      .filter((e) => e.retired === undefined)
      .map((e) => e.key),
  )

  // 跨 turn 链游标：上一个有存活条目的 turn 的末 key（infer 的「上一非空
  // turn 末 task」移植；空列表 turn 跳过）。
  let prevTurnLastLiveKey: string | undefined

  for (const turn of document.turns) {
    const liveList = turn.finalListKeys.filter((key) => liveKeys.has(key))

    // root → user-prompt（每 turn）。
    if (turn.userPromptRefs.length > 0) addEdge('root', `user-${turn.index}`)

    if (liveList.length > 0) {
      // user-prompt → 本 turn 首任务。
      if (turn.userPromptRefs.length > 0) addEdge(`user-${turn.index}`, taskNodeId(liveList[0]!))
      // 列表内顺序链。
      for (let i = 1; i < liveList.length; i += 1) {
        addEdge(taskNodeId(liveList[i - 1]!), taskNodeId(liveList[i]!))
      }
      // 跨 turn 链：上一非空 turn 末任务 → 本 turn 首任务。
      if (prevTurnLastLiveKey !== undefined) {
        addEdge(taskNodeId(prevTurnLastLiveKey), taskNodeId(liveList[0]!))
      }
      prevTurnLastLiveKey = liveList[liveList.length - 1]
    }
  }

  return { nodes, edges }
}

/**
 * TodoItem wire status → TaskStatus；turn 失败只升级未完成任务
 * （completed 是任务自身的事实，不被篡改——P1 诚实规则）。
 */
function mapStatus(todoStatus: TodoStatusOf, turnFailed: boolean): TaskStatus {
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

/** 首个 text block 的首行（user-prompt 节点 label 来源，infer.ts 移植）。 */
function extractFirstText(event: { data: unknown }): string {
  const content = (event.data as unknown as { content?: readonly unknown[] }).content ?? []
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
