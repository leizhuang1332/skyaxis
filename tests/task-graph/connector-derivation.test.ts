import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { mainViewSessionIdOf, subagentsByParentOf } from '../../src/client/task-graph/connector.js'

/**
 * 0033 回归钉：0.2.1-rc.3 的 SessionListState 退役 subagentsByParent / current
 * 后，connector 的两条派生判据——目录改读每父会话投影值（宿主 tree.ts 同款）、
 * 主视图会话 = retainedBy.mainView 计数为正（宿主 DocumentTitle 官方判据）。
 */
type ListState = Parameters<typeof mainViewSessionIdOf>[0]
const sid = (id: string): SessionId => id as SessionId
const row = (
  id: string,
  retainedBy: Record<string, number | undefined> = {},
): Record<string, unknown> => ({
  id: sid(id),
  displayTitle: `Title ${id}`,
  parentId: undefined,
  origin: undefined,
  running: false,
  retainedBy,
  blank: false,
  updatedAt: 0,
})
const stateOf = (
  byId: Record<string, unknown>,
  projectionsBySession: Record<string, unknown> = {},
): ListState => ({ ids: Object.keys(byId), byId, projectionsBySession }) as ListState

describe('mainViewSessionIdOf（0.2.1-rc.3 current 退役后的主视图判据）', () => {
  it('returns the session retained by mainView > 0', () => {
    const state = stateOf({
      a: row('a'),
      b: row('b', { mainView: 1 }),
      c: row('c', { mainView: 0, conversation: 2 }),
    })
    expect(mainViewSessionIdOf(state)).toBe(sid('b'))
  })
  it('returns undefined when no row carries a positive mainView count', () => {
    const state = stateOf({ a: row('a'), b: row('b', { conversation: 1 }) })
    expect(mainViewSessionIdOf(state)).toBeUndefined()
  })
})

describe('subagentsByParentOf（0.2.1-rc.3 目录投影派生）', () => {
  it('collects subagentCatalog projection values keyed by parent', () => {
    const state = stateOf(
      { a: row('a'), c1: row('c1'), c2: row('c2') },
      {
        a: { values: { subagentCatalog: [{ id: sid('c1'), label: 'L1' }, { id: sid('c2') }] } },
        c1: { values: { subagentCatalog: [] } },
        c2: { values: {} },
      },
    )
    const map = subagentsByParentOf(state)
    expect(Object.keys(map)).toEqual([sid('a')])
    expect(map[sid('a')]?.entries).toEqual([{ id: sid('c1'), label: 'L1' }, { id: sid('c2') }])
  })
  it('omits parents without a non-empty catalog', () => {
    const state = stateOf(
      { a: row('a'), b: row('b') },
      { a: { values: {} }, b: { values: { subagentCatalog: [] } } },
    )
    expect(subagentsByParentOf(state)).toEqual({})
  })
})
