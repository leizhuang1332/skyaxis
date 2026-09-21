/**
 * inferTaskGraph 纯函数测试（v0.3）。
 *
 * 不依赖 React / cordis / dsh-client-store —— 只断言 events → { nodes, edges }
 * 的转换规则（research/0002 §五 + ADR 0001 §五 + v0.3 plan）。
 *
 * v0.3 输入事件集合：
 *   - user/message (kind: 'user')   → user-prompt 节点
 *   - todo/write                    → task 节点（DAG 边）
 *   - turn/end (reason.kind)        → 影响该 turn 内 task 终态
 * 其他事件类型全部不参与推断。
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionEventLikeEntry as SessionEventLikeEntryFromController } from '@deepseek-ai/dsh-api-session-controller/client'
import { inferTaskGraph } from '../../src/client/task-graph/infer.js'

type Entry = SessionEventLikeEntryFromController

function ev<T extends SessionEvent['type']>(
  seq: number,
  type: T,
  data: SessionEvent<T>['data'],
  extras?: Partial<Pick<SessionEvent<T>, 'surfaceOp' | 'sourceEventSeqs'>>,
): Entry {
  return {
    type: 'event',
    event: {
      type,
      seq: seq as unknown as SessionEvent['seq'],
      time: seq * 1000,
      data,
      ...(extras ?? {}),
    } as SessionEvent,
  } as Entry
}

function transient(seq: number): Entry {
  return {
    type: 'transient',
    event: {
      type: 'assistant/live-chunk',
      seq,
      time: seq * 1000,
      data: {
        attemptId: 'a1' as never,
        turn: 1,
        step: 1,
        chunk: { kind: 'text', delta: 'transient' } as never,
      },
    },
  } as Entry
}

// -------- v0.3 helpers --------

/**
 * 构造一个 todo/write entry。
 * todo/write 不在 SessionEventMap base 类型里——通过 unknown cast 注入。
 */
function todoWrite(
  seq: number,
  turn: number,
  todos: readonly { content: string; status: 'pending' | 'in_progress' | 'completed' }[],
): Entry {
  return {
    type: 'event',
    event: {
      type: 'todo/write',
      seq: seq as unknown as SessionEvent['seq'],
      time: seq * 1000,
      data: { turn, todos },
    } as unknown as SessionEvent,
  } as Entry
}

/**
 * 构造 user/message entry。
 * data 直接是 UserMessage（不再有 .message 嵌套）。
 */
function userMessage(
  seq: number,
  turn: number,
  text: string,
  sourceKind: 'user' | 'plugin' = 'user',
): Entry {
  const source =
    sourceKind === 'user'
      ? { kind: 'user' }
      : { kind: 'plugin', plugin: 'test', form: 'notice' }
  return {
    type: 'event',
    event: {
      type: 'user/message',
      seq: seq as unknown as SessionEvent['seq'],
      time: seq * 1000,
      data: {
        id: `u${seq}` as never,
        role: 'user',
        content: [{ type: 'text', text }],
        source,
      },
    } as unknown as SessionEvent,
  } as Entry
}

function turnEnd(
  seq: number,
  turn: number,
  reason: { kind: string; [k: string]: unknown },
): Entry {
  return {
    type: 'event',
    event: {
      type: 'turn/end',
      seq: seq as unknown as SessionEvent['seq'],
      time: seq * 1000,
      data: { turn, reason: reason as never },
    } as SessionEvent,
  } as Entry
}

describe('inferTaskGraph', () => {
  // -------- 保留的基础用例 --------

  it('returns only the root for an empty window', () => {
    const { nodes, edges } = inferTaskGraph([], 'S1')
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

  it('drops transient live-chunk entries (only durable events participate)', () => {
    const { nodes } = inferTaskGraph([transient(1)], 'S')
    expect(nodes).toHaveLength(1) // only root
    expect(nodes[0]!.id).toBe('root')
  })

  it('handles out-of-order seq defensively by sorting events', () => {
    const { nodes } = inferTaskGraph(
      [todoWrite(5, 1, [{ content: 'B', status: 'completed' }]), todoWrite(1, 1, [{ content: 'A', status: 'completed' }])],
      'S',
    )
    // seq=5 在后（更晚发生），按 seq 升序处理后是 writeSeq=2 的 todo/write，
    // 会 whole-list 替换 writeSeq=1 的 task。最终节点 label = 'B'。
    const tasks = nodes.filter((n) => n.type === 'task')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.data.label).toBe('B')
  })

  // -------- v0.3 新增用例 --------

  it('infers task nodes from a single todo/write event with multiple items', () => {
    const { nodes, edges } = inferTaskGraph(
      [
        todoWrite(1, 1, [
          { content: '读文件', status: 'in_progress' },
          { content: '写文件', status: 'pending' },
          { content: '提交', status: 'pending' },
        ]),
      ],
      'S',
    )
    const tasks = nodes.filter((n) => n.type === 'task')
    expect(tasks).toHaveLength(3)
    expect(tasks.map((t) => t.data.label)).toEqual(['读文件', '写文件', '提交'])
    // 同 turn 内顺序边：t0 → t1, t1 → t2
    expect(edges.filter((e) => e.source.startsWith('todo-1-1-'))).toHaveLength(2)
  })

  it('creates linear edges between consecutive tasks in same turn', () => {
    const { edges } = inferTaskGraph(
      [
        todoWrite(1, 1, [
          { content: 'a', status: 'pending' },
          { content: 'b', status: 'pending' },
          { content: 'c', status: 'pending' },
        ]),
      ],
      'S',
    )
    const id0 = 'todo-1-1-0'
    const id1 = 'todo-1-1-1'
    const id2 = 'todo-1-1-2'
    expect(edges.find((e) => e.source === id0 && e.target === id1)).toBeTruthy()
    expect(edges.find((e) => e.source === id1 && e.target === id2)).toBeTruthy()
    expect(edges.find((e) => e.source === id0 && e.target === id2)).toBeFalsy()
  })

  it('updates task status when todo/write contains the same index with different status', () => {
    // 同 (turn, index)，writeSeq=1 → writeSeq=2，content 不变则复用 id，status 更新
    const { nodes } = inferTaskGraph(
      [
        todoWrite(1, 1, [
          { content: 'task', status: 'pending' },
          { content: 'other', status: 'pending' },
        ]),
        todoWrite(2, 1, [
          { content: 'task', status: 'completed' },
          { content: 'other', status: 'in_progress' },
        ]),
      ],
      'S',
    )
    const tasks = nodes.filter((n) => n.type === 'task')
    // writeSeq=2 替换 writeSeq=1，所以 task 节点只有 2 个（id 为 writeSeq=2 的）
    expect(tasks).toHaveLength(2)
    const statuses = tasks
      .map((t) => t.data.status)
      .sort()
    expect(statuses).toEqual(['done', 'running'])
  })

  it('removes task nodes when todo/write shrinks the list', () => {
    const { nodes } = inferTaskGraph(
      [
        todoWrite(1, 1, [
          { content: 'a', status: 'pending' },
          { content: 'b', status: 'pending' },
          { content: 'c', status: 'pending' },
        ]),
        todoWrite(2, 1, [{ content: 'a', status: 'pending' }]),
      ],
      'S',
    )
    const tasks = nodes.filter((n) => n.type === 'task')
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.data.label).toBe('a')
  })

  it('adds new task nodes when todo/write grows the list', () => {
    const { nodes, edges } = inferTaskGraph(
      [
        todoWrite(1, 1, [{ content: 'a', status: 'pending' }]),
        todoWrite(2, 1, [
          { content: 'a', status: 'pending' },
          { content: 'b', status: 'pending' },
        ]),
      ],
      'S',
    )
    const tasks = nodes.filter((n) => n.type === 'task')
    // writeSeq=2 替换 writeSeq=1，节点数 = 新数组长度 = 2
    expect(tasks).toHaveLength(2)
    expect(tasks.map((t) => t.data.label)).toEqual(['a', 'b'])
    // writeSeq=2 内部有 1 条顺序边（a → b）
    const seq2Edges = edges.filter(
      (e) => e.source.startsWith('todo-1-2-') && e.target.startsWith('todo-1-2-'),
    )
    expect(seq2Edges).toHaveLength(1)
  })

  it('reuses same node id when todo content stays unchanged across writes', () => {
    const { nodes } = inferTaskGraph(
      [
        todoWrite(1, 1, [
          { content: 'unchanged', status: 'pending' },
          { content: 'unchanged', status: 'pending' },
        ]),
      ],
      'S',
    )
    const tasks = nodes.filter((n) => n.type === 'task')
    expect(tasks).toHaveLength(2)
    // 同 writeSeq 内 index=0 / index=1 是两个独立节点
    expect(tasks[0]!.id).toBe('todo-1-1-0')
    expect(tasks[1]!.id).toBe('todo-1-1-1')
  })

  it('creates user_prompt nodes only for kind=user source (skips plugin injections)', () => {
    const { nodes } = inferTaskGraph(
      [
        userMessage(1, 1, '帮我做个 todo', 'user'),
        userMessage(2, 1, '[plugin injected context]', 'plugin'),
      ],
      'S',
    )
    const prompts = nodes.filter((n) => n.type === 'user-prompt')
    expect(prompts).toHaveLength(1)
    expect(prompts[0]!.id).toBe('user-1')
    expect(prompts[0]!.data.label).toBe('帮我做个 todo')
  })

  it('connects user_prompt turn_N to first task of turn_N', () => {
    const { edges } = inferTaskGraph(
      [
        userMessage(1, 1, '做一下'),
        todoWrite(2, 1, [
          { content: 't1', status: 'pending' },
          { content: 't2', status: 'pending' },
        ]),
      ],
      'S',
    )
    const userId = 'user-1'
    const firstTaskId = 'todo-1-1-0'
    expect(edges.find((e) => e.source === userId && e.target === firstTaskId)).toBeTruthy()
    // user → t2 不会有
    expect(
      edges.find((e) => e.source === userId && e.target === 'todo-1-1-1'),
    ).toBeFalsy()
  })

  it('connects last task of turn_N to first task of turn_{N+1} (cross-turn chain)', () => {
    const { edges } = inferTaskGraph(
      [
        todoWrite(1, 1, [
          { content: 'a', status: 'pending' },
          { content: 'b', status: 'pending' },
        ]),
        todoWrite(2, 2, [{ content: 'c', status: 'pending' }]),
      ],
      'S',
    )
    // turn 1 末 task = 'todo-1-1-1'，turn 2 首 task = 'todo-2-1-0'
    expect(
      edges.find(
        (e) => e.source === 'todo-1-1-1' && e.target === 'todo-2-1-0',
      ),
    ).toBeTruthy()
  })

  it('marks task as failed when its turn turn/end has reason.kind=error', () => {
    const { nodes } = inferTaskGraph(
      [
        todoWrite(1, 1, [
          { content: 'a', status: 'in_progress' },
          { content: 'b', status: 'pending' },
        ]),
        turnEnd(2, 1, { kind: 'error' }),
      ],
      'S',
    )
    const tasks = nodes.filter((n) => n.type === 'task')
    expect(tasks.every((t) => t.data.status === 'failed')).toBe(true)
  })

  it('does not create edge from user_prompt to task when turn has no todo/write', () => {
    const { edges, nodes } = inferTaskGraph(
      [
        userMessage(1, 1, '空 prompt'),
      ],
      'S',
    )
    // user prompt 节点存在，但没有任何 task → 也没 user→task 边
    expect(nodes.some((n) => n.type === 'user-prompt')).toBe(true)
    const taskEdges = edges.filter((e) => e.target.startsWith('todo-'))
    expect(taskEdges).toHaveLength(0)
  })

  it('exposes TodoItem status directly: pending/in_progress/completed map to TaskStatus', () => {
    const { nodes } = inferTaskGraph(
      [
        todoWrite(1, 1, [
          { content: 'p', status: 'pending' },
          { content: 'r', status: 'in_progress' },
          { content: 'd', status: 'completed' },
        ]),
      ],
      'S',
    )
    const tasks = nodes.filter((n) => n.type === 'task')
    const byContent = new Map(tasks.map((t) => [t.data.label, t.data.status]))
    expect(byContent.get('p')).toBe('pending')
    expect(byContent.get('r')).toBe('running')
    expect(byContent.get('d')).toBe('done')
  })
})
