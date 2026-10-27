/**
 * 任务链投影测试（v0.4 切片 A，ADR 0036）：document → 节点/边。
 *
 * 承接退役 infer.test.ts 的行为对齐面（状态映射 / 失败诚实规则 / plugin
 * 过滤 / 乱序防御 / 跨 turn 链），并钉切片 A 的语义修正：
 *   - 全局身份：跨 turn 同 content 一个节点（重复膨胀修法）；
 *   - user-prompt 节点无 status 位；
 *   - 边 id 去重 + 构造性无环（identical-list 跨 turn 不出回头边）。
 *
 * 测试组合面 = connector 的调用序：foldSessionDocument → projectTaskChain。
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { foldSessionDocument } from '../../../src/client/task-graph/document/fold.js'
import type { TaskGraphFacts } from '../../../src/client/task-graph/document/types.js'
import { projectTaskChain } from '../../../src/client/task-graph/projections/task-chain.js'
import type { TaskNode } from '../../../src/client/task-graph/types.js'

function ev<T extends SessionEvent['type']>(
  seq: number,
  type: T,
  data: SessionEvent<T>['data'],
): SessionEvent {
  return { type, seq: seq as never, time: seq * 1000, data } as SessionEvent
}

function turnStart(seq: number, turn: number): SessionEvent {
  return ev(seq, 'turn/start', { turn })
}

function turnEnd(seq: number, turn: number): SessionEvent {
  return ev(seq, 'turn/end', { turn, reason: { kind: 'error', error: { message: 'x', code: 'E' } } as never })
}

function userMessage(seq: number, text: string, sourceKind: 'user' | 'plugin' = 'user'): SessionEvent {
  const source =
    sourceKind === 'user' ? { kind: 'user' } : { kind: 'plugin', plugin: 'test' }
  return ev(seq, 'user/message', {
    id: `u${seq}` as never,
    role: 'user',
    content: [{ type: 'text', text }],
    source,
  } as never)
}

function todoWrite(
  seq: number,
  todos: readonly { content: string; status: string }[],
): SessionEvent {
  return ev(seq, 'todo/write', { todos } as never)
}

function project(
  events: readonly SessionEvent[],
  label = 'S',
  rootStatus: TaskGraphFacts['rootStatus'] = 'running',
) {
  return projectTaskChain(
    foldSessionDocument({
      sessionId: 's1' as SessionId,
      events,
      hasMore: false,
      label,
      rootStatus,
    }),
  )
}

function findTaskByLabel(nodes: TaskNode[], label: string): TaskNode | undefined {
  return nodes.find((n) => n.type === 'task' && n.data.label === label)
}

/** 边 id 唯一性断言（React Flow 边 id 重复会炸——共享节点跨 turn 复现的场景）。 */
function expectUniqueEdgeIds(edges: readonly { id: string }[]): void {
  expect(new Set(edges.map((e) => e.id)).size).toBe(edges.length)
}

describe('projectTaskChain — 基础对齐面（退役 infer.test.ts 承接）', () => {
  it('returns only the root for an empty window', () => {
    const { nodes, edges } = project([], 'S1')
    expect(nodes).toEqual([
      {
        id: 'root',
        type: 'root',
        position: { x: 0, y: 0 },
        data: { label: 'S1', status: 'running' },
      },
    ])
    expect(edges).toEqual([])
  })

  it('accepts rootStatus override for the root node', () => {
    const { nodes } = project([], 'S', 'done')
    expect(nodes[0]!.data.status).toBe('done')
  })

  it('marks sequence edges as inferred evidence (v0.4 切片 B)', () => {
    const { edges } = project([
      userMessage(1, '做一下'),
      todoWrite(2, [
        { content: 'a', status: 'pending' },
        { content: 'b', status: 'pending' },
      ]),
    ])
    const sequence = edges.filter((e) => e.data?.kind === 'sequence')
    expect(sequence.length).toBeGreaterThan(0)
    for (const e of sequence) expect(e.data?.evidence).toBe('inferred')
  })

  it('handles out-of-order seq defensively by sorting events', () => {
    const { nodes } = project([
      todoWrite(5, [{ content: 'B', status: 'completed' }]),
      todoWrite(1, [{ content: 'A', status: 'completed' }]),
    ])
    // seq=5 更晚发生：whole-list 替换后仅存 B。
    const tasks = nodes.filter((n) => n.type === 'task')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.data.label).toBe('B')
  })

  it('infers task nodes and linear edges from a single todo/write', () => {
    const { nodes, edges } = project([
      todoWrite(1, [
        { content: '读文件', status: 'in_progress' },
        { content: '写文件', status: 'pending' },
        { content: '提交', status: 'pending' },
      ]),
    ])
    const tasks = nodes.filter((n) => n.type === 'task')
    expect(tasks).toHaveLength(3)
    expect(tasks.map((t) => t.data.label)).toEqual(['读文件', '写文件', '提交'])
    const read = findTaskByLabel(nodes, '读文件')!
    const write = findTaskByLabel(nodes, '写文件')!
    const commit = findTaskByLabel(nodes, '提交')!
    expect(edges.find((e) => e.source === read.id && e.target === write.id)).toBeTruthy()
    expect(edges.find((e) => e.source === write.id && e.target === commit.id)).toBeTruthy()
    expect(edges.find((e) => e.source === read.id && e.target === commit.id)).toBeFalsy()
  })

  it('maps TodoItem status directly: pending/in_progress/completed → pending/running/done', () => {
    const { nodes } = project([
      todoWrite(1, [
        { content: 'p', status: 'pending' },
        { content: 'r', status: 'in_progress' },
        { content: 'd', status: 'completed' },
      ]),
    ])
    const byLabel = new Map(
      nodes.filter((n) => n.type === 'task').map((t) => [t.data.label, t.data.status]),
    )
    expect(byLabel.get('p')).toBe('pending')
    expect(byLabel.get('r')).toBe('running')
    expect(byLabel.get('d')).toBe('done')
  })

  it('normalizes unknown todo status to pending (never completed)', () => {
    const { nodes } = project([
      todoWrite(1, [
        { content: 'bogus', status: 'cancelled' },
        { content: 'ok', status: 'in_progress' },
      ]),
    ])
    expect(findTaskByLabel(nodes, 'bogus')!.data.status).toBe('pending')
    expect(findTaskByLabel(nodes, 'ok')!.data.status).toBe('running')
  })

  it('creates user-prompt nodes only for kind=user source (skips plugin injections)', () => {
    const { nodes } = project([
      userMessage(1, '帮我做个 todo'),
      userMessage(2, '[plugin injected context]', 'plugin'),
    ])
    const prompts = nodes.filter((n) => n.type === 'user-prompt')
    expect(prompts).toHaveLength(1)
    expect(prompts[0]!.data.label).toBe('帮我做个 todo')
  })

  it('does not connect user-prompt to any task when the turn has no todo/write', () => {
    const { nodes, edges } = project([userMessage(1, '空 prompt')])
    expect(nodes.some((n) => n.type === 'user-prompt')).toBe(true)
    expect(edges.filter((e) => e.target.startsWith('todo-'))).toHaveLength(0)
  })
})

describe('projectTaskChain — 全局身份（切片 A 语义修正）', () => {
  it('keeps task node ids turn-free: ^todo-<hash>(#N)?$', () => {
    const { nodes } = project([
      todoWrite(1, [
        { content: 'dup', status: 'pending' },
        { content: 'dup', status: 'pending' },
      ]),
    ])
    const tasks = nodes.filter((n) => n.type === 'task')
    expect(tasks).toHaveLength(2)
    expect(tasks[0]!.id).not.toBe(tasks[1]!.id)
    for (const t of tasks) {
      expect(t.id).toMatch(/^todo-[\w]+(#\d+)?$/)
    }
  })

  it('reuses one node per content across turns (cross-turn duplication retired)', () => {
    // 退役 infer 时代此夹具产出 4 个 task 节点（每 turn 复制一份）。
    const { nodes, edges } = project([
      turnStart(1, 1),
      todoWrite(2, [
        { content: 'task-a', status: 'pending' },
        { content: 'task-b', status: 'pending' },
      ]),
      turnEnd(3, 1),
      turnStart(4, 2),
      todoWrite(5, [
        { content: 'task-a', status: 'in_progress' },
        { content: 'task-b', status: 'completed' },
      ]),
    ])
    const tasks = nodes.filter((n) => n.type === 'task')
    expect(tasks).toHaveLength(2)
    expect(findTaskByLabel(nodes, 'task-a')!.data.status).toBe('running')
    expect(findTaskByLabel(nodes, 'task-b')!.data.status).toBe('done')
    expectUniqueEdgeIds(edges)
  })

  it('drops a task absent from the latest write (retirement) and drops its edges', () => {
    const { nodes, edges } = project([
      turnStart(1, 1),
      todoWrite(2, [
        { content: 'a', status: 'pending' },
        { content: 'b', status: 'pending' },
        { content: 'c', status: 'pending' },
      ]),
      turnStart(3, 2),
      todoWrite(4, [{ content: 'a', status: 'completed' }]),
    ])
    const tasks = nodes.filter((n) => n.type === 'task')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.data.label).toBe('a')
    // 退役节点不出现、也不残留悬挂边。
    expect(edges.every((e) => !e.source.startsWith('todo-') || e.source === tasks[0]!.id)).toBe(true)
    expectUniqueEdgeIds(edges)
  })

  it('revives a retired task on reappearance with current status', () => {
    const { nodes } = project([
      todoWrite(1, [
        { content: 'keep', status: 'pending' },
        { content: 'pause', status: 'pending' },
      ]),
      todoWrite(2, [{ content: 'keep', status: 'completed' }]),
      todoWrite(3, [
        { content: 'keep', status: 'completed' },
        { content: 'pause', status: 'in_progress' },
      ]),
    ])
    expect(findTaskByLabel(nodes, 'pause')!.data.status).toBe('running')
  })
})

describe('projectTaskChain — 边语义', () => {
  it('connects user-prompt of turn_N to the first live task of turn_N', () => {
    const { edges, nodes } = project([
      userMessage(1, '做一下'),
      todoWrite(2, [
        { content: 't1', status: 'pending' },
        { content: 't2', status: 'pending' },
      ]),
    ])
    const first = findTaskByLabel(nodes, 't1')!
    const second = findTaskByLabel(nodes, 't2')!
    expect(edges.find((e) => e.source === 'user-1' && e.target === first.id)).toBeTruthy()
    expect(edges.find((e) => e.source === 'user-1' && e.target === second.id)).toBeFalsy()
  })

  it('turns chain through SHARED nodes when the list carries over (global identity)', () => {
    // 退役 infer 时代跨 turn 链靠显式「上 turn 末 → 下 turn 首」边；全局身份下
    // 跨 turn 共享节点本身就把两段接起来，列表未换血时不再需要显式跨 turn 边。
    const { nodes, edges } = project([
      turnStart(1, 1),
      todoWrite(2, [
        { content: 'a', status: 'pending' },
        { content: 'b', status: 'pending' },
      ]),
      turnStart(3, 2),
      todoWrite(4, [
        { content: 'b', status: 'in_progress' },
        { content: 'c', status: 'pending' },
      ]),
    ])
    // 存活集 = 最新 write：a 退役，b/c 存活；b→c 链边来自最新列表序。
    expect(findTaskByLabel(nodes, 'a')).toBeUndefined()
    const b = findTaskByLabel(nodes, 'b')!
    const c = findTaskByLabel(nodes, 'c')!
    expect(edges.find((e) => e.source === b.id && e.target === c.id)).toBeTruthy()
    expectUniqueEdgeIds(edges)
  })

  it('retires the whole previous list when a turn replaces it entirely (no dangling spine)', () => {
    // [a,b] → [c]：a/b 全局退役，旧「跨 turn 末→首」边的两端都不在图上——
    // 不再有跨 turn 残留节点（退役 infer 时代 a/b 以 turn1 域节点长存）。
    const { nodes, edges } = project([
      turnStart(1, 1),
      todoWrite(2, [
        { content: 'a', status: 'pending' },
        { content: 'b', status: 'pending' },
      ]),
      turnStart(3, 2),
      todoWrite(4, [{ content: 'c', status: 'pending' }]),
    ])
    expect(findTaskByLabel(nodes, 'a')).toBeUndefined()
    expect(findTaskByLabel(nodes, 'b')).toBeUndefined()
    expect(findTaskByLabel(nodes, 'c')!.data.status).toBe('pending')
    // 唯一 task 相关边不引用退役节点。
    const taskEdges = edges.filter((e) => e.source.startsWith('todo-') || e.target.startsWith('todo-'))
    for (const e of taskEdges) {
      const ids = nodes.map((n) => n.id)
      expect(ids).toContain(e.source)
      expect(ids).toContain(e.target)
    }
    expectUniqueEdgeIds(edges)
  })

  it('emits no back-edge when the next turn repeats the same list (cycle guard)', () => {
    // 共享节点下 turn2 的跨 turn 边 b→a 会与链边 a→b 成环——守卫诚实丢弃。
    const { edges, nodes } = project([
      turnStart(1, 1),
      todoWrite(2, [
        { content: 'a', status: 'pending' },
        { content: 'b', status: 'pending' },
      ]),
      turnStart(3, 2),
      todoWrite(4, [
        { content: 'a', status: 'completed' },
        { content: 'b', status: 'in_progress' },
      ]),
    ])
    const a = findTaskByLabel(nodes, 'a')!
    const b = findTaskByLabel(nodes, 'b')!
    expect(edges.find((e) => e.source === a.id && e.target === b.id)).toBeTruthy()
    expect(edges.find((e) => e.source === b.id && e.target === a.id)).toBeFalsy()
    expectUniqueEdgeIds(edges)
  })

  it('keeps edge ids unique across turns with repeating chains', () => {
    const { edges, nodes } = project([
      turnStart(1, 1),
      todoWrite(2, [
        { content: 'x', status: 'pending' },
        { content: 'y', status: 'pending' },
      ]),
      turnStart(3, 2),
      todoWrite(4, [
        { content: 'x', status: 'completed' },
        { content: 'y', status: 'completed' },
      ]),
      turnStart(5, 3),
      todoWrite(6, [
        { content: 'x', status: 'completed' },
        { content: 'y', status: 'completed' },
      ]),
    ])
    expectUniqueEdgeIds(edges)
    // 三个 turn 同链：x→y 只有一条（按节点 id 精确查，不做子串误配）。
    const x = findTaskByLabel(nodes, 'x')!
    const y = findTaskByLabel(nodes, 'y')!
    expect(edges.filter((e) => e.source === x.id && e.target === y.id)).toHaveLength(1)
  })
})

describe('projectTaskChain — 失败诚实规则（P1 平移）', () => {
  it('keeps completed tasks done; only unfinished become failed on turn error', () => {
    const { nodes } = project([
      turnStart(1, 1),
      todoWrite(2, [
        { content: 'finished', status: 'completed' },
        { content: 'wip', status: 'in_progress' },
        { content: 'not-started', status: 'pending' },
      ]),
      turnEnd(3, 1),
    ])
    expect(findTaskByLabel(nodes, 'finished')!.data.status).toBe('done')
    expect(findTaskByLabel(nodes, 'wip')!.data.status).toBe('failed')
    expect(findTaskByLabel(nodes, 'not-started')!.data.status).toBe('failed')
  })

  it('lets a later write overwrite the failed state (wire truth wins)', () => {
    const { nodes } = project([
      turnStart(1, 1),
      todoWrite(2, [{ content: 't', status: 'in_progress' }]),
      turnEnd(3, 1),
      turnStart(4, 2),
      todoWrite(5, [{ content: 't', status: 'in_progress' }]),
    ])
    // 末修订属 turn 2（非 error 收场）→ 不再 failed。
    expect(findTaskByLabel(nodes, 't')!.data.status).toBe('running')
  })

  it('marks failed only while the last revision belongs to the errored turn', () => {
    const { nodes } = project([
      turnStart(1, 1),
      todoWrite(2, [{ content: 't', status: 'in_progress' }]),
      turnEnd(3, 1), // turn 1 error，无后续 write → failed 保持
    ])
    expect(findTaskByLabel(nodes, 't')!.data.status).toBe('failed')
  })

  it('retires the status bit on user-prompt nodes (never done/failed)', () => {
    const { nodes } = project([
      userMessage(1, '会失败的请求'),
      turnStart(2, 1),
      todoWrite(3, [{ content: 't', status: 'in_progress' }]),
      turnEnd(4, 1),
    ])
    const prompt = nodes.find((n) => n.type === 'user-prompt')!
    expect(prompt.data.status).toBeUndefined()
    // turn 失败仍如实升级未完成任务。
    expect(findTaskByLabel(nodes, 't')!.data.status).toBe('failed')
  })
})
