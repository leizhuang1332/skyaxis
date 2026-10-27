/**
 * 视图策略测试（v0.4 切片 C）：applyViewPolicy 纯函数。
 *
 * 钉三项架构裁定的行为面：详略三档（none/notable 卡点/all）、已完成轮次
 * 折叠（聚合节点+徽标+边重缝；error/aborted 不折）、子树折叠（传递闭包+
 * 各自徽标计数+member 再父化后代含在内）。全程断言边 id 唯一与无环。
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { foldSessionDocument } from '../../../src/client/task-graph/document/fold.js'
import { projectTaskChain } from '../../../src/client/task-graph/projections/task-chain.js'
import { applyViewPolicy } from '../../../src/client/task-graph/projections/view-policy.js'
import type { ActivityDetail } from '../../../src/client/task-graph/projections/view-policy.js'
import type { TaskNode, TaskEdge } from '../../../src/client/task-graph/types.js'

function ev<T extends SessionEvent['type']>(
  seq: number,
  type: T,
  data: SessionEvent<T>['data'],
): SessionEvent {
  return { type, seq: seq as never, time: seq * 1000, data } as SessionEvent
}

const turnStart = (seq: number, turn: number): SessionEvent => ev(seq, 'turn/start', { turn })
const turnEnd = (seq: number, turn: number, kind: string): SessionEvent =>
  ev(seq, 'turn/end', { turn, reason: { kind } as never })
const userMessage = (seq: number, text: string): SessionEvent =>
  ev(seq, 'user/message', {
    id: `u${seq}` as never,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  } as never)
const todoWrite = (
  seq: number,
  todos: readonly { content: string; status: string }[],
): SessionEvent => ev(seq, 'todo/write', { todos } as never)
const toolCall = (seq: number, turn: number, callId: string, name: string): SessionEvent =>
  ev(seq, 'tool/call', { turn, step: 1, callId, name, arguments: '{}' } as never)
const toolResult = (
  seq: number,
  turn: number,
  callId: string,
  opts: { isError?: boolean; text?: string } = {},
): SessionEvent =>
  ev(seq, 'tool/result', {
    turn,
    step: 1,
    message: {
      id: `tr${seq}` as never,
      role: 'tool',
      content: [{ type: 'text', text: opts.text ?? 'ok' }],
      source: { kind: 'tool', callId },
      toolCallId: callId,
      ...(opts.isError === true ? { isError: true } : {}),
    },
    ...(opts.isError === true ? { error: { name: 'E', code: 'X' } } : {}),
  } as never)
const approvalAsked = (seq: number, id: string): SessionEvent =>
  ev(seq, 'approval/asked', { id, toolName: 'bash' } as never)
const catalogEvent = (seq: number, childId: string): SessionEvent =>
  ev(seq, 'subagent/catalog', { childId, childCreatedAt: 0, version: 0, mode: 'one-shot' } as never)

const OFF: {
  hideFailed: boolean
  activityDetail: ActivityDetail
  collapseCompletedTurns: boolean
  collapsedSubtrees: ReadonlySet<string>
} = {
  hideFailed: false,
  activityDetail: 'none',
  collapseCompletedTurns: false,
  collapsedSubtrees: new Set<string>(),
}

function graphOf(events: readonly SessionEvent[]) {
  const document = foldSessionDocument({
    sessionId: 's1' as SessionId,
    events,
    hasMore: false,
    label: 'S1',
    rootStatus: 'running',
  })
  return { document, graph: projectTaskChain(document) }
}

function policy(
  events: readonly SessionEvent[],
  overrides: Partial<typeof OFF> = {},
  extraNodes: TaskNode[] = [],
  extraEdges: TaskEdge[] = [],
) {
  const { document, graph } = graphOf(events)
  const nodes = [...graph.nodes, ...extraNodes]
  const edges = [...graph.edges, ...extraEdges]
  return {
    document,
    full: { nodes, edges },
    result: applyViewPolicy(nodes, edges, document, { ...OFF, ...overrides }),
  }
}

const expectUniqueEdgeIds = (edges: readonly { id: string }[]): void => {
  expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length)
}

const assertAcyclic = (
  nodes: readonly { id: string }[],
  edges: readonly { source: string; target: string }[],
): void => {
  const ids = new Set(nodes.map((n) => n.id))
  for (const e of edges) expect(e.source).not.toBe(e.target)
  const indegree = new Map<string, number>()
  const outgoing = new Map<string, string[]>()
  for (const id of ids) {
    indegree.set(id, 0)
    outgoing.set(id, [])
  }
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue
    outgoing.get(e.source)!.push(e.target)
    indegree.set(e.target, (indegree.get(e.target) ?? 0) + 1)
  }
  const queue = [...ids].filter((id) => indegree.get(id) === 0)
  let consumed = 0
  while (queue.length > 0) {
    const id = queue.shift()!
    consumed += 1
    for (const t of outgoing.get(id) ?? []) {
      const next = (indegree.get(t) ?? 0) - 1
      indegree.set(t, next)
      if (next === 0) queue.push(t)
    }
  }
  expect(consumed).toBe(ids.size)
}

describe('applyViewPolicy — activityDetail 三档', () => {
  const events = [
    userMessage(1, 'go'),
    turnStart(2, 1),
    toolCall(3, 1, 'c1', 'read'),
    toolResult(4, 1, 'c1'),
    toolCall(5, 1, 'c2', 'bash'),
    toolResult(6, 1, 'c2', { isError: true, text: 'exit 1' }),
    approvalAsked(7, 'a1'),
  ]

  it('full graph carries every activity node (superset principle)', () => {
    const { graph } = graphOf(events)
    const activities = graph.nodes.filter((n) => n.type === 'activity')
    expect(activities).toHaveLength(3)
    // 状态派生：done / failed / waiting。
    const statuses = activities.map((n) => n.data.status).sort()
    expect(statuses).toEqual(['done', 'failed', 'waiting'])
    // prompt→activity 边 evidence：tool=fact、approval=inferred；链边 inferred。
    const toActivity = graph.edges.filter((e) => e.target.startsWith('activity:'))
    expect(toActivity.find((e) => e.target === 'activity:7')!.data?.evidence).toBe('inferred')
    expect(toActivity.find((e) => e.target === 'activity:3')!.data?.evidence).toBe('fact')
  })

  it('none drops all activity nodes and their edges (B-equivalent default)', () => {
    const { result } = policy(events)
    expect(result.nodes.some((n) => n.type === 'activity')).toBe(false)
    expect(result.edges.every((e) => !e.source.startsWith('activity:') && !e.target.startsWith('activity:'))).toBe(true)
    expectUniqueEdgeIds(result.edges)
  })

  it('notable keeps error tools + approvals (and restitches the chain)', () => {
    const { result } = policy(events, { activityDetail: 'notable' })
    const kept = result.nodes.filter((n) => n.type === 'activity')
    expect(kept.map((n) => n.id).sort()).toEqual(['activity:5', 'activity:7'])
    // 链重缝：user-1 → activity:5 → activity:7（activity:3 被丢，链不断）。
    expect(result.edges.find((e) => e.source === 'user-1' && e.target === 'activity:5')).toBeTruthy()
    expect(result.edges.find((e) => e.source === 'activity:5' && e.target === 'activity:7')).toBeTruthy()
    expectUniqueEdgeIds(result.edges)
    assertAcyclic(result.nodes, result.edges)
  })

  it('all keeps everything as-is', () => {
    const { full, result } = policy(events, { activityDetail: 'all' })
    expect(result.nodes).toHaveLength(full.nodes.length)
    expect(result.edges).toHaveLength(full.edges.length)
  })
})

describe('applyViewPolicy — collapseCompletedTurns', () => {
  const events = [
    userMessage(1, 'turn1'),
    turnEnd(2, 1, 'completed'),
    userMessage(3, 'turn2'),
    turnEnd(4, 2, 'error'),
    userMessage(5, 'turn3'),
    turnEnd(6, 3, 'completed'),
    userMessage(7, 'turn4'), // 未收场
  ]

  it('folds completed turns into one aggregate with badge; error/open turns stay', () => {
    const { result } = policy(events, {
      collapseCompletedTurns: true,
      activityDetail: 'all',
    })
    const agg = result.nodes.find((n) => n.id === 'turns:completed')
    expect(agg).toBeTruthy()
    expect(agg!.data.aggregate).toEqual({ kind: 'turns', count: 2 })
    expect(result.nodes.some((n) => n.id === 'user-1')).toBe(false)
    expect(result.nodes.some((n) => n.id === 'user-3')).toBe(false)
    // error 轮与未收场轮不折。
    expect(result.nodes.some((n) => n.id === 'user-2')).toBe(true)
    expect(result.nodes.some((n) => n.id === 'user-4')).toBe(true)
    // root → 聚合（两条 root→prompt 折为一条）。
    const rootToAgg = result.edges.filter((e) => e.source === 'root' && e.target === 'turns:completed')
    expect(rootToAgg).toHaveLength(1)
    expectUniqueEdgeIds(result.edges)
    assertAcyclic(result.nodes, result.edges)
  })

  it('sums turn durations into the badge when both bounds exist', () => {
    // 注意环境计数：user/message 先于 turn/start（自增后同轮），否则 prompt 落下一轮。
    const withStarts = [
      userMessage(1, 'a'),
      turnStart(2, 1),
      turnEnd(30, 1, 'completed'),
      userMessage(31, 'b'),
      turnStart(32, 2),
      turnEnd(60, 2, 'completed'),
    ]
    const { result } = policy(withStarts, { collapseCompletedTurns: true, activityDetail: 'all' })
    const agg = result.nodes.find((n) => n.id === 'turns:completed')!
    // (30-2)s + (60-32)s = 56s。
    expect(agg.data.aggregate).toEqual({ kind: 'turns', count: 2, totalDurationMs: 56_000 })
  })

  it('is a no-op when no completed turn has a prompt on the canvas', () => {
    const { full, result } = policy([userMessage(1, 'only')], { collapseCompletedTurns: true, activityDetail: 'all' })
    expect(result.nodes).toHaveLength(full.nodes.length)
    expect(result.nodes.some((n) => n.id === 'turns:completed')).toBe(false)
  })
})

describe('applyViewPolicy — collapsedSubtrees', () => {
  const subNode = (id: string, status: TaskNode['data']['status']): TaskNode => ({
    id: `subagent:${id}`,
    type: 'subagent',
    position: { x: 0, y: 0 },
    data: { label: id, status, navigable: true, navigationId: id },
  })
  const delegation = (from: string, to: string): TaskEdge => ({
    id: `e-subagent:${from}-subagent:${to}`,
    source: `subagent:${from}`,
    target: `subagent:${to}`,
    data: { kind: 'delegation', evidence: 'fact' },
  })
  const rootEdge = (to: string): TaskEdge => ({
    id: `e-root-subagent:${to}`,
    source: 'root',
    target: `subagent:${to}`,
    data: { kind: 'delegation', evidence: 'fact' },
  })

  it('folds a subtree behind its root with per-root status badge', () => {
    const events = [userMessage(1, 'hi')]
    const extras = {
      nodes: [subNode('p', 'running'), subNode('c1', 'done'), subNode('g1', 'failed')],
      edges: [rootEdge('p'), delegation('p', 'c1'), delegation('c1', 'g1')],
    }
    const { result } = policy(events, { collapsedSubtrees: new Set(['p']) }, extras.nodes, extras.edges)
    expect(result.nodes.some((n) => n.id === 'subagent:c1')).toBe(false)
    expect(result.nodes.some((n) => n.id === 'subagent:g1')).toBe(false)
    const root = result.nodes.find((n) => n.id === 'subagent:p')!
    expect(root.data.aggregate).toEqual({
      kind: 'subtree',
      count: 2,
      statuses: { done: 1, failed: 1 },
    })
    // 根的入边保留。
    expect(result.edges.some((e) => e.id === 'e-root-subagent:p')).toBe(true)
  })

  it('counts each root badge from its own descendants only (multi-subtree)', () => {
    const events = [userMessage(1, 'hi')]
    const extras = {
      nodes: [
        subNode('a', 'running'),
        subNode('a1', 'done'),
        subNode('b', 'running'),
        subNode('b1', 'failed'),
      ],
      edges: [rootEdge('a'), delegation('a', 'a1'), rootEdge('b'), delegation('b', 'b1')],
    }
    const { result } = policy(
      events,
      { collapsedSubtrees: new Set(['a', 'b']) },
      extras.nodes,
      extras.edges,
    )
    const a = result.nodes.find((n) => n.id === 'subagent:a')!
    const b = result.nodes.find((n) => n.id === 'subagent:b')!
    expect(a.data.aggregate).toEqual({ kind: 'subtree', count: 1, statuses: { done: 1 } })
    expect(b.data.aggregate).toEqual({ kind: 'subtree', count: 1, statuses: { failed: 1 } })
  })

  it('follows delegation edges regardless of the parent node kind (member reparenting)', () => {
    // workflow-member 再父化：member → subagent 边也是 delegation。
    const events = [userMessage(1, 'hi')]
    const member: TaskNode = {
      id: 'workflow-member:r:1',
      type: 'workflow-member',
      position: { x: 0, y: 0 },
      data: { label: 'm', status: 'running', navigable: false },
    }
    const child = subNode('under-member', 'done')
    const memberToChild: TaskEdge = {
      id: 'e-workflow-member:r:1-subagent:under-member',
      source: 'workflow-member:r:1',
      target: 'subagent:under-member',
      data: { kind: 'delegation', evidence: 'fact' },
    }
    // 折叠 under-member（无后代）→ 徽标 0 后代；防御路径。
    const { result } = policy(
      events,
      { collapsedSubtrees: new Set(['under-member']) },
      [member, child],
      [memberToChild],
    )
    expect(result.nodes.some((n) => n.id === 'subagent:under-member')).toBe(true) // 根保留
    const root = result.nodes.find((n) => n.id === 'subagent:under-member')!
    expect(root.data.aggregate).toEqual({ kind: 'subtree', count: 0, statuses: {} })
  })
})

describe('applyViewPolicy — 组合与性质', () => {
  it('deterministic and acyclic under a combined scenario', () => {
    const events = [
      userMessage(1, 't1'),
      turnStart(2, 1),
      toolCall(3, 1, 'c1', 'x'),
      toolResult(4, 1, 'c1'),
      turnEnd(5, 1, 'completed'),
      userMessage(6, 't2'),
      turnStart(7, 2),
      toolCall(8, 2, 'c2', 'y'),
      toolResult(9, 2, 'c2', { isError: true }),
      turnEnd(10, 2, 'error'),
      todoWrite(11, [{ content: 'task-1', status: 'in_progress' }]),
    ]
    const opts = {
      hideFailed: false,
      activityDetail: 'notable' as ActivityDetail,
      collapseCompletedTurns: true,
      collapsedSubtrees: new Set<string>(),
    }
    const a = policy(events, opts).result
    const b = policy(events, opts).result
    expect(a).toEqual(b)
    expectUniqueEdgeIds(a.edges)
    assertAcyclic(a.nodes, a.edges)
    // error 轮 prompt 与卡点活动同图并存。
    expect(a.nodes.some((n) => n.id === 'user-2')).toBe(true)
    expect(a.nodes.some((n) => n.id === 'activity:8')).toBe(true)
    expect(a.nodes.some((n) => n.id === 'turns:completed')).toBe(true)
  })
})
