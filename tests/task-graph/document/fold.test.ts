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
