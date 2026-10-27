/**
 * 视图策略（v0.4 切片 C，ADR 0036 §2.4）：store 全量图 → 按策略过滤/折叠。
 *
 * 架构（超集原则）：task-chain 恒发活动节点全量，本模块在视图侧应用
 * { hideFailed（P3 收编）, activityDetail 三档, collapseCompletedTurns,
 * collapsedSubtrees }——折叠状态是纯视图态，切换零延迟、不回连 connector。
 *
 * 折叠走聚合节点方案（ADR 0036 拍板）：已完成轮次折成单 `turns:completed`
 * 节点（error/aborted 轮不折——卡点永远可见）；子代理子树折成根节点+徽标
 * （后代状态计数——ADR 0001 §七.1 的「X running / Y done / Z failed」欠账）。
 * 全程保持：边 id 全局唯一（React Flow 硬约束）、构造性无环（delegation 只
 * 向下、聚合只指向 task/activity，结构性安全）、确定性输出。
 */
import type { SessionDocument } from '../document/types.js'
import type { TaskNode, TaskEdge, TaskStatus, TaskEdgeEvidence } from '../types.js'
import { filterFailedAttempts } from '../workflows.js'
import { activityNodeId } from './task-chain.js'

/** 详略三档：none=B 现状默认；notable=卡点（错误工具+审批+委派）；all=全量。 */
export type ActivityDetail = 'none' | 'notable' | 'all'

export interface ViewPolicyOptions {
  /** P3 既有开关（收编统一管理）：隐藏同 run 同名失败 workflow member。 */
  hideFailed: boolean
  activityDetail: ActivityDetail
  /** 折叠所有「已收场且 completed」的轮次为单聚合节点。 */
  collapseCompletedTurns: boolean
  /** 折叠的子代理子树根（session id 集，逐节点）。 */
  collapsedSubtrees: ReadonlySet<string>
  /** 聚合节点 label（i18n，由视图注入——本模块保持纯函数）。 */
  turnsAggregateLabel?: string
}

const TURNS_AGGREGATE_ID = 'turns:completed'

export function applyViewPolicy(
  nodes: readonly TaskNode[],
  edges: readonly TaskEdge[],
  document: SessionDocument,
  options: ViewPolicyOptions,
): { nodes: TaskNode[]; edges: TaskEdge[] } {
  // 1. hideFailed（P3 收编，行为等价——对 workflow member 生效）。
  const afterHide = options.hideFailed
    ? filterFailedAttempts(nodes, edges)
    : { nodes: [...nodes], edges: [...edges] }

  // 2. activityDetail 三档过滤（按文档 turn 重建保留活动的链——断链不悬空，
  //    顺序来自文档 key 序而非边的残余拓扑）。
  const afterActivities = applyActivityDetail(
    afterHide.nodes,
    afterHide.edges,
    document,
    options.activityDetail,
  )

  // 3. 折叠已完成轮次（边重缝到聚合节点，去重）。
  const afterTurns = options.collapseCompletedTurns
    ? collapseCompletedTurns(
        afterActivities.nodes,
        afterActivities.edges,
        document,
        options.turnsAggregateLabel,
      )
    : afterActivities

  // 4. 子树折叠（逐节点；BFS 传递闭包跟 delegation 边不跟类型，徽标按各自
  //    子树计数——多子树同时折叠不串数）。
  return collapseSubtrees(afterTurns.nodes, afterTurns.edges, options.collapsedSubtrees)
}

/** notable 判定：错误工具 / 审批 / 委派（卡点 elevation）。 */
function isNotable(document: SessionDocument, activityKey: string | undefined): boolean {
  if (activityKey === undefined) return false
  const activity = document.activities.get(activityKey)
  if (activity === undefined) return false
  if (activity.kind === 'approval') return true
  if (activity.kind === 'tool-call') {
    return activity.result?.isError === true || activity.spawn !== undefined
  }
  return false
}

function applyActivityDetail(
  nodes: readonly TaskNode[],
  edges: readonly TaskEdge[],
  document: SessionDocument,
  detail: ActivityDetail,
): { nodes: TaskNode[]; edges: TaskEdge[] } {
  if (detail === 'all') return { nodes: [...nodes], edges: [...edges] }

  // none：活动全下；notable：仅卡点（错误工具/审批/委派）。非活动节点不动。
  const keptNodes = nodes.filter(
    (node) =>
      node.type !== 'activity' ||
      (detail === 'notable' && isNotable(document, node.data.activityKey)),
  )
  const keptIds = new Set(keptNodes.map((n) => n.id))

  // 保留既有边中两端皆存活的（task/subagent/workflow 域不受影响）；
  // 活动链按文档 turn 重建（丢弃端点的旧活动边整段失效）。
  const keptEdges = edges.filter((e) => keptIds.has(e.source) && keptIds.has(e.target))
  const edgeIds = new Set(keptEdges.map((e) => e.id))
  const chainEdges: TaskEdge[] = []
  const addChainEdge = (source: string, target: string, evidence: TaskEdgeEvidence): void => {
    const id = `e-${source}-${target}`
    if (source === target || edgeIds.has(id)) return
    edgeIds.add(id)
    chainEdges.push({ id, source, target, data: { kind: 'sequence', evidence } })
  }

  if (detail === 'notable') {
    for (const turn of document.turns) {
      const keptActivityIds = turn.activityKeys
        .map((key) => activityNodeId(key))
        .filter((id) => keptIds.has(id))
      if (keptActivityIds.length === 0) continue
      const anchor =
        turn.userPromptRefs.length > 0 && keptIds.has(`user-${turn.index}`)
          ? `user-${turn.index}`
          : 'root'
      let prev: string | undefined
      for (const id of keptActivityIds) {
        if (prev === undefined) {
          // evidence 沿 task-chain 同规则：approval=inferred（环境计数）、其余 fact。
          const activity = document.activities.get(`act:${id.slice('activity:'.length)}`)
          addChainEdge(
            anchor,
            id,
            activity !== undefined && activity.kind === 'approval' ? 'inferred' : 'fact',
          )
        } else {
          addChainEdge(prev, id, 'inferred')
        }
        prev = id
      }
    }
  }

  return { nodes: keptNodes, edges: [...keptEdges, ...chainEdges] }
}

function collapseCompletedTurns(
  nodes: readonly TaskNode[],
  edges: readonly TaskEdge[],
  document: SessionDocument,
  label: string | undefined,
): { nodes: TaskNode[]; edges: TaskEdge[] } {
  // 资格：已收场且 reason=completed、prompt 节点在图上（error/aborted/未收场不折）。
  const foldableIds = new Set(
    document.turns
      .filter((t) => t.endReason?.kind === 'completed' && t.userPromptRefs.length > 0)
      .map((t) => `user-${t.index}`),
  )
  const present = new Set(nodes.map((n) => n.id))
  for (const id of [...foldableIds]) {
    if (!present.has(id)) foldableIds.delete(id)
  }
  if (foldableIds.size === 0) return { nodes: [...nodes], edges: [...edges] }

  let totalDurationMs = 0
  let hasDuration = false
  for (const turn of document.turns) {
    if (!foldableIds.has(`user-${turn.index}`)) continue
    if (turn.startTime !== undefined && turn.endTime !== undefined) {
      totalDurationMs += turn.endTime - turn.startTime
      hasDuration = true
    }
  }

  const aggregate: TaskNode = {
    id: TURNS_AGGREGATE_ID,
    type: 'turns-aggregate',
    position: { x: 0, y: 0 },
    data: {
      label: label ?? 'Completed turns',
      aggregate: {
        kind: 'turns',
        count: foldableIds.size,
        ...(hasDuration ? { totalDurationMs } : {}),
      },
    },
  }

  const outNodes = nodes.filter((n) => !foldableIds.has(n.id))
  outNodes.push(aggregate)

  // 边重缝：折叠端点统一映射到聚合节点；去重 + 自环跳过（结构性无环：
  // 聚合只接 root 入边、指向 task/activity 的出边，不构成回环）。
  const outEdges: TaskEdge[] = []
  const edgeIds = new Set<string>()
  for (const e of edges) {
    const source = foldableIds.has(e.source) ? TURNS_AGGREGATE_ID : e.source
    const target = foldableIds.has(e.target) ? TURNS_AGGREGATE_ID : e.target
    if (source === target) continue
    const id = `e-${source}-${target}`
    if (edgeIds.has(id)) continue
    edgeIds.add(id)
    outEdges.push(e.source === source && e.target === target ? e : { ...e, id, source, target })
  }

  return { nodes: outNodes, edges: outEdges }
}

function collapseSubtrees(
  nodes: readonly TaskNode[],
  edges: readonly TaskEdge[],
  collapsedSubtrees: ReadonlySet<string>,
): { nodes: TaskNode[]; edges: TaskEdge[] } {
  if (collapsedSubtrees.size === 0) return { nodes: [...nodes], edges: [...edges] }

  // delegation 边的 parent→child 邻接（跟边不跟类型：member 再父化后代含在内）。
  const children = new Map<string, string[]>()
  for (const e of edges) {
    if (e.data?.kind !== 'delegation') continue
    const list = children.get(e.source) ?? []
    list.push(e.target)
    children.set(e.source, list)
  }

  // 各折叠根**各自**的后代闭包（不并池——多子树徽标不串数）。
  const dropped = new Set<string>()
  const rootToDescendants = new Map<string, Set<string>>()
  for (const n of nodes) {
    if (n.type !== 'subagent') continue
    const sessionId = n.data.navigationId
    if (sessionId === undefined || !collapsedSubtrees.has(sessionId)) continue
    const descendants = new Set<string>()
    const queue = [...(children.get(n.id) ?? [])]
    while (queue.length > 0) {
      const id = queue.shift()!
      if (descendants.has(id)) continue
      descendants.add(id)
      queue.push(...(children.get(id) ?? []))
    }
    rootToDescendants.set(n.id, descendants)
    for (const id of descendants) dropped.add(id)
  }
  if (rootToDescendants.size === 0) return { nodes: [...nodes], edges: [...edges] }

  // 后代状态计数 → 徽标挂根（ADR 0001 §七.1 欠账：X running / Y done / Z failed）。
  const statusById = new Map(nodes.map((n) => [n.id, n.data.status] as const))
  const countStatuses = (ids: ReadonlySet<string>): { count: number; statuses: Partial<Record<TaskStatus, number>> } => {
    const statuses: Partial<Record<TaskStatus, number>> = {}
    let count = 0
    for (const id of ids) {
      const s = statusById.get(id)
      if (s === undefined) continue
      statuses[s] = (statuses[s] ?? 0) + 1
      count += 1
    }
    return { count, statuses }
  }

  const outNodes: TaskNode[] = []
  for (const n of nodes) {
    if (dropped.has(n.id)) continue
    const descendants = rootToDescendants.get(n.id)
    if (descendants === undefined) {
      outNodes.push(n)
      continue
    }
    const { count, statuses } = countStatuses(descendants)
    outNodes.push({
      ...n,
      data: { ...n.data, aggregate: { kind: 'subtree', count, statuses } },
    })
  }

  const outEdges = edges.filter((e) => !dropped.has(e.source) && !dropped.has(e.target))
  return { nodes: outNodes, edges: outEdges }
}
