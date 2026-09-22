/**
 * inferTaskGraph 纯函数测试（v0.3 + P0 节点身份稳定化）。
 *
 * 不依赖 React / cordis / dsh-client-store —— 只断言 events → { nodes, edges }
 * 的转换规则（research/0002 §五 + ADR 0001 §五 + v0.3 plan + P0 content 锚定）。
 *
 * v0.3 输入事件集合：
 *   - user/message (kind: 'user')   → user-prompt 节点
 *   - todo/write                    → task 节点（DAG 边）
 *   - turn/end (reason.kind)        → 影响该 turn 内 task 终态
 * 其他事件类型全部不参与推断。
 *
 * P0 关键契约：task 节点 ID = `todo-{turn}-{contentHash}`，同 content 跨
 * todo/write 复用同一个节点（原位更新 status）。断言优先按 label 查找节点，
 * 另设专门用例正面证明 ID 跨 write 稳定。
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionEventLikeEntry as SessionEventLikeEntryFromController } from '@deepseek-ai/dsh-api-session-controller/client'
import { inferTaskGraph } from '../../src/client/task-graph/infer.js'

type Entry = SessionEventLikeEntryFromController

/** 按 label 查 task 节点（P0 后 ID 含 contentHash，断言应松耦合）。 */
function findTaskByLabel(
  nodes: ReturnType<typeof inferTaskGraph>['nodes'],
  label: string,
) {
  return nodes.find((n) => n.type === 'task' && n.data.label === label)
}

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
    // seq=5 在后（更晚发生），按 seq 升序处理：先压 A，再压 B 替换整个列表。
    // P0 content 锚定：仅保留最后的 content='B' 节点，'A' 已不在列表 → 删除。
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
    // 同 turn 内顺序边：读文件 → 写文件, 写文件 → 提交
    const read = findTaskByLabel(nodes, '读文件')!
    const write = findTaskByLabel(nodes, '写文件')!
    const commit = findTaskByLabel(nodes, '提交')!
    expect(
      edges.find((e) => e.source === read!.id && e.target === write!.id),
    ).toBeTruthy()
    expect(
      edges.find((e) => e.source === write!.id && e.target === commit!.id),
    ).toBeTruthy()
  })

  it('creates linear edges between consecutive tasks in same turn', () => {
    const { edges, nodes } = inferTaskGraph(
      [
        todoWrite(1, 1, [
          { content: 'a', status: 'pending' },
          { content: 'b', status: 'pending' },
          { content: 'c', status: 'pending' },
        ]),
      ],
      'S',
    )
    const ta = findTaskByLabel(nodes, 'a')!
    const tb = findTaskByLabel(nodes, 'b')!
    const tc = findTaskByLabel(nodes, 'c')!
    expect(edges.find((e) => e.source === ta.id && e.target === tb.id)).toBeTruthy()
    expect(edges.find((e) => e.source === tb.id && e.target === tc.id)).toBeTruthy()
    expect(edges.find((e) => e.source === ta.id && e.target === tc.id)).toBeFalsy()
  })

  it('reuses node identity and updates status across todo/write with same content (P0)', () => {
    // 同 content 跨 write 复用同一节点（ID 稳定），status 原位更新。
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
    // P0：同 content 'a' 复用节点 + 新增 'b' → 仍为 2 个节点
    expect(tasks).toHaveLength(2)
    expect(tasks.map((t) => t.data.label)).toEqual(['a', 'b'])
    // 同 turn 内 a → b 一条顺序边
    const ta = findTaskByLabel(nodes, 'a')!
    const tb = findTaskByLabel(nodes, 'b')!
    expect(edges.find((e) => e.source === ta.id && e.target === tb.id)).toBeTruthy()
  })

  it('reuses the same node id across todo/write when content matches and persists status (P0)', () => {
    // P0 核心契约：同 content 的节点 ID 跨 writeSeq 稳定，status 原位更新。
    const { nodes } = inferTaskGraph(
      [
        todoWrite(1, 1, [
          { content: 'unchanged', status: 'pending' },
          { content: 'unchanged', status: 'pending' },
        ]),
        todoWrite(2, 1, [
          { content: 'unchanged', status: 'completed' },
          { content: 'unchanged', status: 'in_progress' },
        ]),
      ],
      'S',
    )
    const tasks = nodes.filter((n) => n.type === 'task')
    // 两次 write 都只对这两个 content 做状态更新，不会重建节点、不增不删。
    expect(tasks).toHaveLength(2)
    const done = tasks.find((t) => t.data.status === 'done')
    const running = tasks.find((t) => t.data.status === 'running')
    expect(done).toBeTruthy()
    expect(running).toBeTruthy()
    // 两个 distinct 节点（各自一条 dom 记录）
    expect(done!.id).not.toBe(running!.id)
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
    const { edges, nodes } = inferTaskGraph(
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
    const firstTask = findTaskByLabel(nodes, 't1')!
    expect(edges.find((e) => e.source === userId && e.target === firstTask.id)).toBeTruthy()
    // user → t2 不会有
    const secondTask = findTaskByLabel(nodes, 't2')!
    expect(
      edges.find((e) => e.source === userId && e.target === secondTask.id),
    ).toBeFalsy()
  })

  it('connects last task of turn_N to first task of turn_{N+1} (cross-turn chain)', () => {
    const { edges, nodes } = inferTaskGraph(
      [
        todoWrite(1, 1, [
          { content: 'a', status: 'pending' },
          { content: 'b', status: 'pending' },
        ]),
        todoWrite(2, 2, [{ content: 'c', status: 'pending' }]),
      ],
      'S',
    )
    const lastTurn1 = findTaskByLabel(nodes, 'b')!
    const firstTurn2 = findTaskByLabel(nodes, 'c')!
    expect(
      edges.find(
        (e) => e.source === lastTurn1.id && e.target === firstTurn2.id,
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

  // -------------- P0 节点身份稳定化核心契约 --------------

  it('keeps the same task node id across two todo/write with matching content (P0)', () => {
    // P0 价值的核心证明：content 锚定的节点跨 writeSeq 保持同一 ID，
    // 而非 whole-list 全删重建（重建会让 React Flow 整树 remount / 拖拽丢失）。
    const { nodes } = inferTaskGraph(
      [
        todoWrite(1, 1, [
          { content: 'design doc', status: 'pending' },
          { content: 'implement', status: 'pending' },
        ]),
        todoWrite(2, 1, [
          { content: 'design doc', status: 'completed' },
          { content: 'implement', status: 'in_progress' },
        ]),
      ],
      'S',
    )
    const tasks = nodes.filter((n) => n.type === 'task')
    expect(tasks).toHaveLength(2)

    const design = findTaskByLabel(nodes, 'design doc')!
    const impl = findTaskByLabel(nodes, 'implement')!
    // 节点数仍为 2、content 都匹配 → 不是重建，是复用
    expect(design.id).toMatch(/^todo-1-[\w]+$/)
    expect(impl.id).toMatch(/^todo-1-[\w]+$/)
    expect(design.id).not.toBe(impl.id)

    const designStatus = design.data.status
    const implStatus = impl.data.status
    expect(designStatus).toBe('done')
    expect(implStatus).toBe('running')
  })

  it('assigns distinct node ids to duplicate content within the same turn (P0)', () => {
    // 同 turn 内 content 重复（脏数据边界）→ 加序号后缀避免 ID 碰撞，两个独立节点。
    const { nodes } = inferTaskGraph(
      [
        todoWrite(1, 1, [
          { content: 'dup', status: 'pending' },
          { content: 'dup', status: 'pending' },
        ]),
      ],
      'S',
    )
    const tasks = nodes.filter((n) => n.type === 'task')
    expect(tasks).toHaveLength(2)
    expect(tasks[0]!.id).not.toBe(tasks[1]!.id)
    // 两个节点 id 都是 todo-1-<hash>#<suffix> 形式
    for (const t of tasks) {
      expect(t.id).toMatch(/^todo-1-[\w]+(#\d+)?$/)
    }
  })

  it('keeps content-anchored id stable after a state-only write (P0)', () => {
    // status 更新发射第二份 todo/write，但 content 集合不变 → 节点数、ID 全不变，
    // 只有 status 字段变化。这是"同 ID 取最新 revision"折叠的等价表达。
    const { nodes: first } = inferTaskGraph(
      [todoWrite(1, 1, [{ content: 'only-task', status: 'pending' }])],
      'S',
    )
    const { nodes: second } = inferTaskGraph(
      [
        todoWrite(1, 1, [{ content: 'only-task', status: 'pending' }]),
        todoWrite(2, 1, [{ content: 'only-task', status: 'in_progress' }]),
      ],
      'S',
    )
    const firstTask = first.find((n) => n.type === 'task')!
    const secondTask = second.find((n) => n.type === 'task')!
    // 同一个逻辑节点 → 同一个 id（content 锚定）
    expect(secondTask.id).toBe(firstTask.id)
    expect(firstTask.data.status).toBe('pending')
    expect(secondTask.data.status).toBe('running')
  })
})
