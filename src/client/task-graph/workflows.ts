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
}

/**
 * 事件流 → run 折叠表。只消费四事件；其它事件同引用跳过语义由调用方
 * （connector 的全窗口重放）保证，这里纯折叠。
 */
export function foldWorkflowRuns(
  events: readonly SessionEvent[],
): Map<string, WorkflowRunFold> {
  const runs = new Map<string, WorkflowRunFold>()
  for (const event of events) {
    switch (event.type) {
      case 'tool-workflow/run-start': {
        const data = event.data
        if (!runs.has(data.runId)) {
          runs.set(data.runId, {
            runId: data.runId,
            name: data.name,
            members: new Map(),
            outcomes: new Map(),
          })
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
        if (run) run.stopReason = data.stopReason
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
      },
    })
    edges.push({
      id: `e-root-${runNodeId}`,
      source: 'root',
      target: runNodeId,
      data: { kind: 'workflow' },
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
          data: { kind: 'phase' },
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
            ? summaryStatus(childSummary)
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
        data: { kind: 'workflow' },
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
