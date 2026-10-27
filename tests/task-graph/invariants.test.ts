/**
 * P4 不变量测试：确定性 / 深链 / 无环性 / 折叠性质。
 *
 * 移植参考插件 dist/04 §12 测试矩阵的 skyaxis 版。设计裁定（0003 §七 P2c
 * 行）：dist/05 的 SCC 环压平机器未移植（delegation 边构造上无环），因此
 * "环"覆盖是**守卫性质**——Kahn 无环性断言跑遍三个 builder 的输出（含
 * 对抗性输入）；若 lineageDepths 将来回归，性质测试立即抓住。
 *
 * 纯测试，零生产代码改动。helper 自足（不跨文件 import 测试工具）。
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type {
  SessionEventLikeEntry,
  SessionSummary,
} from '@deepseek-ai/dsh-api-session-controller/client'
import { foldSessionDocument } from '../../src/client/task-graph/document/fold.js'
import { projectTaskChain } from '../../src/client/task-graph/projections/task-chain.js'
import {
  buildSubagentGraph,
  lineageDepths,
  subagentSignature,
} from '../../src/client/task-graph/subagents.js'
import {
  buildWorkflowGraph,
  foldWorkflowRuns,
  workflowSignature,
} from '../../src/client/task-graph/workflows.js'
import { layoutSignature, layoutTaskGraph } from '../../src/client/task-graph/layout.js'
import type { TaskNode, TaskEdge } from '../../src/client/task-graph/types.js'

type Entry = SessionEventLikeEntry

function sid(id: string): SessionId {
  return id as unknown as SessionId
}

function summary(
  id: string,
  fields: Partial<
    Pick<SessionSummary, 'parentId' | 'origin' | 'running' | 'displayTitle'>
  > = {},
): SessionSummary {
  return {
    id: sid(id),
    displayTitle: fields.displayTitle ?? `Title ${id}`,
    parentId: fields.parentId,
    origin: fields.origin,
    running: fields.running ?? false,
    retainedBy: {},
    blank: false,
    updatedAt: 0,
  } as SessionSummary
}

function byIdOf(...rows: SessionSummary[]): Record<SessionId, SessionSummary> {
  const map = {} as Record<SessionId, SessionSummary>
  for (const row of rows) map[row.id] = row
  return map
}

/** 通用事件 entry 构造（类型经 unknown 中转，测试夹具专用）。 */
function ev(seq: number, type: string, data: unknown): Entry {
  return {
    type: 'event',
    event: { type, seq: seq as never, time: seq * 1000, data },
  } as unknown as Entry
}

function userMessage(seq: number, text: string): Entry {
  return ev(seq, 'user/message', {
    id: `u${seq}`,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

function todoWrite(seq: number, todos: readonly { content: string; status: string }[]): Entry {
  return ev(seq, 'todo/write', { todos })
}

function turnStart(seq: number, turn: number): Entry {
  return ev(seq, 'turn/start', { turn })
}

function turnEndError(seq: number, turn: number): Entry {
  return ev(seq, 'turn/end', { turn, reason: { kind: 'error' } })
}

function runStart(seq: number, runId: string, name: string): Entry {
  return ev(seq, 'tool-workflow/run-start', { runId, name })
}

function agentStart(
  seq: number,
  runId: string,
  memberSeq: number,
  label: string,
  childId: string,
): Entry {
  return ev(seq, 'tool-workflow/agent-start', { runId, seq: memberSeq, label, childId: sid(childId) })
}

function agentEnd(
  seq: number,
  runId: string,
  memberSeq: number,
  outcome: 'completed' | 'failed' | 'cancelled',
): Entry {
  return ev(seq, 'tool-workflow/agent-end', { runId, seq: memberSeq, outcome })
}

function eventsOf(entries: readonly Entry[]): SessionEvent[] {
  return entries
    .filter((e): e is Extract<Entry, { type: 'event' }> => e.type === 'event')
    .map((e) => e.event)
}

/** v0.4 切片 A 组合面（connector 同款调用序）：fold → projectTaskChain。 */
function chain(entries: readonly Entry[]) {
  return projectTaskChain(
    foldSessionDocument({
      sessionId: sid('s'),
      events: eventsOf(entries),
      hasMore: false,
      label: 'S',
      rootStatus: 'running',
    }),
  )
}

function buildWf(entries: readonly Entry[]) {
  return buildWorkflowGraph({
    rootId: sid('root'),
    runs: foldWorkflowRuns(eventsOf(entries)),
    byId: {},
    ids: [],
    fallbackLabels: { run: 'Workflow', member: 'Member' },
  })
}

/**
 * Kahn 无环性断言：全部节点可拓扑消费（消费不完 = 有环）。
 * 自环单独断言不存在。
 */
function assertAcyclic(
  nodes: readonly { id: string }[],
  edges: readonly { source: string; target: string }[],
): void {
  const ids = new Set(nodes.map((n) => n.id))
  for (const e of edges) {
    expect(e.source).not.toBe(e.target) // 无自环
  }
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
    for (const target of outgoing.get(id) ?? []) {
      const next = (indegree.get(target) ?? 0) - 1
      indegree.set(target, next)
      if (next === 0) queue.push(target)
    }
  }
  expect(consumed).toBe(ids.size)
}

describe('determinism (dist/04 §12)', () => {
  const mixedEntries = [
    userMessage(1, '做一下'),
    turnStart(2, 1),
    todoWrite(3, [
      { content: 'a', status: 'pending' },
      { content: 'b', status: 'in_progress' },
    ]),
    todoWrite(4, [
      { content: 'a', status: 'completed' },
      { content: 'b', status: 'in_progress' },
      { content: 'c', status: 'pending' },
    ]),
    turnEndError(5, 1),
  ]

  it('task-chain fold+projection returns identical output for identical input', () => {
    expect(chain(mixedEntries)).toEqual(chain(mixedEntries))
  })

  it('task-chain fold+projection is invariant to input event permutation (seq sort guard)', () => {
    const shuffled = [...mixedEntries].reverse()
    expect(chain(shuffled)).toEqual(chain(mixedEntries))
  })

  it('buildSubagentGraph is deterministic and invariant to byId key order', () => {
    const rows = [
      summary('root'),
      summary('c1', { parentId: sid('root'), origin: 'subagent' }),
      summary('c2', { parentId: sid('root'), origin: 'subagent' }),
      summary('g1', { parentId: sid('c1'), origin: 'subagent' }),
    ]
    const input = {
      rootId: sid('root'),
      subagentsByParent: {},
      ids: [],
      fallbackLabel: 'Subagent',
    }
    const a = buildSubagentGraph({ ...input, byId: byIdOf(...rows) })
    const b = buildSubagentGraph({ ...input, byId: byIdOf(...[...rows].reverse()) })
    expect(a).toEqual(b)
  })

  it('workflow fold+build is deterministic under event permutation', () => {
    const entries = [
      runStart(1, 'r', 'n'),
      agentStart(2, 'r', 1, 'a', 's1'),
      agentEnd(3, 'r', 1, 'completed'),
      agentStart(4, 'r', 2, 'b', 's2'),
    ]
    expect(buildWf(entries)).toEqual(buildWf([...entries].reverse()))
  })
})

describe('deep lineage (dist/04 §9)', () => {
  function deepById(depth: number): Record<SessionId, SessionSummary> {
    const rows = [summary('root')]
    let parentId = 'root'
    for (let i = 0; i < depth; i += 1) {
      const id = `node-${i}`
      rows.push(summary(id, { parentId: sid(parentId), origin: 'subagent' }))
      parentId = id
    }
    return byIdOf(...rows)
  }

  it('lineageDepths handles a 3000-deep chain without throwing', () => {
    const depths = lineageDepths(sid('root'), deepById(3000))
    expect(depths.get(sid('node-2999'))).toBe(3000)
    expect(depths.get(sid('node-0'))).toBe(1)
  })

  it('build + layout stay correct on a 500-deep chain (correctness, not speed)', () => {
    // 500 层是 dagre（递归 DFS acyclic.js）的安全范围；3000 层的限制见下
    // 一个用例（记为契约）。fold 层（lineageDepths）3000 层单独验证。
    const byId = deepById(500)
    const graph = buildSubagentGraph({
      rootId: sid('root'),
      byId,
      subagentsByParent: {},
      ids: [],
      fallbackLabel: 'Subagent',
    })
    expect(graph.nodes).toHaveLength(500)
    expect(graph.edges).toHaveLength(500)

    const laid1 = layoutTaskGraph(graph.nodes, graph.edges, 'TB')
    const laid2 = layoutTaskGraph(graph.nodes, graph.edges, 'TB')
    expect(laid1.nodes.map((n) => n.position)).toEqual(laid2.nodes.map((n) => n.position))

    // y 单调：nodes 按 depth 排序（build 的排序纪律），线性链每层一个节点
    const ys = laid1.nodes.map((n) => n.position.y)
    for (let i = 1; i < ys.length; i += 1) {
      expect(ys[i]!).toBeGreaterThan(ys[i - 1]!)
    }
  }, 30000)

  it('DOCUMENTED LIMITATION: dagre overflows the stack on a 3000-deep chain (guard for a future iterative layout)', () => {
    // 契约记录（P4 实测）：dagre@1.1.8 的 acyclic.js 用递归 DFS，3000 层
    // 线性链 RangeError。生产行为：异常沿 applyWindow → try/catch → 空画布
    // 降级（视图不可用但宿主不受污染）。fold 层 3000 层无此问题（见上）。
    // 若将来换成迭代布局引擎，本用例失败 → 提示更新契约并删除降级路径。
    const byId = deepById(3000)
    const graph = buildSubagentGraph({
      rootId: sid('root'),
      byId,
      subagentsByParent: {},
      ids: [],
      fallbackLabel: 'Subagent',
    })
    expect(graph.nodes).toHaveLength(3000) // fold 层正常
    expect(() => layoutTaskGraph(graph.nodes, graph.edges, 'TB')).toThrow(RangeError)
  }, 60000)

  it('layoutSignature ignores status-only changes even on a deep chain', () => {
    const byId = deepById(300)
    const graphA = buildSubagentGraph({
      rootId: sid('root'),
      byId,
      subagentsByParent: {},
      ids: [],
      fallbackLabel: 'Subagent',
    })
    const flipped = byIdOf(
      ...Object.values(byId).map((s) =>
        s.id === sid('node-150') ? summary('node-150', { parentId: sid('node-149'), origin: 'subagent', running: true }) : s,
      ),
    )
    const graphB = buildSubagentGraph({
      rootId: sid('root'),
      byId: flipped,
      subagentsByParent: {},
      ids: [],
      fallbackLabel: 'Subagent',
    })
    expect(layoutSignature(graphB.nodes, graphB.edges)).toBe(
      layoutSignature(graphA.nodes, graphA.edges),
    )
    // 但子树签名要变（connector 重推语义）
    expect(subagentSignature(sid('root'), flipped)).not.toBe(subagentSignature(sid('root'), byId))
  })
})

describe('acyclicity guard (P4 裁定：守卫性质替代未移植的 SCC 测试)', () => {
  it('task-chain output is acyclic under adversarial input', () => {
    const { nodes, edges } = chain([
      userMessage(1, 'x'),
      turnStart(2, 1),
      todoWrite(3, [{ content: 'a', status: 'pending' }]),
      todoWrite(4, [{ content: 'a', status: 'in_progress' }, { content: 'a', status: 'pending' }]),
      todoWrite(1, [{ content: 'z', status: 'completed' }]), // 乱序 seq
      turnEndError(5, 1),
    ])
    assertAcyclic(nodes, edges)
    // v0.4 切片 A：共享节点下边 id 跨 turn 复现——去重是 React Flow 硬约束。
    expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length)
  })

  it('subagent output excludes cyclic lineage members and stays acyclic', () => {
    const byId = byIdOf(
      summary('root'),
      summary('ok', { parentId: sid('root'), origin: 'subagent' }),
      summary('cycA', { parentId: sid('cycB'), origin: 'subagent' }),
      summary('cycB', { parentId: sid('cycA'), origin: 'subagent' }),
      summary('deep1', { parentId: sid('deep3'), origin: 'subagent' }),
      summary('deep2', { parentId: sid('deep1'), origin: 'subagent' }),
      summary('deep3', { parentId: sid('deep2'), origin: 'subagent' }),
      summary('orphan', { parentId: sid('missing'), origin: 'subagent' }),
    )
    const { nodes, edges } = buildSubagentGraph({
      rootId: sid('root'),
      byId,
      subagentsByParent: {},
      ids: [],
      fallbackLabel: 'Subagent',
    })
    const ids = nodes.map((n) => n.id)
    // 环成员与孤儿全部缺席
    for (const bad of ['cycA', 'cycB', 'deep1', 'deep2', 'deep3', 'orphan']) {
      expect(ids).not.toContain(`subagent:${bad}`)
    }
    expect(ids).toContain('subagent:ok')
    assertAcyclic(nodes, edges)
  })

  it('workflow output is acyclic under adversarial event order', () => {
    const { nodes, edges } = buildWf([
      agentEnd(1, 'r', 1, 'completed'), // settle 先于发现
      runStart(2, 'r', 'n'),
      runStart(2, 'r', 'n'), // 重复 run-start
      agentStart(3, 'r', 1, 'a', 's1'),
      agentStart(4, 'r', 9, 'z', 's9'), // 孤儿 member（无 settle）
      agentEnd(5, 'r', 1, 'failed'),
    ])
    assertAcyclic(nodes, edges)
  })
})

describe('fold properties (dist/04 §12 行 3 精神)', () => {
  it('task node count equals the last write entry count (in-write duplicates count separately)', () => {
    const writes = [
      todoWrite(1, [
        { content: 'a', status: 'pending' },
        { content: 'b', status: 'pending' },
        { content: 'c', status: 'pending' },
      ]),
      todoWrite(2, [
        { content: 'b', status: 'in_progress' },
        { content: 'd', status: 'pending' },
      ]),
      todoWrite(3, [
        { content: 'd', status: 'in_progress' },
        { content: 'd', status: 'pending' }, // 同 write 内重复 content → 两个节点
        { content: 'e', status: 'pending' },
      ]),
    ]
    const { nodes } = chain(writes)
    const tasks = nodes.filter((n) => n.type === 'task')
    // 最后一次 write 的条目数（含同 write 内重复）=== 存活节点数
    // （v0.4 全局身份下即「最新 write 定存活集」不变量）。
    expect(tasks).toHaveLength(3)
    expect(tasks.map((t) => t.data.label).sort()).toEqual(['d', 'd', 'e'])
  })

  it('document permutation invariance: fold output (signature included) is order-free', () => {
    const entries = [
      userMessage(1, '做一下'),
      turnStart(2, 1),
      todoWrite(3, [{ content: 'a', status: 'pending' }]),
      todoWrite(4, [{ content: 'a', status: 'completed' }]),
      turnEndError(5, 1),
    ]
    const a = foldSessionDocument({
      sessionId: sid('s'), events: eventsOf(entries), hasMore: false, label: 'S', rootStatus: 'running',
    })
    const b = foldSessionDocument({
      sessionId: sid('s'), events: eventsOf([...entries].reverse()), hasMore: false, label: 'S', rootStatus: 'running',
    })
    expect(a).toEqual(b)
    expect(a.signature).toBe(b.signature)
  })

  it('duplicate agent-end is idempotent (outcomes and signature unchanged)', () => {
    const once = [runStart(1, 'r', 'n'), agentStart(2, 'r', 1, 'a', 's1'), agentEnd(3, 'r', 1, 'completed')]
    const twice = [...once, agentEnd(4, 'r', 1, 'completed')]
    const runsOnce = foldWorkflowRuns(eventsOf(once))
    const runsTwice = foldWorkflowRuns(eventsOf(twice))
    expect(workflowSignature(runsTwice)).toBe(workflowSignature(runsOnce))
    expect(runsTwice.get('r')!.outcomes.get(1)).toBe('completed')
  })
})
