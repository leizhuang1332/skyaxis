/**
 * 文档层折叠测试（v0.4 切片 A，ADR 0036）：facts → SessionDocument 纯函数。
 *
 * 不依赖 React / cordis —— 只断言事件流 → 规范化事实集的折叠规则。
 * 承接退役 infer.test.ts 的归属语义（环境回合计数、turn/start 覆盖的
 * 微妙行为），并钉切片 A 的语义修正：全局身份 / 修订史 / 退役复活 /
 * 七种 turn-end reason 全息 / 一 turn 全量人类消息 / hasMore 透传。
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import { foldSessionDocument } from '../../../src/client/task-graph/document/fold.js'
import type { TaskGraphFacts } from '../../../src/client/task-graph/document/types.js'
import { hashContent } from '../../../src/client/task-graph/document/identity.js'

/** 事件构造（类型经 unknown 中转，测试夹具专用；time 用 seq*1000 保确定性）。 */
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

function turnEnd(seq: number, turn: number, reason: { kind: string; [k: string]: unknown }): SessionEvent {
  return ev(seq, 'turn/end', { turn, reason: reason as never })
}

function userMessage(
  seq: number,
  text: string,
  sourceKind: 'user' | 'plugin' = 'user',
): SessionEvent {
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

function toolCall(
  seq: number,
  turn: number,
  step: number,
  callId: string,
  name: string,
  args: string,
): SessionEvent {
  return ev(seq, 'tool/call', { turn, step, callId, name, arguments: args } as never)
}

function toolResult(
  seq: number,
  turn: number,
  step: number,
  callId: string,
  opts: {
    isError?: boolean
    error?: { name: string; code: string; reason?: string }
    text?: string
  } = {},
): SessionEvent {
  return ev(seq, 'tool/result', {
    turn,
    step,
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
}

function assistantMessage(
  seq: number,
  turn: number,
  step: number,
  opts: {
    text?: string
    reasoning?: string
    provider?: string
    model?: string
    usage?: { inputTokens: number; outputTokens: number }
    interrupted?: true
  } = {},
): SessionEvent {
  return ev(seq, 'assistant/message', {
    turn,
    step,
    message: {
      id: `m${seq}` as never,
      role: 'assistant',
      content: [{ type: 'text', text: opts.text ?? '' }],
      source: { kind: 'model', provider: opts.provider ?? 'p', model: opts.model ?? 'm' },
    },
    ...(opts.usage === undefined ? {} : { usage: opts.usage }),
    ...(opts.interrupted === undefined ? {} : { interrupted: opts.interrupted }),
  } as never)
}

/** 带 reasoning block 的 assistant 消息（message.content 双 block）。 */
function assistantMessageWithReasoning(
  seq: number,
  turn: number,
  step: number,
  text: string,
  reasoning: string,
): SessionEvent {
  return ev(seq, 'assistant/message', {
    turn,
    step,
    message: {
      id: `m${seq}` as never,
      role: 'assistant',
      content: [
        { type: 'reasoning', text: reasoning },
        { type: 'text', text },
      ],
      source: { kind: 'model', provider: 'acme', model: 'model-x' },
    },
  } as never)
}

function approvalAsked(
  seq: number,
  id: string,
  opts: { toolName?: string; callId?: string; reason?: string } = {},
): SessionEvent {
  return ev(seq, 'approval/asked', {
    id,
    toolName: opts.toolName ?? 'bash',
    ...(opts.callId === undefined ? {} : { callId: opts.callId }),
    ...(opts.reason === undefined ? {} : { reason: opts.reason }),
  } as never)
}

function approvalDecided(
  seq: number,
  id: string,
  outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable',
): SessionEvent {
  return ev(seq, 'approval/decided', { id, outcome } as never)
}

function catalogEvent(seq: number, childId: string): SessionEvent {
  return ev(seq, 'subagent/catalog', {
    childId,
    childCreatedAt: 0,
    version: 0,
    mode: 'one-shot',
  } as never)
}

function factsOf(
  events: readonly SessionEvent[],
  overrides: Partial<Pick<TaskGraphFacts, 'hasMore' | 'label' | 'rootStatus'>> = {},
): TaskGraphFacts {
  return {
    sessionId: 's1' as SessionId,
    events,
    hasMore: false,
    label: 'S1',
    rootStatus: 'running',
    ...overrides,
  }
}

describe('foldSessionDocument — 全局任务身份（ADR 0036 §2.3）', () => {
  it('merges same content across turns into one task with per-write history', () => {
    const doc = foldSessionDocument(
      factsOf([
        turnStart(1, 1),
        todoWrite(2, [
          { content: 'task-a', status: 'pending' },
          { content: 'task-b', status: 'pending' },
        ]),
        turnStart(3, 2),
        todoWrite(4, [
          { content: 'task-a', status: 'in_progress' },
          { content: 'task-b', status: 'completed' },
        ]),
      ]),
    )
    expect(doc.tasks.size).toBe(2)
    const a = doc.tasks.get(hashContent('task-a'))!
    expect(a.history).toHaveLength(2)
    expect(a.history.map((r) => r.turn)).toEqual([1, 2])
    expect(a.history.map((r) => r.status)).toEqual(['pending', 'in_progress'])
    expect(a.retired).toBeUndefined()
  })

  it('retires a key absent from the latest write and revives it on reappearance', () => {
    const doc = foldSessionDocument(
      factsOf([
        todoWrite(1, [
          { content: 'keep', status: 'pending' },
          { content: 'drop-me', status: 'pending' },
        ]),
        todoWrite(2, [{ content: 'keep', status: 'in_progress' }]),
        todoWrite(3, [
          { content: 'keep', status: 'completed' },
          { content: 'drop-me', status: 'pending' },
        ]),
      ]),
    )
    const dropped = doc.tasks.get(hashContent('drop-me'))!
    // 退役位在 write2 落、write3 复活清；history 三段不丢。
    expect(dropped.retired).toBeUndefined()
    expect(dropped.history.map((r) => r.seq)).toEqual([1, 3])

    const keep = doc.tasks.get(hashContent('keep'))!
    expect(keep.history).toHaveLength(3)
  })

  it('keeps retired entry (with its history) in the document after final disappearance', () => {
    const doc = foldSessionDocument(
      factsOf([
        todoWrite(1, [
          { content: 'gone', status: 'pending' },
          { content: 'stay', status: 'pending' },
        ]),
        todoWrite(2, [{ content: 'stay', status: 'completed' }]),
      ]),
    )
    const gone = doc.tasks.get(hashContent('gone'))!
    expect(gone.retired).toEqual({ seq: 2 })
    expect(gone.history).toHaveLength(1)
  })

  it('assigns #N suffix keys to duplicate content within one write', () => {
    const doc = foldSessionDocument(
      factsOf([
        todoWrite(1, [
          { content: 'dup', status: 'pending' },
          { content: 'dup', status: 'completed' },
        ]),
      ]),
    )
    expect(doc.tasks.size).toBe(2)
    expect(doc.tasks.get(hashContent('dup'))).toBeTruthy()
    expect(doc.tasks.get(`${hashContent('dup')}#1`)).toBeTruthy()
  })

  it('treats a rephrase as a new key (exact anchor, no fuzzy matching)', () => {
    const doc = foldSessionDocument(
      factsOf([
        todoWrite(1, [{ content: 'write tests', status: 'pending' }]),
        todoWrite(2, [{ content: 'write the tests', status: 'pending' }]),
      ]),
    )
    expect(doc.tasks.size).toBe(2)
    expect(doc.tasks.get(hashContent('write tests'))!.retired).toEqual({ seq: 2 })
  })
})

describe('foldSessionDocument — turn 事实', () => {
  it('records all seven turn/end reason kinds verbatim', () => {
    const reasons: { kind: string; [k: string]: unknown }[] = [
      { kind: 'completed' },
      { kind: 'aborted', reason: { kind: 'user' } },
      { kind: 'blocked' },
      { kind: 'error', error: { message: 'boom', code: 'RATE_LIMIT' } },
      { kind: 'max-tokens' },
      { kind: 'interrupted' },
      { kind: 'forked' },
    ]
    for (const [i, reason] of reasons.entries()) {
      const doc = foldSessionDocument(factsOf([turnEnd(i + 1, 1, reason)]))
      expect(doc.turns[0]!.endReason).toEqual(reason)
    }
  })

  it('records every human user message of a turn (not just the first)', () => {
    const doc = foldSessionDocument(
      factsOf([
        userMessage(1, '第一条'),
        userMessage(2, '补充一句'),
        userMessage(3, '[plugin]', 'plugin'),
      ]),
    )
    // 自增 turn：两条人类消息各自开新 turn（环境计数语义），plugin 不进。
    expect(doc.turns).toHaveLength(2)
    expect(doc.turns[0]!.userPromptRefs).toEqual(['ev:1'])
    expect(doc.turns[1]!.userPromptRefs).toEqual(['ev:2'])
    expect(doc.contents.get('ev:1')!.seq).toBe(1)
  })

  it('keeps startTime/endTime wall-clock facts from turn/start and turn/end', () => {
    const doc = foldSessionDocument(
      factsOf([turnStart(2, 7), turnEnd(9, 7, { kind: 'completed' })]),
    )
    expect(doc.turns[0]!.startTime).toBe(2000)
    expect(doc.turns[0]!.endTime).toBe(9000)
  })

  it('attributes todo/write to the ambient turn — turn/start override keeps prompt in its incremented turn (P1 平移)', () => {
    // 退役 infer 时代的微妙语义：user/message 自增到 1 后 turn/start 覆盖为 3，
    // prompt 留在 turn 1，todo 归 turn 3。
    const doc = foldSessionDocument(
      factsOf([
        userMessage(1, '开始'),
        turnStart(2, 3),
        todoWrite(3, [{ content: 'ambient', status: 'pending' }]),
      ]),
    )
    expect(doc.turns.find((t) => t.index === 1)!.userPromptRefs).toEqual(['ev:1'])
    const turn3 = doc.turns.find((t) => t.index === 3)!
    expect(turn3.finalListKeys).toEqual([hashContent('ambient')])
    expect(doc.tasks.get(hashContent('ambient'))!.history[0]!.turn).toBe(3)
  })

  it('records the final list keys of each turn (last write wins within the turn)', () => {
    const doc = foldSessionDocument(
      factsOf([
        turnStart(1, 1),
        todoWrite(2, [
          { content: 'a', status: 'pending' },
          { content: 'b', status: 'pending' },
        ]),
        todoWrite(3, [
          { content: 'a', status: 'in_progress' },
          { content: 'c', status: 'pending' },
        ]),
      ]),
    )
    expect(doc.turns[0]!.finalListKeys).toEqual([
      hashContent('a'),
      hashContent('c'),
    ])
  })
})

describe('foldSessionDocument — 文档级性质', () => {
  it('passes hasMore through (window prefix truncation)', () => {
    const doc = foldSessionDocument(factsOf([userMessage(1, 'x')], { hasMore: true }))
    expect(doc.hasMore).toBe(true)
  })

  it('is invariant to input event permutation (seq sort guard)', () => {
    const events = [
      userMessage(1, '做一下'),
      turnStart(2, 1),
      todoWrite(3, [{ content: 'a', status: 'pending' }]),
      todoWrite(4, [{ content: 'a', status: 'completed' }]),
      turnEnd(5, 1, { kind: 'error', error: { message: 'x', code: 'E' } }),
    ]
    const a = foldSessionDocument(factsOf(events))
    const b = foldSessionDocument(factsOf([...events].reverse()))
    expect(a).toEqual(b)
    expect(a.signature).toBe(b.signature)
  })

  it('returns identical documents (signature included) for identical input', () => {
    const facts = factsOf([
      todoWrite(1, [{ content: 'only', status: 'pending' }]),
      turnEnd(2, 0, { kind: 'completed' }),
    ])
    expect(foldSessionDocument(facts)).toEqual(foldSessionDocument(facts))
  })
})

describe('foldSessionDocument — activities（切片 B）', () => {
  it('pairs tool/call with tool/result by callId (text / duration / isError)', () => {
    const doc = foldSessionDocument(
      factsOf([
        turnStart(1, 5),
        toolCall(2, 5, 1, 'c1', 'read_file', '{"path":"a.ts"}'),
        toolResult(9, 5, 1, 'c1', { text: 'file body' }),
      ]),
    )
    const call = doc.activities.get('act:2')!
    expect(call.kind).toBe('tool-call')
    if (call.kind !== 'tool-call') return
    expect(call.name).toBe('read_file')
    expect(call.argumentsRaw).toBe('{"path":"a.ts"}')
    expect(call.result?.text).toBe('file body')
    expect(call.result?.isError).toBe(false)
    expect(call.result?.durationMs).toBe(7000) // time = seq*1000
  })

  it('preserves the error triple verbatim on a failed result', () => {
    const doc = foldSessionDocument(
      factsOf([
        toolCall(1, 1, 1, 'c1', 'bash', '{}'),
        toolResult(2, 1, 1, 'c1', {
          isError: true,
          error: { name: 'ExecError', code: 'EXIT_1', reason: 'command failed: npm test' },
          text: 'exit status 1',
        }),
      ]),
    )
    const call = doc.activities.get('act:1')!
    if (call.kind !== 'tool-call') throw new Error('expected tool-call')
    expect(call.result?.isError).toBe(true)
    expect(call.result?.errorName).toBe('ExecError')
    expect(call.result?.errorCode).toBe('EXIT_1')
    expect(call.result?.errorReason).toBe('command failed: npm test')
  })

  it('skips orphan results and keeps the first result on duplicates (idempotent)', () => {
    const doc = foldSessionDocument(
      factsOf([
        toolResult(1, 1, 1, 'ghost', { text: 'orphan' }),
        toolCall(2, 1, 1, 'c1', 'x', '{}'),
        toolResult(3, 1, 1, 'c1', { text: 'first' }),
        toolResult(4, 1, 1, 'c1', { text: 'second' }),
      ]),
    )
    expect(doc.activities.size).toBe(1)
    const call = doc.activities.get('act:2')!
    if (call.kind !== 'tool-call') throw new Error('expected tool-call')
    expect(call.result?.text).toBe('first')
  })

  it('pairs approval asked→decided by id; pending without decide; orphans skipped', () => {
    const doc = foldSessionDocument(
      factsOf([
        turnStart(1, 1),
        approvalAsked(2, 'a1', { toolName: 'bash', reason: '允许执行删除？' }),
        approvalAsked(3, 'a2', { toolName: 'write' }),
        approvalDecided(4, 'a1', 'allowed-once'),
        approvalDecided(5, 'a1', 'rejected'), // 重复 decided 首个胜出
        approvalDecided(6, 'ghost', 'rejected'), // 孤儿跳过
      ]),
    )
    const a1 = doc.activities.get('act:2')!
    if (a1.kind !== 'approval') throw new Error('expected approval')
    expect(a1.reason).toBe('允许执行删除？')
    expect(a1.outcome).toBe('allowed-once')
    expect(a1.decidedTime).toBe(4000)
    const a2 = doc.activities.get('act:3')!
    if (a2.kind !== 'approval') throw new Error('expected approval')
    expect(a2.outcome).toBeUndefined() // 待决
  })

  it('marks spawn only when result text matches AND childId is in the catalog', () => {
    const args = JSON.stringify({ prompt: '去查一下', description: 'research helper' })
    const doc = foldSessionDocument(
      factsOf([
        catalogEvent(1, 'child-1'),
        toolCall(2, 1, 1, 'c1', 'subagent', args),
        toolResult(3, 1, 1, 'c1', { text: 'started subagent child-1' }),
        toolCall(4, 1, 1, 'c2', 'subagent', args),
        toolResult(5, 1, 1, 'c2', { text: 'started subagent child-unknown' }), // 不在 catalog
        toolCall(6, 1, 1, 'c3', 'other', args),
        toolResult(7, 1, 1, 'c3', { text: 'started subagent child-1' }), // 文本同但工具非派生语境也标——文本+catalog 双关即 fact
      ]),
    )
    const c1 = doc.activities.get('act:2')!
    if (c1.kind !== 'tool-call') throw new Error('expected tool-call')
    expect(c1.spawn).toEqual({
      childId: 'child-1' as never,
      description: 'research helper',
      promptText: '去查一下',
    })
    const c2 = doc.activities.get('act:4')!
    if (c2.kind !== 'tool-call') throw new Error('expected tool-call')
    expect(c2.spawn).toBeUndefined() // catalog 缺席 → 不标
    const c3 = doc.activities.get('act:6')!
    if (c3.kind !== 'tool-call') throw new Error('expected tool-call')
    expect(c3.spawn?.childId).toBe('child-1' as never) // 文本+catalog 双关即标（诚实口径：双条件）
  })

  it('tolerates malformed spawn arguments JSON (spawn with childId only)', () => {
    const doc = foldSessionDocument(
      factsOf([
        catalogEvent(1, 'child-9'),
        toolCall(2, 1, 1, 'c1', 'subagent', '{not json'),
        toolResult(3, 1, 1, 'c1', { text: 'started subagent child-9' }),
      ]),
    )
    const call = doc.activities.get('act:2')!
    if (call.kind !== 'tool-call') throw new Error('expected tool-call')
    expect(call.spawn).toEqual({ childId: 'child-9' as never })
  })

  it('folds assistant messages: text / reasoning / provider/model / usage / interrupted', () => {
    const doc = foldSessionDocument(
      factsOf([
        assistantMessage(1, 2, 1, {
          text: '结论：可行',
          provider: 'acme',
          model: 'model-x',
          usage: { inputTokens: 1200, outputTokens: 34 },
        }),
        assistantMessageWithReasoning(2, 2, 2, '正文', '先想想'),
        assistantMessage(3, 2, 3, { text: '中断的前缀', interrupted: true }),
      ]),
    )
    const m1 = doc.activities.get('act:1')!
    if (m1.kind !== 'assistant-message') throw new Error('expected assistant')
    expect(m1.text).toBe('结论：可行')
    expect(m1.provider).toBe('acme')
    expect(m1.model).toBe('model-x')
    expect(m1.usage).toEqual({ inputTokens: 1200, outputTokens: 34 })
    const m2 = doc.activities.get('act:2')!
    if (m2.kind !== 'assistant-message') throw new Error('expected assistant')
    expect(m2.reasoningText).toBe('先想想')
    expect(m2.text).toBe('正文')
    const m3 = doc.activities.get('act:3')!
    if (m3.kind !== 'assistant-message') throw new Error('expected assistant')
    expect(m3.interrupted).toBe(true)
  })

  it('attributes activities to turns: explicit for assistant/tool, ambient for approval', () => {
    // 环境计数：user/message 自增后 currentTurn=1；assistant/tool 的 wire turn=7
    // 优先（显式事实）；approval payload 无 turn → 落环境值 1。
    const doc = foldSessionDocument(
      factsOf([
        userMessage(1, '开始'),
        assistantMessage(2, 7, 1, { text: 'hi' }),
        toolCall(3, 7, 2, 'c1', 'x', '{}'),
        approvalAsked(4, 'a1'),
      ]),
    )
    expect(doc.activities.get('act:2')!.turn).toBe(7)
    expect(doc.activities.get('act:3')!.turn).toBe(7)
    expect(doc.activities.get('act:4')!.turn).toBe(1)
  })

  it('collects TurnDoc.activityKeys in event order', () => {
    const doc = foldSessionDocument(
      factsOf([
        turnStart(1, 3),
        assistantMessage(2, 3, 1, { text: 'a' }),
        toolCall(3, 3, 1, 'c1', 'x', '{}'),
        approvalAsked(4, 'a1'),
      ]),
    )
    expect(doc.turns.find((t) => t.index === 3)!.activityKeys).toEqual([
      'act:2',
      'act:3',
      'act:4',
    ])
  })

  it('signature changes when an approval outcome or a tool result settles', () => {
    const base = [
      toolCall(1, 1, 1, 'c1', 'x', '{}'),
      approvalAsked(2, 'a1'),
    ]
    const withSettles = [
      ...base,
      toolResult(3, 1, 1, 'c1', { text: 'ok' }),
      approvalDecided(4, 'a1', 'rejected'),
    ]
    const a = foldSessionDocument(factsOf(base))
    const b = foldSessionDocument(factsOf(withSettles))
    expect(a.signature).not.toBe(b.signature)
    // 结算幂等：再来一份重复事件不改签名
    const c = foldSessionDocument(
      factsOf([...withSettles, toolResult(5, 1, 1, 'c1', { text: 'dup' }), approvalDecided(6, 'a1', 'allowed-once')]),
    )
    expect(c.signature).toBe(b.signature)
  })

  it('is invariant to event permutation with activities present', () => {
    const events = [
      catalogEvent(1, 'child-1'),
      toolCall(2, 1, 1, 'c1', 'subagent', '{"prompt":"p"}'),
      toolResult(3, 1, 1, 'c1', { text: 'started subagent child-1' }),
      approvalAsked(4, 'a1', { reason: 'q' }),
      approvalDecided(5, 'a1', 'allowed-once'),
    ]
    const a = foldSessionDocument(factsOf(events))
    const b = foldSessionDocument(factsOf([...events].reverse()))
    expect(a).toEqual(b)
    expect(a.signature).toBe(b.signature)
  })
})
