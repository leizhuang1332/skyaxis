/**
 * Workflow 视图（P2d）——纯函数模块，镜像 subagents.ts 的模式。
 *
 * 数据源：`tool-workflow/*` 四事件（持久化目录成员 + controller codec 识别；
 * 形状见 tool-workflow.d.ts，提取自 registry tarball 0.1.5-rc.2）。runtime
 * 默认挂载于 standard preset，事件在真实部署里流动。
 *
 * 折叠模型（语义对齐 dist/03 §5，形状按 DSH 事件重写）：
 *   - run 节点 `workflow:{runId}`：run-start 开、run-end 结算；无 run-end → running
 *   - phase 分组条件（dist 的 usePhaseNodes 规则）：distinct 非空 phase ≥ 2
 *     或存在非空 phase → 建 `workflow-phase:{runId}:{phase}` 节点；否则
 *     member 直挂 run。DSH 的 phase 是展示分组，不是脚本控制流——不重建依赖。
 *   - member 节点 `workflow-member:{runId}:{seq}`：status 三级回退
 *     （outcome → 子 session summary → pending）；navigable 走 ids 门控；
 *     metrics 从子 session 的 projectionValues 挂载（零新增订阅）。
 *
 * 乱序防御：agent-end 可能先于其 agent-start 到达（seq 乱序）——settle 表与
 * member 表分离，build 时合并。
 */
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TaskNode, TaskEdge, TaskStatus } from './types.js'
import { summaryStatus } from './subagents.js'
import type { SkyaxisAgentMetrics } from '../../agent-metrics.js'

/** 一个 member 的发现事实（agent-start）。 */
export interface WorkflowMemberFold {
  seq: number
  label: string
  phase?: string
  childId: SessionId
}

/** 一个 run 的折叠快照。 */
export interface WorkflowRunFold {
  runId: string
  name: string
  stopReason?: 'completed' | 'cancelled' | 'error'
  members: Map<number, WorkflowMemberFold>
  /** settle 表：可与 members 分离到达（乱序防御），build 时合并。 */
  outcomes: Map<number, 'completed' | 'failed' | 'cancelled'>
  /** run-start 事件的 seq（定义匹配的时序上界）。 */
  startSeq: number
  /** run-start / run-end 事件的 wall-clock（切片 B：run 时长派生，fact 级）。 */
  startTime?: number
  endTime?: number
  /** attachWorkflowDefinitions 注入（dist/02 §7 移植）；无匹配则缺省。 */
  definition?: WorkflowDefinition
}

/**
 * workflow 工具的调用定义（P3 定义预览）。args 形状提取自 registry tarball
 * dsh-tool-workflow@0.1.5-rc.2：`{ script, meta: { name, description,
 * whenToUse?, phases? } }`；DSH tool/call 的 `arguments` 是其 JSON 字符串。
 */
export interface WorkflowDefinition {
  script: string
  meta: {
    name: string
    description?: string
    phases?: { title: string; detail?: string }[]
  }
  /** tool/call 事件的 seq（匹配时序用）。 */
  callSeq: number
}

/**
 * 事件流 → run 折叠表。只消费四事件；其它事件同引用跳过语义由调用方
 * （connector 的全窗口重放）保证，这里纯折叠。
 */
export function foldWorkflowRuns(
  events: readonly SessionEvent[],
): Map<string, WorkflowRunFold> {
  const runs = new Map<string, WorkflowRunFold>()
  // 按 seq 排序后折叠（对齐 dist foldTeam 的 anchorSeq 排序与任务链折叠的
  // seq 排序）：折叠结果不依赖事件到达顺序（置换不变性，P4 性质测试守护）。
  const sorted = [...events].sort((a, b) => a.seq - b.seq)
  for (const event of sorted) {
    switch (event.type) {
      case 'tool-workflow/run-start': {
        const data = event.data
        const existing = runs.get(data.runId)
        if (existing === undefined) {
          runs.set(data.runId, {
            runId: data.runId,
            name: data.name,
            members: new Map(),
            outcomes: new Map(),
            startSeq: event.seq,
            startTime: event.time,
          })
        } else if (existing.name === '' && data.name !== '') {
          // P4 修正：孤儿 agent-start 先建的空名壳，在真 run-start 到达时
          // 回填 name——否则折叠结果依赖事件到达顺序（置换不变性不成立）。
          existing.name = data.name
          if (existing.startTime === undefined) existing.startTime = event.time
        }
        break
      }
      case 'tool-workflow/agent-start': {
        const data = event.data
        // 孤儿 agent-start（run-start 缺失/被裁剪）→ 补建 run 壳，name 兜底
        const run = runs.get(data.runId) ?? {
          runId: data.runId,
          name: '',
          members: new Map<number, WorkflowMemberFold>(),
          outcomes: new Map<number, 'completed' | 'failed' | 'cancelled'>(),
          startSeq: event.seq,
        }
        runs.set(data.runId, run)
        run.members.set(data.seq, {
          seq: data.seq,
          label: data.label,
          ...(data.phase === undefined ? {} : { phase: data.phase }),
          childId: data.childId,
        })
        break
      }
      case 'tool-workflow/agent-end': {
        const data = event.data
        const run = runs.get(data.runId)
        if (run) run.outcomes.set(data.seq, data.outcome)
        // run 壳缺失时丢弃 settle（无 member 可结算——不臆造节点）
        break
      }
      case 'tool-workflow/run-end': {
        const data = event.data
        const run = runs.get(data.runId)
        if (run) {
          run.stopReason = data.stopReason
          // 重复 run-end 首个胜出（与 stopReason 同策略：endTime 已在场不覆写）。
          if (run.endTime === undefined) run.endTime = event.time
        }
        break
      }
      default:
        break
    }
  }
  return runs
}

/** run 结算 → TaskStatus（无 run-end = 仍在跑）。 */
function runStatus(run: WorkflowRunFold): TaskStatus {
  switch (run.stopReason) {
    case 'completed':
      return 'done'
    case 'error':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    case undefined:
      return 'running'
  }
}

/** member outcome → TaskStatus。 */
function outcomeStatus(outcome: 'completed' | 'failed' | 'cancelled'): TaskStatus {
  return outcome === 'completed' ? 'done' : outcome
}

/** buildWorkflowGraph 的输入。 */
export interface WorkflowGraphInput {
  rootId: SessionId
  runs: ReadonlyMap<string, WorkflowRunFold>
  byId: Readonly<Record<SessionId, SessionSummary>>
  /** host 列表顺序的 session id 集合——navigable 门。 */
  ids: readonly SessionId[]
  fallbackLabels: { run: string; member: string }
  /** SessionIds with a pending approval/question (P2b waiting producer)。 */
  waiting?: ReadonlySet<SessionId>
}

/**
 * run 折叠表 → 图节点/边。命名空间 workflow: / workflow-phase: /
 * workflow-member:，与 root / user-N / todo-* / subagent: 不相交。
 * 排序纪律：run 按 runId、member 按 seq（确定性）。
 */
export function buildWorkflowGraph(input: WorkflowGraphInput): {
  nodes: TaskNode[]
  edges: TaskEdge[]
} {
  const { rootId, runs, byId, ids, fallbackLabels } = input
  const idSet = new Set<SessionId>(ids)
  const nodes: TaskNode[] = []
  const edges: TaskEdge[] = []

  const sortedRuns = [...runs.values()].sort((a, b) => a.runId.localeCompare(b.runId))
  for (const run of sortedRuns) {
    const runNodeId = `workflow:${run.runId}`
    nodes.push({
      id: runNodeId,
      type: 'workflow',
      position: { x: 0, y: 0 },
      data: {
        label: run.name || fallbackLabels.run,
        status: runStatus(run),
        // run 节点不可导航（定义详情未做前点击无意义，ADR 范围裁定）
        navigable: false,
        ...(run.definition === undefined ? {} : { definition: run.definition }),
        ...(run.startTime !== undefined && run.endTime !== undefined
          ? { durationMs: run.endTime - run.startTime }
          : {}),
      },
    })
    edges.push({
      id: `e-root-${runNodeId}`,
      source: 'root',
      target: runNodeId,
      // 归属来自 wire 事件（run-start 的 runId）——fact。
      data: { kind: 'workflow', evidence: 'fact' },
    })

    const members = [...run.members.values()].sort((a, b) => a.seq - b.seq)

    // phase 分组条件（dist usePhaseNodes 的 DSH 映射）：dist 的条件是
    // "分组数 > 1 或存在非空 phase 名"；DSH 事件没有无名分组概念（无 phase
    // 的 member 直挂 run），所以等价于"存在至少一个非空 phase 名"。
    const phaseNames = new Set(members.map((m) => m.phase).filter((p): p is string => p !== undefined && p !== ''))
    const usePhaseNodes = phaseNames.size >= 1

    // phase 节点（按名排序保证确定性）
    const phaseNodeIds = new Map<string, string>()
    if (usePhaseNodes) {
      for (const phase of [...phaseNames].sort()) {
        const phaseNodeId = `workflow-phase:${run.runId}:${phase}`
        phaseNodeIds.set(phase, phaseNodeId)
        nodes.push({
          id: phaseNodeId,
          type: 'workflow-phase',
          position: { x: 0, y: 0 },
          data: { label: phase, status: 'pending', navigable: false },
        })
        edges.push({
          id: `e-${runNodeId}-${phaseNodeId}`,
          source: runNodeId,
          target: phaseNodeId,
          data: { kind: 'phase', evidence: 'fact' },
        })
      }
    }

    for (const member of members) {
      const memberNodeId = `workflow-member:${run.runId}:${member.seq}`
      const outcome = run.outcomes.get(member.seq)
      const childSummary = byId[member.childId]
      // status 三级回退：outcome → 子 session summary → pending
      const status: TaskStatus =
        outcome !== undefined
          ? outcomeStatus(outcome)
          : childSummary !== undefined
            ? summaryStatus(childSummary, input.waiting?.has(member.childId) ?? false)
            : 'pending'
      const metrics: SkyaxisAgentMetrics | undefined =
        childSummary?.projectionValues?.skyaxisAgentMetrics ?? undefined
      const parentId =
        member.phase !== undefined && member.phase !== '' && phaseNodeIds.has(member.phase)
          ? phaseNodeIds.get(member.phase)!
          : runNodeId
      nodes.push({
        id: memberNodeId,
        type: 'workflow-member',
        position: { x: 0, y: 0 },
        data: {
          label: member.label || fallbackLabels.member,
          status,
          navigable: idSet.has(member.childId),
          navigationId: String(member.childId),
          ...(metrics === undefined ? {} : { metrics }),
        },
      })
      edges.push({
        id: `e-${parentId}-${memberNodeId}`,
        source: parentId,
        target: memberNodeId,
        // agent-start 的 runId/seq 归属 = wire 事实。
        data: { kind: 'workflow', evidence: 'fact' },
      })
    }
  }
  return { nodes, edges }
}

/**
 * workflow 部分的变更签名：run 结算状态 + member settle 集合的确定性序列。
 * connector 追加进整体签名，run/member 结算时触发重推。
 */
export function workflowSignature(runs: ReadonlyMap<string, WorkflowRunFold>): string {
  const parts: string[] = []
  for (const run of [...runs.values()].sort((a, b) => a.runId.localeCompare(b.runId))) {
    const settles = [...run.outcomes.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([seq, outcome]) => `${seq}:${outcome}`)
      .join(',')
    parts.push(`${run.runId}@${run.stopReason ?? 'live'}[${settles}]`)
  }
  return parts.join('|')
}

/**
 * 从 tool/call 事件提取 workflow 定义（P3）。诚实规则：JSON 解析失败、
 * 缺 script 字符串、缺非空 meta.name → 跳过（不臆造）。DSH 的 tool/call
 * payload：`{ turn, step, callId, name, arguments: string(JSON) }`。
 */
export function extractWorkflowDefinitions(events: readonly SessionEvent[]): WorkflowDefinition[] {
  const definitions: WorkflowDefinition[] = []
  for (const event of events) {
    if (event.type !== 'tool/call') continue
    if (event.data.name !== 'workflow') continue
    const raw = event.data.arguments
    if (typeof raw !== 'string') continue
    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue // 坏 JSON → 跳过，不臆造
    }
    if (parsed === null || typeof parsed !== 'object') continue
    const args = parsed as { script?: unknown; meta?: unknown }
    if (typeof args.script !== 'string') continue
    if (args.meta === null || typeof args.meta !== 'object') continue
    const meta = args.meta as {
      name?: unknown
      description?: unknown
      phases?: unknown
    }
    if (typeof meta.name !== 'string' || meta.name.trim() === '') continue
    const phases = Array.isArray(meta.phases)
      ? meta.phases
          .filter(
            (p): p is { title?: unknown; detail?: unknown } =>
              p !== null && typeof p === 'object',
          )
          .filter((p) => typeof p.title === 'string' && p.title !== '')
          .map((p) => ({
            title: p.title as string,
            ...(typeof p.detail === 'string' ? { detail: p.detail } : {}),
          }))
      : undefined
    definitions.push({
      script: args.script,
      meta: {
        name: meta.name,
        ...(typeof meta.description === 'string' ? { description: meta.description } : {}),
        ...(phases === undefined ? {} : { phases }),
      },
      callSeq: event.seq,
    })
  }
  return definitions
}

/**
 * 定义 ↔ run 匹配（dist/02 §7 算法的 DSH 移植）：按 callSeq 升序，每个 run
 * 取 callSeq ≤ run.startSeq、meta.name === run.name、未被占用的最早定义。
 * 返回新 Map（runs 不可变语义），definition 注入副本。
 */
export function attachWorkflowDefinitions(
  runs: ReadonlyMap<string, WorkflowRunFold>,
  definitions: readonly WorkflowDefinition[],
): Map<string, WorkflowRunFold> {
  const sorted = [...definitions].sort((a, b) => a.callSeq - b.callSeq)
  const taken = new Set<WorkflowDefinition>()
  const attached = new Map<string, WorkflowRunFold>()
  for (const [runId, run] of [...runs.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const match = sorted.find(
      (d) => !taken.has(d) && d.callSeq <= run.startSeq && d.meta.name === run.name,
    )
    if (match !== undefined) taken.add(match)
    attached.set(runId, match === undefined ? run : { ...run, definition: match })
  }
  return attached
}

/**
 * 视图层 opt-in 过滤（P2d 用户裁定）：同 run 内与某个**非 failed** member
 * 同 (label, phase)、且自身 outcome=failed 的 member 节点及其连边移除。
 * 并行同名不受影响（它们都不是 failed）。返回新数组，不改入参。
 * 诚实标注由视图 label 文案承担（"同名"启发式，默认关）。
 */
export function filterFailedAttempts(
  nodes: readonly TaskNode[],
  edges: readonly TaskEdge[],
): { nodes: TaskNode[]; edges: TaskEdge[] } {
  // member 节点 id 形如 workflow-member:{runId}:{seq}
  const memberInfo = new Map<string, { runId: string; label: string; failed: boolean }>()
  for (const n of nodes) {
    if (n.type !== 'workflow-member') continue
    const prefix = 'workflow-member:'
    const rest = n.id.slice(prefix.length)
    const cut = rest.lastIndexOf(':')
    if (cut < 0) continue
    memberInfo.set(n.id, {
      runId: rest.slice(0, cut),
      label: n.data.label,
      failed: n.data.status === 'failed',
    })
  }
  // 每个 run 内非 failed 的 label 集合
  const survivingLabels = new Map<string, Set<string>>()
  for (const info of memberInfo.values()) {
    if (!info.failed) {
      const set = survivingLabels.get(info.runId) ?? new Set<string>()
      set.add(info.label)
      survivingLabels.set(info.runId, set)
    }
  }
  const removed = new Set<string>()
  for (const [id, info] of memberInfo) {
    if (info.failed && survivingLabels.get(info.runId)?.has(info.label)) {
      removed.add(id)
    }
  }
  return {
    nodes: nodes.filter((n) => !removed.has(n.id)),
    edges: edges.filter((e) => !removed.has(e.source) && !removed.has(e.target)),
  }
}
