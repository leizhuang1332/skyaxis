/**
 * inferTaskGraph 纯函数测试。
 *
 * 不依赖 React / cordis / dsh-client-store —— 只断言 events → { nodes, edges }
 * 的转换规则（research/0002 §五 + ADR 0001 §五）。
 */
import { describe, expect, it } from 'vitest'
import type {
  AssistantLiveChunkEvent,
  SessionEvent,
  SessionEventLikeEntry,
} from '@deepseek-ai/dsh-session'
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
    } as AssistantLiveChunkEvent,
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
        ev(2, 'step/end', {
          turn: 1,
          step: 1,
          reason: { kind: 'completed' },
        }),
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
        ev(3, 'step/end', { turn: 1, step: 1, reason: { kind: 'completed' } }),
      ],
      'S',
    )
    const stepNode = nodes.find((n) => n.id === 'step-1-1')
    expect(stepNode?.data.label).toBe('Read file X')
  })

  it('attaches tool-call nodes under the open step', () => {
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
    expect(nodes.find((n) => n.id === 'tool-c1')).toBeTruthy()
    expect(edges.find((e) => e.source === 'step-1-1' && e.target === 'tool-c1')).toBeTruthy()
  })

  it('marks tool-call as done after tool/result, or failed when isError', () => {
    const okEntries: Entry[] = [
      ev(1, 'step/start', { turn: 1, step: 1 }),
      ev(2, 'tool/call', { turn: 1, step: 1, callId: 'ok' as never, name: 'Read', arguments: '{}' }),
      makeSession('ok', false),
    ]
    const okTool = inferTaskGraph(okEntries, 'S').nodes.find((n) => n.id === 'tool-ok')
    expect(okTool?.data.status).toBe('done')

    const errEntries: Entry[] = [
      ev(1, 'step/start', { turn: 1, step: 1 }),
      ev(2, 'tool/call', { turn: 1, step: 1, callId: 'err' as never, name: 'Read', arguments: '{}' }),
      makeSession('err', true),
    ]
    const errTool = inferTaskGraph(errEntries, 'S').nodes.find((n) => n.id === 'tool-err')
    expect(errTool?.data.status).toBe('failed')
  })

  it('escalates the parent step to failed when any contained tool errored', () => {
    const entries: Entry[] = [
      ev(1, 'step/start', { turn: 1, step: 1 }),
      ev(2, 'tool/call', { turn: 1, step: 1, callId: 'e' as never, name: 'Bash', arguments: '{}' }),
      makeSession('e', true),
      ev(5, 'step/end', { turn: 1, step: 1, reason: { kind: 'completed' } }),
    ]
    const { nodes } = inferTaskGraph(entries, 'S')
    const stepNode = nodes.find((n) => n.id === 'step-1-1')
    expect(stepNode?.data.status).toBe('failed')
  })

  it('marks approval_* tool names as approval nodes', () => {
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
      ],
      'S',
    )
    expect(nodes.find((n) => n.id === 'tool-a')?.type).toBe('approval')
  })

  it('handles out-of-order seq defensively by sorting events', () => {
    const { nodes } = inferTaskGraph(
      [
        ev(5, 'step/end', { turn: 1, step: 1, reason: { kind: 'completed' } }),
        ev(1, 'step/start', { turn: 1, step: 1 }),
      ],
      'S',
    )
    const stepNode = nodes.find((n) => n.id === 'step-1-1')
    expect(stepNode?.data.status).toBe('done')
  })
})
