/**
 * 明细面板模型测试（v0.4 切片 B）：panelModelFor 纯选择器 + formatDuration。
 *
 * 组合面与 connector 同序（fold → project → panelModelFor(document, node)），
 * 钉七 kind 面板形状与诚实降级路径（缺失数据不臆造）。
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { foldSessionDocument } from '../../../src/client/task-graph/document/fold.js'
import { projectTaskChain } from '../../../src/client/task-graph/projections/task-chain.js'
import {
  formatDuration,
  panelModelFor,
} from '../../../src/client/task-graph/projections/panel-model.js'
import type { TaskNode } from '../../../src/client/task-graph/types.js'

function ev<T extends SessionEvent['type']>(
  seq: number,
  type: T,
  data: SessionEvent<T>['data'],
): SessionEvent {
  return { type, seq: seq as never, time: seq * 1000, data } as SessionEvent
}

const userMessage = (seq: number, text: string): SessionEvent =>
  ev(seq, 'user/message', {
    id: `u${seq}` as never,
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  } as never)

const turnStart = (seq: number, turn: number): SessionEvent => ev(seq, 'turn/start', { turn })

const turnEnd = (
  seq: number,
  turn: number,
  reason: { kind: string; [k: string]: unknown },
): SessionEvent => ev(seq, 'turn/end', { turn, reason: reason as never })

const todoWrite = (
  seq: number,
  todos: readonly { content: string; status: string }[],
): SessionEvent => ev(seq, 'todo/write', { todos } as never)

const toolCall = (
  seq: number,
  turn: number,
  callId: string,
  name: string,
  args: string,
): SessionEvent =>
  ev(seq, 'tool/call', { turn, step: 1, callId, name, arguments: args } as never)

const toolResult = (
  seq: number,
  turn: number,
  callId: string,
  opts: { isError?: boolean; error?: { name: string; code: string; reason?: string }; text?: string } = {},
): SessionEvent =>
  ev(seq, 'tool/result', {
    turn,
    step: 1,
    message: {
      id: `tr${seq}` as never,
      role: 'tool',
      content: [{ type: 'text', text: opts.text ?? '' }],
      source: { kind: 'tool', callId },
      toolCallId: callId,
      ...(opts.isError === true ? { isError: true } : {}),
    },
    ...(opts.error === undefined ? {} : { error: opts.error }),
  } as never)

const catalogEvent = (seq: number, childId: string): SessionEvent =>
  ev(seq, 'subagent/catalog', { childId, childCreatedAt: 0, version: 0, mode: 'one-shot' } as never)

function docOf(events: readonly SessionEvent[]) {
  const document = foldSessionDocument({
    sessionId: 's1' as SessionId,
    events,
    hasMore: false,
    label: 'Session s1',
    rootStatus: 'running',
  })
  return { document, graph: projectTaskChain(document) }
}

const nodeOf = (nodes: readonly TaskNode[], id: string): TaskNode => {
  const n = nodes.find((x) => x.id === id)
  if (n === undefined) throw new Error(`node ${id} not found`)
  return n
}

describe('panelModelFor', () => {
  it('root panel carries document root facts and hasMore', () => {
    const { document } = docOf([userMessage(1, 'hi')])
    const model = panelModelFor(document, {
      id: 'root',
      type: 'root',
      position: { x: 0, y: 0 },
      data: { label: 'whatever' }, // 面板从文档取，不信节点副本
    })
    expect(model).toMatchObject({ kind: 'root', label: 'Session s1', status: 'running', hasMore: false })
  })

  it('user-prompt panel aggregates the turn: full messages, duration, end reason, activities', () => {
    const { document, graph } = docOf([
      userMessage(1, '第一行\n第二行全文在面板可见'),
      turnStart(2, 1),
      toolCall(3, 1, 'c1', 'bash', '{"cmd":"ls"}'),
      toolResult(4, 1, 'c1', {
        isError: true,
        error: { name: 'E', code: 'EXIT_1', reason: '没找到命令' },
        text: 'exit 1',
      }),
      turnEnd(5, 1, { kind: 'error', error: { message: 'turn 炸了', code: 'UNKNOWN' } }),
    ])
    // user/message 自增到 1 后 turnStart 也指 1 —— prompt 与 todo 同 turn。
    const promptNode = graph.nodes.find((n) => n.type === 'user-prompt')!
    const model = panelModelFor(document, promptNode)
    expect(model.kind).toBe('turn')
    if (model.kind !== 'turn') return
    expect(model.messages[0]!.text).toBe('第一行\n第二行全文在面板可见')
    expect(model.durationMs).toBe(3000) // 2000..5000
    expect(model.endReason).toEqual({ kind: 'error', message: 'turn 炸了', code: 'UNKNOWN' })
    expect(model.activities).toHaveLength(1)
    expect(model.activities[0]).toMatchObject({
      kind: 'tool-call',
      title: 'bash',
      durationMs: 1000,
      isError: true,
    })
    expect(promptNode.data.durationMs).toBe(3000) // 节点 tooltip 同源时长
  })

  it('turn panel degrades honestly: open turn has no duration / endReason / activities row', () => {
    const { document, graph } = docOf([userMessage(1, '还没结束'), turnStart(2, 1)])
    const promptNode = graph.nodes.find((n) => n.type === 'user-prompt')!
    const model = panelModelFor(document, promptNode)
    if (model.kind !== 'turn') throw new Error('expected turn')
    expect(model.durationMs).toBeUndefined()
    expect(model.endReason).toBeUndefined()
    expect(model.activities).toEqual([])
  })

  it('task panel shows full content and the revision timeline', () => {
    const { document, graph } = docOf([
      todoWrite(1, [{ content: 'x'.repeat(200), status: 'pending' }]),
      todoWrite(2, [{ content: 'x'.repeat(200), status: 'in_progress' }]),
    ])
    const taskNode = graph.nodes.find((n) => n.type === 'task')!
    expect(taskNode.data.label.length).toBeLessThanOrEqual(80) // 画布截断
    const model = panelModelFor(document, taskNode)
    if (model.kind !== 'task') throw new Error('expected task')
    expect(model.content).toBe('x'.repeat(200)) // 面板全文
    expect(model.history.map((r) => r.status)).toEqual(['pending', 'in_progress'])
    expect(model.history.map((r) => r.turn)).toEqual([0, 0])
  })

  it('subagent panel resolves spawn facts by childId and keeps navigation', () => {
    const { document } = docOf([
      catalogEvent(1, 'child-7'),
      toolCall(2, 1, 'c1', 'subagent', '{"prompt":"去调研","description":"调研员"}'),
      toolResult(3, 1, 'c1', { text: 'started subagent child-7' }),
    ])
    const node: TaskNode = {
      id: 'subagent:child-7',
      type: 'subagent',
      position: { x: 0, y: 0 },
      data: { label: 'child-7', status: 'running', navigable: true, navigationId: 'child-7' },
    }
    const model = panelModelFor(document, node)
    if (model.kind !== 'subagent') throw new Error('expected subagent')
    expect(model.spawn).toEqual({ childId: 'child-7' as never, description: '调研员', promptText: '去调研' })
    expect(model.navigable).toBe(true)
    expect(model.navigationId).toBe('child-7')
  })

  it('subagent panel omits spawn when the window has no matching spawn fact', () => {
    const { document } = docOf([userMessage(1, 'hi')])
    const node: TaskNode = {
      id: 'subagent:other',
      type: 'subagent',
      position: { x: 0, y: 0 },
      data: { label: 'other', navigable: false },
    }
    const model = panelModelFor(document, node)
    if (model.kind !== 'subagent') throw new Error('expected subagent')
    expect(model.spawn).toBeUndefined()
  })

  it('workflow panel carries definition + duration from node data', () => {
    const { document } = docOf([])
    const node: TaskNode = {
      id: 'workflow:r1',
      type: 'workflow',
      position: { x: 0, y: 0 },
      data: {
        label: 'run',
        status: 'done',
        durationMs: 90_000,
        definition: {
          script: 'doThing()',
          meta: { name: 'run' },
          callSeq: 1,
        },
      },
    }
    const model = panelModelFor(document, node)
    if (model.kind !== 'workflow') throw new Error('expected workflow')
    expect(model.durationMs).toBe(90_000)
    expect(model.definition?.script).toBe('doThing()')
  })

  it('workflow-member falls back to the generic node panel', () => {
    const { document } = docOf([])
    const node: TaskNode = {
      id: 'workflow-member:r1:1',
      type: 'workflow-member',
      position: { x: 0, y: 0 },
      data: { label: 'm', status: 'running', navigable: true, navigationId: 'm-sess' },
    }
    const model = panelModelFor(document, node)
    expect(model).toMatchObject({
      kind: 'node',
      label: 'm',
      status: 'running',
      navigable: true,
      navigationId: 'm-sess',
    })
  })

  it('defensive: unknown node ids degrade to generic panels, never throw', () => {
    const { document } = docOf([])
    const orphan: TaskNode = {
      id: 'user-999',
      type: 'user-prompt',
      position: { x: 0, y: 0 },
      data: { label: '找不到 turn' },
    }
    expect(panelModelFor(document, orphan)).toMatchObject({ kind: 'node', label: '找不到 turn' })
  })
})

describe('formatDuration', () => {
  it('formats ms / seconds / minutes / hours with human bounds', () => {
    expect(formatDuration(340)).toBe('340ms')
    expect(formatDuration(3200)).toBe('3.2s')
    expect(formatDuration(125_000)).toBe('2m 05s')
    expect(formatDuration(3_660_000)).toBe('1h 01m')
  })
  it('clamps negatives to zero', () => {
    expect(formatDuration(-50)).toBe('0ms')
  })
})
