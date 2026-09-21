/**
 * inferTaskGraph 纯函数测试。
 *
 * 不依赖 React / cordis / dsh-client-store —— 只断言 events → { nodes, edges }
 * 的转换规则（research/0002 §五 + ADR 0001 §五）。
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionEventLikeEntry as SessionEventLikeEntryFromController } from '@deepseek-ai/dsh-api-session-controller/client'
import { inferTaskGraph } from '../../src/client/task-graph/infer.js'

// 两个包对 SessionEventLikeEntry 的定义是结构等价的；用 controller 包的版本作为
// 测试入参（更接近运行时真实类型），通过 unknown 中转避开 branded id 的 import 噪音。
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

function makeSession(callId: string, isError: boolean) {
  return ev(4, 'tool/result', {
    turn: 1,
    step: 1,
    message: {
      id: 'r1' as never,
      role: 'user',
      content: [{ type: 'tool-result', toolCallId: callId as never, content: [], isError }],
      source: { kind: 'tool', callId: callId as never },
    },
  })
}

describe('inferTaskGraph', () => {
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

  it('infers a done step from step/start + step/end', () => {
    const { nodes, edges } = inferTaskGraph(
      [
        ev(1, 'step/start', { turn: 1, step: 1 }),
        ev(2, 'step/end', { turn: 1, step: 1 }),
      ],
      'S',
    )
    const stepNode = nodes.find((n) => n.id === 'step-1-1')
    expect(stepNode?.data.status).toBe('done')
    expect(edges.find((e) => e.source === 'root' && e.target === 'step-1-1')).toBeTruthy()
  })

  it('keeps a step as running when step/end is absent (still open)', () => {
    const { nodes } = inferTaskGraph([ev(1, 'step/start', { turn: 2, step: 1 })], 'S')
    const stepNode = nodes.find((n) => n.id === 'step-2-1')
    expect(stepNode?.data.status).toBe('running')
  })

  it('labels a step from the first assistant/message paragraph', () => {
    const { nodes } = inferTaskGraph(
      [
        ev(1, 'step/start', { turn: 1, step: 1 }),
        ev(2, 'assistant/message', {
          turn: 1,
          step: 1,
          message: {
            id: 'm1' as never,
            role: 'assistant',
            content: [{ type: 'text', text: 'Read file X\nthen summarize' }],
            source: {
              kind: 'model',
              provider: 'p',
              model: 'm',
            },
          },
          stream: [],
          usage: undefined,
          interrupted: undefined,
        }),
        ev(3, 'step/end', { turn: 1, step: 1 }),
      ],
      'S',
    )
    const stepNode = nodes.find((n) => n.id === 'step-1-1')
    expect(stepNode?.data.label).toBe('Read file X')
  })

  it('does NOT create a node for tool-call (v0.2: trajectory is owned by DSH)', () => {
    const { nodes, edges } = inferTaskGraph(
      [
        ev(1, 'step/start', { turn: 1, step: 1 }),
        ev(2, 'tool/call', {
          turn: 1,
          step: 1,
          callId: 'c1' as never,
          name: 'Read',
          arguments: '{}',
        }),
      ],
      'S',
    )
    // tool-call 节点不存在；只有 root + step
    expect(nodes).toHaveLength(2)
    expect(nodes.find((n) => n.id === 'tool-c1')).toBeUndefined()
    // 边只有 root → step，不存在 step → tool-c1
    expect(edges.find((e) => e.target === 'tool-c1')).toBeUndefined()
  })

  it('tool/result errors escalate the parent step to failed (tool node is absent)', () => {
    const errEntries: Entry[] = [
      ev(1, 'step/start', { turn: 1, step: 1 }),
      ev(2, 'tool/call', {
        turn: 1,
        step: 1,
        callId: 'err' as never,
        name: 'Read',
        arguments: '{}',
      }),
      makeSession('err', true),
      ev(5, 'step/end', { turn: 1, step: 1 }),
    ]
    const { nodes } = inferTaskGraph(errEntries, 'S')
    // tool 节点不存在
    expect(nodes.find((n) => n.id === 'tool-err')).toBeUndefined()
    // 父 step 升级为 failed
    expect(nodes.find((n) => n.id === 'step-1-1')?.data.status).toBe('failed')
  })

  it('tool/result without error keeps parent step as done', () => {
    const entries: Entry[] = [
      ev(1, 'step/start', { turn: 1, step: 1 }),
      ev(2, 'tool/call', {
        turn: 1,
        step: 1,
        callId: 'ok' as never,
        name: 'Read',
        arguments: '{}',
      }),
      makeSession('ok', false),
      ev(5, 'step/end', { turn: 1, step: 1 }),
    ]
    const { nodes } = inferTaskGraph(entries, 'S')
    expect(nodes.find((n) => n.id === 'tool-ok')).toBeUndefined()
    expect(nodes.find((n) => n.id === 'step-1-1')?.data.status).toBe('done')
  })

  it('marks step as waiting when approval tool/call arrived but tool/result did not', () => {
    const { nodes } = inferTaskGraph(
      [
        ev(1, 'step/start', { turn: 1, step: 1 }),
        ev(2, 'tool/call', {
          turn: 1,
          step: 1,
          callId: 'a' as never,
          name: 'approval_run_command',
          arguments: '{}',
        }),
        ev(3, 'step/end', { turn: 1, step: 1 }),
      ],
      'S',
    )
    expect(nodes.find((n) => n.id === 'step-1-1')?.data.status).toBe('waiting')
    // approval tool 节点不存在
    expect(nodes.find((n) => n.id === 'tool-a')).toBeUndefined()
  })

  it('transitions waiting step to done when approval tool/result arrives', () => {
    const { nodes } = inferTaskGraph(
      [
        ev(1, 'step/start', { turn: 1, step: 1 }),
        ev(2, 'tool/call', {
          turn: 1,
          step: 1,
          callId: 'a' as never,
          name: 'approval_run_command',
          arguments: '{}',
        }),
        makeSession('a', false),
        ev(4, 'step/end', { turn: 1, step: 1 }),
      ],
      'S',
    )
    expect(nodes.find((n) => n.id === 'step-1-1')?.data.status).toBe('done')
  })

  it('extracts multiple step labels from a Markdown checkbox list', () => {
    const { nodes } = inferTaskGraph(
      [
        ev(1, 'step/start', { turn: 1, step: 1 }),
        ev(2, 'assistant/message', {
          turn: 1,
          step: 1,
          message: {
            id: 'm1' as never,
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: '我会：\n- [ ] 起草提纲\n- [ ] 写正文\n- [ ] 校对\n',
              },
            ],
            source: { kind: 'model', provider: 'p', model: 'm' },
          },
          stream: [],
          usage: undefined,
          interrupted: undefined,
        }),
        ev(3, 'step/end', { turn: 1, step: 1 }),
      ],
      'S',
    )
    // 原 step 拿第 1 个 label；其余拆为兄弟 step 节点
    expect(nodes.find((n) => n.id === 'step-1-1')?.data.label).toBe('起草提纲')
    expect(nodes.find((n) => n.id === 'step-1-1-L1')?.data.label).toBe('写正文')
    expect(nodes.find((n) => n.id === 'step-1-1-L2')?.data.label).toBe('校对')
    // 拆出的兄弟节点状态为 done（在已关闭 step 内）
    expect(nodes.find((n) => n.id === 'step-1-1-L1')?.data.status).toBe('done')
    expect(nodes.find((n) => n.id === 'step-1-1-L2')?.data.status).toBe('done')
    // 兄弟节点也是 root 的子节点（边：root → sib）
    expect(
      nodes
        .map((n) => n.id)
        // 验存在性即可，边的断言由视图层负责
        .filter((id) => id === 'step-1-1-L1' || id === 'step-1-1-L2'),
    ).toHaveLength(2)
  })

  it('extracts multiple step labels from a numbered list', () => {
    const { nodes } = inferTaskGraph(
      [
        ev(1, 'step/start', { turn: 1, step: 1 }),
        ev(2, 'assistant/message', {
          turn: 1,
          step: 1,
          message: {
            id: 'm2' as never,
            role: 'assistant',
            content: [
              { type: 'text', text: '步骤：\n1. 读文件\n2. 写文件\n3. 提交' },
            ],
            source: { kind: 'model', provider: 'p', model: 'm' },
          },
          stream: [],
          usage: undefined,
          interrupted: undefined,
        }),
        ev(3, 'step/end', { turn: 1, step: 1 }),
      ],
      'S',
    )
    expect(nodes.find((n) => n.id === 'step-1-1')?.data.label).toBe('读文件')
    expect(nodes.find((n) => n.id === 'step-1-1-L1')?.data.label).toBe('写文件')
    expect(nodes.find((n) => n.id === 'step-1-1-L2')?.data.label).toBe('提交')
  })

  it('falls back to first-line label when no list pattern matches', () => {
    const { nodes } = inferTaskGraph(
      [
        ev(1, 'step/start', { turn: 1, step: 1 }),
        ev(2, 'assistant/message', {
          turn: 1,
          step: 1,
          message: {
            id: 'm3' as never,
            role: 'assistant',
            content: [{ type: 'text', text: 'Just a plain sentence.\nMore lines below.' }],
            source: { kind: 'model', provider: 'p', model: 'm' },
          },
          stream: [],
          usage: undefined,
          interrupted: undefined,
        }),
        ev(3, 'step/end', { turn: 1, step: 1 }),
      ],
      'S',
    )
    expect(nodes.find((n) => n.id === 'step-1-1')?.data.label).toBe('Just a plain sentence.')
    // 没有拆出兄弟节点
    expect(nodes.find((n) => n.id === 'step-1-1-L1')).toBeUndefined()
  })

  it('mixes checkbox and ordered-list patterns in document order', () => {
    const { nodes } = inferTaskGraph(
      [
        ev(1, 'step/start', { turn: 1, step: 1 }),
        ev(2, 'assistant/message', {
          turn: 1,
          step: 1,
          message: {
            id: 'm4' as never,
            role: 'assistant',
            content: [
              {
                type: 'text',
                text: '我打算：\n1. 读 x\n- [ ] 写 y\n2. 提交',
              },
            ],
            source: { kind: 'model', provider: 'p', model: 'm' },
          },
          stream: [],
          usage: undefined,
          interrupted: undefined,
        }),
        ev(3, 'step/end', { turn: 1, step: 1 }),
      ],
      'S',
    )
    // 按出现顺序：1. 读 x → 原 step；- [ ] 写 y → L1；2. 提交 → L2
    expect(nodes.find((n) => n.id === 'step-1-1')?.data.label).toBe('读 x')
    expect(nodes.find((n) => n.id === 'step-1-1-L1')?.data.label).toBe('写 y')
    expect(nodes.find((n) => n.id === 'step-1-1-L2')?.data.label).toBe('提交')
  })

  it('does not split when the step already has a custom label', () => {
    // 第二个 assistant/message 来时 step 已有 assistantLabel，label 守卫生效，
    // 不应拆出兄弟节点。
    const { nodes } = inferTaskGraph(
      [
        ev(1, 'step/start', { turn: 1, step: 1 }),
        ev(2, 'assistant/message', {
          turn: 1,
          step: 1,
          message: {
            id: 'm5' as never,
            role: 'assistant',
            content: [{ type: 'text', text: '自定义一句' }],
            source: { kind: 'model', provider: 'p', model: 'm' },
          },
          stream: [],
          usage: undefined,
          interrupted: undefined,
        }),
        ev(3, 'assistant/message', {
          turn: 1,
          step: 1,
          message: {
            id: 'm6' as never,
            role: 'assistant',
            content: [{ type: 'text', text: '- [ ] 再来一个\n- [ ] 又一个' }],
            source: { kind: 'model', provider: 'p', model: 'm' },
          },
          stream: [],
          usage: undefined,
          interrupted: undefined,
        }),
        ev(4, 'step/end', { turn: 1, step: 1 }),
      ],
      'S',
    )
    expect(nodes.find((n) => n.id === 'step-1-1')?.data.label).toBe('自定义一句')
    expect(nodes.find((n) => n.id === 'step-1-1-L1')).toBeUndefined()
  })

  it('handles out-of-order seq defensively by sorting events', () => {
    const { nodes } = inferTaskGraph(
      [
        ev(5, 'step/end', { turn: 1, step: 1 }),
        ev(1, 'step/start', { turn: 1, step: 1 }),
      ],
      'S',
    )
    const stepNode = nodes.find((n) => n.id === 'step-1-1')
    expect(stepNode?.data.status).toBe('done')
  })
})
