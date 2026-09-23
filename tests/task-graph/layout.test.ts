/**
 * layout.ts 纯函数测试（P3）：layoutSignature 门控语义 + applyManualPositions 叠加。
 */
import { describe, expect, it } from 'vitest'
import type { TaskNode, TaskEdge } from '../../src/client/task-graph/types.js'
import { layoutSignature, applyManualPositions } from '../../src/client/task-graph/layout.js'

function node(id: string, extra: Partial<TaskNode['data']> = {}): TaskNode {
  return {
    id,
    type: 'task',
    position: { x: 0, y: 0 },
    data: { label: id, ...extra },
  }
}

function edge(source: string, target: string): TaskEdge {
  return { id: `e-${source}-${target}`, source, target, data: { kind: 'sequence' } }
}

describe('layoutSignature', () => {
  it('is invariant to status, label, and metrics changes', () => {
    const a = layoutSignature(
      [node('n1', { status: 'pending' }), node('n2', { label: 'old' })],
      [edge('n1', 'n2')],
    )
    const b = layoutSignature(
      [
        node('n1', { status: 'done', metrics: { provider: 'p', model: 'm', reasoningSource: 'not-recorded' } }),
        node('n2', { label: 'new label' }),
      ],
      [edge('n1', 'n2')],
    )
    expect(b).toBe(a)
  })

  it('changes when a node or edge is added or removed', () => {
    const base = layoutSignature([node('n1'), node('n2')], [edge('n1', 'n2')])
    expect(layoutSignature([node('n1'), node('n2'), node('n3')], [edge('n1', 'n2')])).not.toBe(base)
    expect(layoutSignature([node('n1')], [edge('n1', 'n2')])).not.toBe(base)
    expect(layoutSignature([node('n1'), node('n2')], [])).not.toBe(base)
    expect(layoutSignature([node('n1'), node('n2')], [edge('n1', 'n2'), edge('n2', 'n1')])).not.toBe(base)
  })

  it('is order-independent (deterministic under input permutation)', () => {
    const a = layoutSignature([node('n1'), node('n2'), node('n3')], [edge('n1', 'n2'), edge('n2', 'n3')])
    const b = layoutSignature([node('n3'), node('n1'), node('n2')], [edge('n2', 'n3'), edge('n1', 'n2')])
    expect(b).toBe(a)
  })
})

describe('applyManualPositions', () => {
  it('overrides listed ids and passes others through', () => {
    const laid = [node('n1'), node('n2')]
    const manual = new Map([['n1', { x: 100, y: 200 }]])
    const out = applyManualPositions(laid, manual)
    expect(out.find((n) => n.id === 'n1')!.position).toEqual({ x: 100, y: 200 })
    expect(out.find((n) => n.id === 'n2')!.position).toEqual({ x: 0, y: 0 })
    // 不改入参
    expect(laid[0]!.position).toEqual({ x: 0, y: 0 })
  })

  it('returns a copy when manual is empty', () => {
    const laid = [node('n1')]
    const out = applyManualPositions(laid, new Map())
    expect(out).not.toBe(laid)
    expect(out).toEqual(laid)
  })
})
