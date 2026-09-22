/**
 * Subagent 血缘视图（P2a）——纯函数模块。
 *
 * 数据源：`sessions.list` 快照（connector 已订阅，零新增订阅）：
 *   - 血缘：`byId[id].{ parentId?, origin?: 'subagent', running, completed?, displayTitle }`
 *   - 目录：`subagentsByParent[parent].entries[]`（childId → label 元数据；
 *     continuable 必有 label，one-shot 可缺省）
 *   - 导航门：`ids`（诚实规则：不在列表里的 session 不假装能打开）
 *
 * 设计对齐参考插件 task-dag-viewer：
 *   - `lineageDepths` 是 dist/03 §7 的 TS 移植（孤儿拒绝、环整圈拒绝、
 *     非 subagent origin 拒绝；invalid 集合累计复用）。
 *   - 节点 id 用 `subagent:` 前缀（与 root / user-N / todo-* 命名空间不相交）。
 *   - delegation 边来自 parentId 结构关系，且 lineageDepths 已拒绝环——
 *     **构造上无环**，因此 P2a 不需要 dist/05 的 SCC 压平机器（那是为
 *     dependency / team 这类非结构边准备的，P2c 再引入）。
 *
 * 投影边界（dist/01 原则 2）：subagent 节点的 label / 状态来自 list 投影；
 * 子 session **内部**的任务图不在本视图重建——它的详情在自己的 session 里。
 */
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TaskNode, TaskEdge, TaskStatus } from './types.js'

/** catalog 条目的结构兼容最小接口（防御性读取，不 import dsh-subagent 类型）。 */
interface CatalogEntryLike {
  readonly id: SessionId
  readonly label?: string
}

/** catalog 快照的结构兼容最小接口。 */
interface CatalogLike {
  readonly entries?: readonly CatalogEntryLike[]
}

/**
 * 从 root 出发按 parentId 爬血缘，返回 Map<sessionId, depth>（root=0，直接子=1）。
 *
 * 拒绝（不进 depths，从而不出现在图里）：
 *   - `origin !== 'subagent'`（手动创建等非子代理血缘）
 *   - `parentId` 缺失（孤儿）或父在 byId 里找不到
 *   - 单轮 walk 内重访（父子环）——**整条 trail 全部拒绝**，杜绝半环进图
 * 遇到已算出深度的祖先则复用其深度（链式加速）。
 */
export function lineageDepths(
  rootId: SessionId,
  byId: Readonly<Record<SessionId, SessionSummary>>,
): Map<SessionId, number> {
  const depths = new Map<SessionId, number>([[rootId, 0]])
  const invalid = new Set<SessionId>()
  for (const start of Object.values(byId)) {
    if (start.id === rootId || depths.has(start.id) || invalid.has(start.id)) continue
    const trail: SessionSummary[] = []
    const seen = new Set<SessionId>()
    let current: SessionSummary | undefined = start
    let baseDepth: number | undefined
    while (true) {
      if (current === undefined) {
        baseDepth = undefined // 父 id 在 byId 里找不到
        break
      }
      if (depths.has(current.id)) {
        baseDepth = depths.get(current.id)
        break
      }
      if (
        invalid.has(current.id)
        || seen.has(current.id)
        || current.origin !== 'subagent'
        || current.parentId === undefined
      ) {
        baseDepth = undefined
        break
      }
      seen.add(current.id)
      trail.push(current)
      if (current.parentId === rootId) {
        baseDepth = 0
        break
      }
      current = byId[current.parentId]
    }
    if (baseDepth === undefined) {
      for (const node of trail) invalid.add(node.id)
      continue
    }
    let depth = baseDepth
    for (let index = trail.length - 1; index >= 0; index -= 1) {
      depth += 1
      depths.set(trail[index]!.id, depth)
    }
  }
  return depths
}

/** SessionSummary → TaskStatus 的诚实映射（root 与 subagent 节点共用）。 */
export function summaryStatus(summary: SessionSummary): TaskStatus {
  return summary.running ? 'running' : summary.completed ? 'done' : 'pending'
}

/** buildSubagentGraph 的输入（全部来自 sessions.list 快照）。 */
export interface SubagentGraphInput {
  rootId: SessionId
  byId: Readonly<Record<SessionId, SessionSummary>>
  subagentsByParent: Readonly<Record<SessionId, CatalogLike>>
  /** host 列表顺序的 session id 集合——navigable 门。 */
  ids: readonly SessionId[]
  /** label 三级回退的最终兜底（i18n 文案）。 */
  fallbackLabel: string
}

/**
 * 构建 subagent 子树图：membership = lineageDepths 键集（不含 root）。
 *
 * label 回退链：catalog label → displayTitle → fallbackLabel。
 * 边：root → 直接子；`subagent:{parent}` → `subagent:{child}`（更深层），
 * kind = 'delegation'。节点数组按 (depth, id) 排序保证确定性。
 */
export function buildSubagentGraph(input: SubagentGraphInput): {
  nodes: TaskNode[]
  edges: TaskEdge[]
} {
  const { rootId, byId, subagentsByParent, ids, fallbackLabel } = input
  const depths = lineageDepths(rootId, byId)
  const idSet = new Set<SessionId>(ids)

  // catalog 索引：childId → label（跨 parent 扁平化；空 label 不覆盖）。
  const labelById = new Map<SessionId, string>()
  for (const catalog of Object.values(subagentsByParent)) {
    for (const entry of catalog.entries ?? []) {
      if (typeof entry.label === 'string' && entry.label !== '') {
        labelById.set(entry.id, entry.label)
      }
    }
  }

  const descendants = [...depths.entries()]
    .filter(([id]) => id !== rootId)
    .sort(
      (left, right) =>
        left[1] - right[1] || String(left[0]).localeCompare(String(right[0])),
    )

  const nodes: TaskNode[] = []
  const edges: TaskEdge[] = []
  for (const [id] of descendants) {
    const summary = byId[id]
    if (summary === undefined) continue // depths 键来自 byId，防御性兜底
    const nodeId = `subagent:${String(id)}`
    // depth ≥ 1 ⇒ parentId 必有值（lineageDepths 的进入条件）
    const parentId = summary.parentId!
    const from = parentId === rootId ? 'root' : `subagent:${String(parentId)}`
    nodes.push({
      id: nodeId,
      type: 'subagent',
      position: { x: 0, y: 0 },
      data: {
        label: labelById.get(id) || summary.displayTitle || fallbackLabel,
        status: summaryStatus(summary),
        navigable: idSet.has(id),
        navigationId: String(id),
      },
    })
    edges.push({
      id: `e-${from}-${nodeId}`,
      source: from,
      target: nodeId,
      data: { kind: 'delegation' },
    })
  }
  return { nodes, edges }
}

/**
 * subagent 子树的变更签名：后代 (id, label, running, completed) 的确定性序列。
 * connector 用它判断"同 current 但子树变了"是否需要重推（新 subagent 诞生 /
 * 子树状态翻转都覆盖），避免在任意 list 通知上全量重推。
 */
export function subagentSignature(
  rootId: SessionId,
  byId: Readonly<Record<SessionId, SessionSummary>>,
): string {
  const depths = lineageDepths(rootId, byId)
  const parts: string[] = []
  for (const [id, depth] of [...depths.entries()].sort(
    (left, right) =>
      left[1] - right[1] || String(left[0]).localeCompare(String(right[0])),
  )) {
    if (id === rootId) continue
    const summary = byId[id]
    parts.push(
      `${String(id)}@${depth}:${summary?.displayTitle ?? ''}:${
        summary?.running ? 'r' : '-'
      }:${summary?.completed ? 'c' : '-'}`,
    )
  }
  return parts.join('|')
}
