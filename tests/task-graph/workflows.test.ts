/**
 * workflows.ts 纯函数测试（P2d）。
 *
 * 不依赖 React / cordis——只断言 foldWorkflowRuns / buildWorkflowGraph /
 * workflowSignature 的折叠规则。事件形状按 tool-workflow.d.ts（提取自
 * registry tarball dsh-tool-workflow@0.1.5-rc.2）。
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent, SessionId } from '@deepseek-ai/dsh-session'
import type { SessionSummary } from '@deepseek-ai/dsh-api-session-controller/client'
import {
  foldWorkflowRuns,
  buildWorkflowGraph,
  workflowSignature,
  extractWorkflowDefinitions,
  attachWorkflowDefinitions,
  filterFailedAttempts,
} from '../../src/client/task-graph/workflows.js'

function sid(id: string): SessionId {
  return id as unknown as SessionId
}

function wfEvent(
  seq: number,
  type: 'tool-workflow/run-start' | 'tool-workflow/agent-start' | 'tool-workflow/agent-end' | 'tool-workflow/run-end',
  data: Record<string, unknown>,
): SessionEvent {
  return { type, seq: seq as never, time: seq * 1000, data } as unknown as SessionEvent
}

function runStart(seq: number, runId: string, name: string): SessionEvent {
  return wfEvent(seq, 'tool-workflow/run-start', { runId, name })
}

function agentStart(
  seq: number,
  runId: string,
  memberSeq: number,
  label: string,
  childId: string,
  phase?: string,
): SessionEvent {
  return wfEvent(seq, 'tool-workflow/agent-start', {
    runId,
    seq: memberSeq,
    label,
    childId: sid(childId),
    ...(phase === undefined ? {} : { phase }),
  })
}

function agentEnd(
  seq: number,
  runId: string,
  memberSeq: number,
  outcome: 'completed' | 'failed' | 'cancelled',
): SessionEvent {
  return wfEvent(seq, 'tool-workflow/agent-end', { runId, seq: memberSeq, outcome })
}

function runEnd(
  seq: number,
  runId: string,
  stopReason: 'completed' | 'cancelled' | 'error',
): SessionEvent {
  return wfEvent(seq, 'tool-workflow/run-end', { runId, stopReason })
}

function summary(
  id: string,
  fields: Partial<Pick<SessionSummary, 'running' | 'blank' | 'displayTitle'>> = {},
): SessionSummary {
  return {
    id: sid(id),
    displayTitle: fields.displayTitle ?? `Title ${id}`,
    running: fields.running ?? false,
    retainedBy: {},
    blank: fields.blank ?? false,
    updatedAt: 0,
  } as SessionSummary
}

const FALLBACKS = { run: '工作流', member: '工作流成员' }

function build(events: SessionEvent[], byId: SessionSummary[] = [], ids: SessionId[] = []) {
  return buildWorkflowGraph({
    rootId: sid('root'),
    runs: foldWorkflowRuns(events),
    byId: Object.fromEntries(byId.map((s) => [s.id, s])) as Record<SessionId, SessionSummary>,
    ids,
    fallbackLabels: FALLBACKS,
  })
}

describe('foldWorkflowRuns + buildWorkflowGraph', () => {
  it('run-start alone renders a running run node; run-end settles it', () => {
    const { nodes } = build([runStart(1, 'run-1', 'story-app')])
    const run = nodes.find((n) => n.id === 'workflow:run-1')!
    expect(run.data.status).toBe('running')
    expect(run.data.label).toBe('story-app')
    expect(run.data.navigable).toBe(false)

    const settled = build([runStart(1, 'run-1', 'story-app'), runEnd(2, 'run-1', 'completed')])
    expect(settled.nodes.find((n) => n.id === 'workflow:run-1')!.data.status).toBe('done')
  })

  it('maps run-end error and cancelled to failed and cancelled', () => {
    const failed = build([runStart(1, 'r', 'n'), runEnd(2, 'r', 'error')])
    expect(failed.nodes.find((n) => n.id === 'workflow:r')!.data.status).toBe('failed')
    const cancelled = build([runStart(1, 'r', 'n'), runEnd(2, 'r', 'cancelled')])
    expect(cancelled.nodes.find((n) => n.id === 'workflow:r')!.data.status).toBe('cancelled')
  })

  it('members without phase hang directly under the run (no phase nodes)', () => {
    const { nodes, edges } = build([
      runStart(1, 'r', 'n'),
      agentStart(2, 'r', 1, 'alpha', 'sess-a'),
      agentStart(3, 'r', 2, 'beta', 'sess-b'),
    ])
    expect(nodes.filter((n) => n.type === 'workflow-phase')).toHaveLength(0)
    const pairs = edges.map((e) => [e.source, e.target])
    expect(pairs).toContainEqual(['workflow:r', 'workflow-member:r:1'])
    expect(pairs).toContainEqual(['workflow:r', 'workflow-member:r:2'])
    expect(edges.every((e) => e.data?.kind === 'workflow')).toBe(true)
  })

  it('creates phase grouping nodes when a non-empty phase exists', () => {
    const { nodes, edges } = build([
      runStart(1, 'r', 'n'),
      agentStart(2, 'r', 1, 'alpha', 'sess-a', 'checks'),
      agentStart(3, 'r', 2, 'beta', 'sess-b', 'checks'),
      agentStart(4, 'r', 3, 'gamma', 'sess-c'), // 无 phase → 直挂 run
    ])
    const phaseNode = nodes.find((n) => n.id === 'workflow-phase:r:checks')
    expect(phaseNode).toBeTruthy()
    const pairs = edges.map((e) => [e.source, e.target])
    expect(pairs).toContainEqual(['workflow:r', 'workflow-phase:r:checks'])
    expect(pairs).toContainEqual(['workflow-phase:r:checks', 'workflow-member:r:1'])
    expect(pairs).toContainEqual(['workflow:r', 'workflow-member:r:3'])
    expect(edges.some((e) => e.data?.kind === 'phase')).toBe(true)
  })

  it('maps member outcomes completed/failed/cancelled', () => {
    const { nodes } = build([
      runStart(1, 'r', 'n'),
      agentStart(2, 'r', 1, 'a', 's1'),
      agentStart(3, 'r', 2, 'b', 's2'),
      agentStart(4, 'r', 3, 'c', 's3'),
      agentEnd(5, 'r', 1, 'completed'),
      agentEnd(6, 'r', 2, 'failed'),
      agentEnd(7, 'r', 3, 'cancelled'),
    ])
    expect(nodes.find((n) => n.id === 'workflow-member:r:1')!.data.status).toBe('done')
    expect(nodes.find((n) => n.id === 'workflow-member:r:2')!.data.status).toBe('failed')
    expect(nodes.find((n) => n.id === 'workflow-member:r:3')!.data.status).toBe('cancelled')
  })

  it('unsettled member falls back to child session summary status', () => {
    const { nodes } = build(
      [runStart(1, 'r', 'n'), agentStart(2, 'r', 1, 'a', 's1')],
      [summary('s1', { running: true })],
    )
    expect(nodes.find((n) => n.id === 'workflow-member:r:1')!.data.status).toBe('running')
    // 子 session 不在 byId → pending
    const orphan = build([runStart(1, 'r', 'n'), agentStart(2, 'r', 9, 'z', 'missing')])
    expect(orphan.nodes.find((n) => n.id === 'workflow-member:r:9')!.data.status).toBe('pending')
  })

  it('merges agent-end that arrives before its agent-start (out-of-order)', () => {
    const { nodes } = build([
      runStart(1, 'r', 'n'),
      agentEnd(2, 'r', 1, 'completed'), // settle 先到
      agentStart(3, 'r', 1, 'a', 's1'), // 发现后到
    ])
    expect(nodes.find((n) => n.id === 'workflow-member:r:1')!.data.status).toBe('done')
  })

  it('gates member navigability on the ids list', () => {
    const { nodes } = build(
      [runStart(1, 'r', 'n'), agentStart(2, 'r', 1, 'a', 's1'), agentStart(3, 'r', 2, 'b', 's2')],
      [],
      [sid('s1')],
    )
    expect(nodes.find((n) => n.id === 'workflow-member:r:1')!.data.navigable).toBe(true)
    expect(nodes.find((n) => n.id === 'workflow-member:r:1')!.data.navigationId).toBe('s1')
    expect(nodes.find((n) => n.id === 'workflow-member:r:2')!.data.navigable).toBe(false)
  })

  it('attaches child session metrics from projectionValues', () => {
    const withMetrics = summary('s1')
    ;(withMetrics as { projectionValues?: unknown }).projectionValues = {
      skyaxisAgentMetrics: { provider: 'p', model: 'm', reasoningSource: 'not-recorded' },
    }
    const { nodes } = build([runStart(1, 'r', 'n'), agentStart(2, 'r', 1, 'a', 's1')], [withMetrics])
    const member = nodes.find((n) => n.id === 'workflow-member:r:1')!
    expect(member.data.metrics).toEqual({ provider: 'p', model: 'm', reasoningSource: 'not-recorded' })
  })

  it('keeps the workflow namespace disjoint and uses fallback labels', () => {
    const { nodes, edges } = build([runStart(1, 'r', ''), agentStart(2, 'r', 1, '', 's1')])
    for (const n of nodes) {
      expect(n.id.startsWith('workflow')).toBe(true)
    }
    expect(nodes.find((n) => n.id === 'workflow:r')!.data.label).toBe('工作流')
    expect(nodes.find((n) => n.id === 'workflow-member:r:1')!.data.label).toBe('工作流成员')
    for (const e of edges) {
      expect(e.source === 'root' || e.source.startsWith('workflow')).toBe(true)
      expect(e.target.startsWith('workflow')).toBe(true)
    }
  })
})

describe('workflowSignature', () => {
  it('changes when a member settles or a run ends, stable otherwise', () => {
    const base = foldWorkflowRuns([runStart(1, 'r', 'n'), agentStart(2, 'r', 1, 'a', 's1')])
    const before = workflowSignature(base)
    // 重放同样事件 → 签名不变（确定性）
    expect(workflowSignature(foldWorkflowRuns([runStart(1, 'r', 'n'), agentStart(2, 'r', 1, 'a', 's1')]))).toBe(before)
    // member 结算 → 变化
    const settled = foldWorkflowRuns([
      runStart(1, 'r', 'n'),
      agentStart(2, 'r', 1, 'a', 's1'),
      agentEnd(3, 'r', 1, 'completed'),
    ])
    expect(workflowSignature(settled)).not.toBe(before)
    // run 结算 → 变化
    const ended = foldWorkflowRuns([runStart(1, 'r', 'n'), runEnd(2, 'r', 'completed')])
    expect(workflowSignature(ended)).not.toBe(workflowSignature(foldWorkflowRuns([runStart(1, 'r', 'n')])))
  })
})

function toolCall(seq: number, args: unknown): SessionEvent {
  return {
    type: 'tool/call',
    seq: seq as never,
    time: seq * 1000,
    data: { turn: 1, step: 1, callId: `c${seq}`, name: 'workflow', arguments: JSON.stringify(args) },
  } as unknown as SessionEvent
}

describe('extractWorkflowDefinitions (P3)', () => {
  it('extracts valid definitions and skips broken ones', () => {
    const good = toolCall(1, { script: 'return 1', meta: { name: 'wf-a', description: 'd' } })
    const badJson = {
      type: 'tool/call',
      seq: 2 as never,
      time: 2000,
      data: { turn: 1, step: 1, callId: 'c2', name: 'workflow', arguments: '{not json' },
    } as unknown as SessionEvent
    const noName = toolCall(3, { script: 'return 1', meta: { description: 'x' } })
    const noScript = toolCall(4, { meta: { name: 'wf-b' } })
    const otherTool = {
      type: 'tool/call',
      seq: 5 as never,
      time: 5000,
      data: { turn: 1, step: 1, callId: 'c5', name: 'bash', arguments: '{"script":"x","meta":{"name":"y"}}' },
    } as unknown as SessionEvent
    const defs = extractWorkflowDefinitions([good, badJson, noName, noScript, otherTool])
    expect(defs).toHaveLength(1)
    expect(defs[0]!.meta.name).toBe('wf-a')
    expect(defs[0]!.script).toBe('return 1')
    expect(defs[0]!.callSeq).toBe(1)
  })

  it('keeps phases with valid titles only', () => {
    const defs = extractWorkflowDefinitions([
      toolCall(1, {
        script: 's',
        meta: { name: 'n', phases: [{ title: 'a', detail: 'x' }, { title: '' }, { nope: 1 }, 'str'] },
      }),
    ])
    expect(defs[0]!.meta.phases).toEqual([{ title: 'a', detail: 'x' }])
  })
})

describe('attachWorkflowDefinitions (P3)', () => {
  it('matches earliest definition with callSeq <= run start and equal name', () => {
    const runs = foldWorkflowRuns([runStart(10, 'r1', 'wf-a'), runStart(20, 'r2', 'wf-b')])
    const defs = extractWorkflowDefinitions([
      toolCall(5, { script: 's1', meta: { name: 'wf-a' } }), // 早于 r1 → 匹配 r1
      toolCall(15, { script: 's2', meta: { name: 'wf-a' } }), // 晚于 r1、早于 r2 但 name 不符 → 不匹配 r2
      toolCall(25, { script: 's3', meta: { name: 'wf-b' } }), // 晚于 r2 start → 不匹配
    ])
    const attached = attachWorkflowDefinitions(runs, defs)
    expect(attached.get('r1')!.definition?.script).toBe('s1')
    expect(attached.get('r2')!.definition).toBeUndefined()
  })

  it('one definition serves at most one run (taken uniqueness)', () => {
    const runs = foldWorkflowRuns([runStart(10, 'r1', 'wf-a'), runStart(20, 'r2', 'wf-a')])
    const defs = extractWorkflowDefinitions([toolCall(5, { script: 's1', meta: { name: 'wf-a' } })])
    const attached = attachWorkflowDefinitions(runs, defs)
    expect(attached.get('r1')!.definition?.script).toBe('s1')
    expect(attached.get('r2')!.definition).toBeUndefined()
  })
})

describe('filterFailedAttempts (P3 opt-in)', () => {
  const memberNode = (runId: string, seq: number, label: string, status: 'done' | 'failed') => ({
    id: `workflow-member:${runId}:${seq}`,
    type: 'workflow-member' as const,
    position: { x: 0, y: 0 },
    data: { label, status },
  })

  it('removes same-label failed members and their edges, keeps parallel same-name survivors', () => {
    const nodes = [
      memberNode('r', 1, 'gen-doc', 'failed'), // 有同名非 failed → 移除
      memberNode('r', 2, 'gen-doc', 'done'),
      memberNode('r', 3, 'solo-fail', 'failed'), // 无同名非 failed → 保留
      memberNode('r', 4, 'par-a', 'done'), // 并行同名非 failed → 保留
      memberNode('r', 5, 'par-a', 'done'),
    ]
    const edges = [
      { id: 'e1', source: 'workflow:r', target: 'workflow-member:r:1', data: { kind: 'workflow' as const } },
      { id: 'e2', source: 'workflow:r', target: 'workflow-member:r:2', data: { kind: 'workflow' as const } },
      { id: 'e3', source: 'workflow-member:r:1', target: 'x', data: { kind: 'workflow' as const } },
    ]
    const out = filterFailedAttempts(nodes, edges)
    expect(out.nodes.map((n) => n.id)).toEqual([
      'workflow-member:r:2',
      'workflow-member:r:3',
      'workflow-member:r:4',
      'workflow-member:r:5',
    ])
    expect(out.edges.map((e) => e.id)).toEqual(['e2'])
  })

  it('keeps everything when no same-label failed member exists', () => {
    const nodes = [memberNode('r', 1, 'a', 'failed'), memberNode('r', 2, 'b', 'done')]
    const edges = [{ id: 'e1', source: 'workflow:r', target: 'workflow-member:r:1', data: { kind: 'workflow' as const } }]
    const out = filterFailedAttempts(nodes, edges)
    expect(out.nodes).toHaveLength(2)
    expect(out.edges).toHaveLength(1)
  })
})
