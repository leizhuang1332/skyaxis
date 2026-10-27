/**
 * subagents.ts 纯函数测试（P2a）。
 *
 * 不依赖 React / cordis——只断言 lineageDepths / buildSubagentGraph /
 * subagentSignature 的转换规则（dist/03 §7 + dist/05 §4 单测语义的移植）。
 *
 * P2a 关键契约：
 *   - lineageDepths：合法后代有深度；孤儿 / 环（整圈）/ 非 subagent origin 拒绝
 *   - delegation 边：root → 直接子 → 更深层的森林，构造上无环
 *   - navigable ⟺ id ∈ ids（诚实规则：列表里没有的 session 不假装能打开）
 *   - label 回退链：catalog label → displayTitle → fallback
 *   - 与 inferTaskGraph 的输出 id 命名空间不相交
 */
import { describe, expect, it } from 'vitest'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import { lineageDepths, buildSubagentGraph, subagentSignature, summaryStatus } from '../../src/client/task-graph/subagents.js'
import { foldSessionDocument } from '../../src/client/task-graph/document/fold.js'
import { projectTaskChain } from '../../src/client/task-graph/projections/task-chain.js'

function sid(id: string): SessionId {
  return id as unknown as SessionId
}

function summary(
  id: string,
  fields: Partial<Pick<SessionSummary, 'parentId' | 'origin' | 'running' | 'blank' | 'displayTitle'>> = {},
): SessionSummary {
  return {
    id: sid(id),
    displayTitle: fields.displayTitle ?? `Title ${id}`,
    parentId: fields.parentId,
    origin: fields.origin,
    running: fields.running ?? false,
    retainedBy: {},
    blank: fields.blank ?? false,
    updatedAt: 0,
  } as SessionSummary
}

function byIdOf(...rows: SessionSummary[]): Record<SessionId, SessionSummary> {
  const map = {} as Record<SessionId, SessionSummary>
  for (const row of rows) map[row.id] = row
  return map
}

describe('lineageDepths', () => {
  it('accepts descendants and rejects cycles, orphans, and non-subagent origins', () => {
    const byId = byIdOf(
      summary('root', { displayTitle: 'Root' }),
      summary('direct', { parentId: sid('root'), origin: 'subagent' }),
      summary('nested', { parentId: sid('direct'), origin: 'subagent' }),
      summary('orphan', { parentId: sid('missing'), origin: 'subagent' }),
      summary('cycleA', { parentId: sid('cycleB'), origin: 'subagent' }),
      summary('cycleB', { parentId: sid('cycleA'), origin: 'subagent' }),
      summary('manual', { parentId: sid('root') }), // origin 非 subagent
    )
    const depths = lineageDepths(sid('root'), byId)
    expect(depths.get(sid('direct'))).toBe(1)
    expect(depths.get(sid('nested'))).toBe(2)
    expect(depths.has(sid('orphan'))).toBe(false)
    expect(depths.has(sid('cycleA'))).toBe(false)
    expect(depths.has(sid('cycleB'))).toBe(false) // 整圈拒绝，无半环
    expect(depths.has(sid('manual'))).toBe(false)
    expect(depths.get(sid('root'))).toBe(0)
  })

  it('rejects the whole trail when a deep descendant walks into a cycle', () => {
    // deep → cycleA ↔ cycleB：deep 的 trail 含 deep + cycleA，全部拒绝
    const byId = byIdOf(
      summary('root'),
      summary('deep', { parentId: sid('cycleA'), origin: 'subagent' }),
      summary('cycleA', { parentId: sid('cycleB'), origin: 'subagent' }),
      summary('cycleB', { parentId: sid('cycleA'), origin: 'subagent' }),
    )
    const depths = lineageDepths(sid('root'), byId)
    expect(depths.has(sid('deep'))).toBe(false)
    expect(depths.has(sid('cycleA'))).toBe(false)
    expect(depths.has(sid('cycleB'))).toBe(false)
  })
})

describe('buildSubagentGraph', () => {
  it('emits delegation edges as a forest rooted at root', () => {
    const byId = byIdOf(
      summary('root'),
      summary('child1', { parentId: sid('root'), origin: 'subagent' }),
      summary('child2', { parentId: sid('root'), origin: 'subagent' }),
      summary('grandchild', { parentId: sid('child1'), origin: 'subagent' }),
    )
    const { nodes, edges } = buildSubagentGraph({
      rootId: sid('root'),
      byId,
      subagentsByParent: {},
      ids: [],
      fallbackLabel: 'Subagent',
    })
    expect(nodes.map((n) => n.id)).toEqual([
      'subagent:child1',
      'subagent:child2',
      'subagent:grandchild',
    ])
    expect(nodes.every((n) => n.type === 'subagent')).toBe(true)
    const kinds = new Set(edges.map((e) => e.data?.kind))
    expect(kinds).toEqual(new Set(['delegation']))
    const edgePairs = edges.map((e) => [e.source, e.target])
    expect(edgePairs).toContainEqual(['root', 'subagent:child1'])
    expect(edgePairs).toContainEqual(['root', 'subagent:child2'])
    expect(edgePairs).toContainEqual(['subagent:child1', 'subagent:grandchild'])
    // 构造上无环：source/target 无重复出现在同一位置
    expect(edges.every((e) => e.source !== e.target)).toBe(true)
  })

  it('marks navigable only when the session exists in ids', () => {
    const byId = byIdOf(
      summary('root'),
      summary('listed', { parentId: sid('root'), origin: 'subagent' }),
      summary('unlisted', { parentId: sid('root'), origin: 'subagent' }),
    )
    const { nodes } = buildSubagentGraph({
      rootId: sid('root'),
      byId,
      subagentsByParent: {},
      ids: [sid('root'), sid('listed')],
      fallbackLabel: 'Subagent',
    })
    const listed = nodes.find((n) => n.id === 'subagent:listed')!
    const unlisted = nodes.find((n) => n.id === 'subagent:unlisted')!
    expect(listed.data.navigable).toBe(true)
    expect(listed.data.navigationId).toBe('listed')
    expect(unlisted.data.navigable).toBe(false)
  })

  it('falls back label from catalog to displayTitle to fallback', () => {
    const byId = byIdOf(
      summary('root'),
      summary('withCatalog', {
        parentId: sid('root'),
        origin: 'subagent',
        displayTitle: 'Title withCatalog',
      }),
      summary('noCatalog', {
        parentId: sid('root'),
        origin: 'subagent',
        displayTitle: 'Title noCatalog',
      }),
      summary('bare', { parentId: sid('root'), origin: 'subagent', displayTitle: '' }),
    )
    const { nodes } = buildSubagentGraph({
      rootId: sid('root'),
      byId,
      subagentsByParent: {
        [sid('root')]: {
          entries: [
            { id: sid('withCatalog'), label: 'worker-1' },
            { id: sid('noCatalog') }, // one-shot 无 label
            { id: sid('bare'), label: '' }, // 空 label 不覆盖
          ],
        },
      } as never,
      ids: [],
      fallbackLabel: '子代理',
    })
    expect(nodes.find((n) => n.id === 'subagent:withCatalog')!.data.label).toBe('worker-1')
    expect(nodes.find((n) => n.id === 'subagent:noCatalog')!.data.label).toBe('Title noCatalog')
    expect(nodes.find((n) => n.id === 'subagent:bare')!.data.label).toBe('子代理')
  })

  it('maps summary to task status via the three-state derivation (blank decides pending; completed ignored)', () => {
    // P2 fix (research 0007 §1.3): completed is a client notification bit —
    // long-finished sessions observed after the fact have completed=false and
    // used to collapse to 'pending'. The derivation now reads blank.
    const byId = byIdOf(
      summary('root'),
      summary('busy', { parentId: sid('root'), origin: 'subagent', running: true }),
      // 空闲有史：!running && !blank → done（completed 位被无视——构造 completed:false）
      summary('idleHistory', { parentId: sid('root'), origin: 'subagent' }),
      // 未开始：blank → pending
      summary('fresh', { parentId: sid('root'), origin: 'subagent', blank: true }),
    )
    const { nodes } = buildSubagentGraph({
      rootId: sid('root'),
      byId,
      subagentsByParent: {},
      ids: [],
      fallbackLabel: 'Subagent',
    })
    expect(nodes.find((n) => n.id === 'subagent:busy')!.data.status).toBe('running')
    expect(nodes.find((n) => n.id === 'subagent:idleHistory')!.data.status).toBe('done')
    expect(nodes.find((n) => n.id === 'subagent:fresh')!.data.status).toBe('pending')
  })

  it('keeps id namespaces disjoint from the projected task chain', () => {
    const byId = byIdOf(
      summary('root'),
      summary('child', { parentId: sid('root'), origin: 'subagent' }),
    )
    const sub = buildSubagentGraph({
      rootId: sid('root'),
      byId,
      subagentsByParent: {},
      ids: [],
      fallbackLabel: 'Subagent',
    })
    const task = projectTaskChain(
      foldSessionDocument({
        sessionId: sid('root'),
        events: [
          {
            type: 'user/message',
            seq: 1 as never,
            time: 1000,
            data: {
              id: 'u1' as never,
              role: 'user',
              content: [{ type: 'text', text: 'hi' }],
              source: { kind: 'user' },
            },
          } as never,
          {
            type: 'todo/write',
            seq: 2 as never,
            time: 2000,
            data: { todos: [{ content: 't', status: 'pending' }] },
          } as never,
        ],
        hasMore: false,
        label: 'Root',
        rootStatus: 'running',
      }),
    )
    const merged = [...task.nodes, ...sub.nodes]
    // 完全唯一：subagent 图不建 root 节点（root 归任务图所有，子图只把
    // 'root' 用作边的 source），两图 id 命名空间天然不相交。
    const ids = merged.map((n) => n.id)
    expect(new Set(ids).size).toBe(ids.length)
    // subagent 节点全部带前缀，与 task 命名空间（root/user-*/todo-*）不相交
    for (const n of sub.nodes) expect(n.id.startsWith('subagent:')).toBe(true)
    for (const e of sub.edges) {
      expect(e.source === 'root' || e.source.startsWith('subagent:')).toBe(true)
      // v0.4 切片 B：血缘边是 parentId 结构事实。
      expect(e.data?.evidence).toBe('fact')
    }
  })
})

describe('subagentSignature', () => {
  it('changes when a descendant flips running, and not when unrelated sessions change', () => {
    const base = byIdOf(
      summary('root'),
      summary('child', { parentId: sid('root'), origin: 'subagent' }),
      summary('other-session', { displayTitle: 'Unrelated' }), // 无血缘
    )
    const before = subagentSignature(sid('root'), base)
    // 无关 session 变化 → 签名不变
    const unrelated = byIdOf(
      summary('root'),
      summary('child', { parentId: sid('root'), origin: 'subagent' }),
      summary('other-session', { displayTitle: 'Unrelated 2' }),
    )
    expect(subagentSignature(sid('root'), unrelated)).toBe(before)
    // 后代 running 翻转 → 签名变化
    const flipped = byIdOf(
      summary('root'),
      summary('child', { parentId: sid('root'), origin: 'subagent', running: true }),
      summary('other-session'),
    )
    expect(subagentSignature(sid('root'), flipped)).not.toBe(before)
  })
})

describe('buildSubagentGraph grouped exclusion (P2d fix)', () => {
  it('skips grouped sessions and re-parents their descendants to the member node', () => {
    // dist/03 §6 grouped 规则：被 workflow 占用的 child 不重复建 subagent
    // 节点；child 的后代挂到 member 节点下。
    const byId = byIdOf(
      summary('root'),
      summary('wfchild', { parentId: sid('root'), origin: 'subagent' }),
      summary('wfgrandchild', { parentId: sid('wfchild'), origin: 'subagent' }),
      summary('plain', { parentId: sid('root'), origin: 'subagent' }),
    )
    const { nodes, edges } = buildSubagentGraph({
      rootId: sid('root'),
      byId,
      subagentsByParent: {},
      ids: [],
      fallbackLabel: 'Subagent',
      grouped: new Map([[sid('wfchild'), 'workflow-member:r:1']]),
    })
    const ids = nodes.map((n) => n.id)
    // wfchild 被占用 → 无 subagent:wfchild；wfgrandchild 与 plain 仍在
    expect(ids).not.toContain('subagent:wfchild')
    expect(ids).toContain('subagent:wfgrandchild')
    expect(ids).toContain('subagent:plain')
    // wfgrandchild 的父边指向 member 节点，而非不存在的 subagent:wfchild
    const pairs = edges.map((e) => [e.source, e.target])
    expect(pairs).toContainEqual(['workflow-member:r:1', 'subagent:wfgrandchild'])
    expect(pairs).not.toContainEqual(['subagent:wfchild', 'subagent:wfgrandchild'])
    expect(pairs).toContainEqual(['root', 'subagent:plain'])
  })
})

describe('P2b waiting（waterfall 待决压过 running）', () => {
  it('summaryStatus(summary, true) 覆盖 running——更精确事实优先', () => {
    expect(summaryStatus(summary('root', { running: true }), true)).toBe('waiting')
    expect(summaryStatus(summary('root', { running: true }), false)).toBe('running')
    expect(summaryStatus(summary('root'), true)).toBe('waiting')
  })

  it('buildSubagentGraph 带 waiting 集 → 对应 subagent 节点 waiting', () => {
    const byId = byIdOf(
      summary('root'),
      summary('busy', { parentId: sid('root'), origin: 'subagent', running: true }),
      summary('calm', { parentId: sid('root'), origin: 'subagent' }),
    )
    const waiting = new Set([sid('busy')])
    const { nodes } = buildSubagentGraph({
      rootId: sid('root'),
      byId,
      subagentsByParent: {},
      ids: [],
      fallbackLabel: 'Subagent',
      waiting,
    })
    expect(nodes.find((n) => n.id === 'subagent:busy')!.data.status).toBe('waiting')
    expect(nodes.find((n) => n.id === 'subagent:calm')!.data.status).toBe('done')
  })
})
