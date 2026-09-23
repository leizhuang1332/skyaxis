/**
 * agentMetrics 投影纯函数测试（P2b）。
 *
 * dist/06 §7.1 用例集的移植：折叠状态机（三态来源 + 同引用跳过）+
 * schema 诚实约束（非空 / 枚举闭集 / 矛盾组合拒绝）。
 * 不依赖 cordis / 宿主运行时——只测 definition 对象本身。
 */
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { agentMetricsProjection, AGENT_METRICS_KEY } from '../src/agent-metrics.js'

type Metrics = ReturnType<typeof agentMetricsProjection.apply>

function headerEvent(
  seq: number,
  config: { provider?: unknown; model?: unknown; reasoningEffort?: unknown },
  adapterDefaults?: { reasoningEffort?: unknown },
): SessionEvent {
  return {
    type: 'request/header',
    seq: seq as never,
    time: seq * 1000,
    data: {
      header: {
        config,
        ...(adapterDefaults === undefined ? {} : { adapterDefaults }),
      },
      reason: 'initial',
    },
  } as unknown as SessionEvent
}

const OTHER_EVENT = {
  type: 'assistant/message',
  seq: 9 as never,
  time: 9000,
  data: {},
} as unknown as SessionEvent

describe('agentMetricsProjection fold', () => {
  it('init returns null and view passes null through', () => {
    expect(agentMetricsProjection.init({} as never, 0 as never)).toBeNull()
    expect(agentMetricsProjection.wire.view(null)).toBeNull()
  })

  it('returns the same reference for non-header events (Object.is contract)', () => {
    const state: Metrics = { provider: 'p', model: 'm', reasoningSource: 'not-recorded' }
    expect(Object.is(agentMetricsProjection.apply(state, OTHER_EVENT), state)).toBe(true)
  })

  it('folds first header with effort and no adapterDefaults into request-config', () => {
    const next = agentMetricsProjection.apply(
      null,
      headerEvent(1, { provider: 'deepseek', model: 'ds-5', reasoningEffort: 'high' }),
    )
    expect(next).toEqual({
      provider: 'deepseek',
      model: 'ds-5',
      reasoningEffort: 'high',
      reasoningSource: 'request-config',
    })
  })

  it('marks adapterDefaults.reasoningEffort=true as adapter-default', () => {
    const next = agentMetricsProjection.apply(
      null,
      headerEvent(1, { provider: 'p', model: 'm', reasoningEffort: 'high' }, { reasoningEffort: true }),
    )
    expect(next?.reasoningSource).toBe('adapter-default')
  })

  it('absent effort folds to not-recorded WITHOUT an effort field', () => {
    const next = agentMetricsProjection.apply(
      null,
      headerEvent(1, { provider: 'p', model: 'm', reasoningEffort: undefined }),
    )
    expect(next).toEqual({ provider: 'p', model: 'm', reasoningSource: 'not-recorded' })
    expect('reasoningEffort' in (next ?? {})).toBe(false)
  })

  it('returns the same reference for identical headers, new reference on change', () => {
    const first = agentMetricsProjection.apply(
      null,
      headerEvent(1, { provider: 'p', model: 'm', reasoningEffort: 'high' }),
    )
    // 完全相同的 header → 同引用（零下游工作）
    expect(Object.is(agentMetricsProjection.apply(first, headerEvent(2, { provider: 'p', model: 'm', reasoningEffort: 'high' })), first)).toBe(true)
    // 模型变化 → 新引用
    const changed = agentMetricsProjection.apply(
      first,
      headerEvent(3, { provider: 'p', model: 'm2', reasoningEffort: 'high' }),
    )
    expect(Object.is(changed, first)).toBe(false)
    expect(changed?.model).toBe('m2')
  })
})

describe('agentMetricsProjection schema honesty', () => {
  it('rejects empty provider / empty model', () => {
    expect(() => agentMetricsProjection.stateSchema.parse({ provider: '', model: 'm', reasoningSource: 'not-recorded' })).toThrow()
    expect(() => agentMetricsProjection.stateSchema.parse({ provider: 'p', model: '', reasoningSource: 'not-recorded' })).toThrow()
  })

  it('rejects values outside the reasoningSource enum', () => {
    expect(() =>
      agentMetricsProjection.stateSchema.parse({ provider: 'p', model: 'm', reasoningEffort: 'high', reasoningSource: 'preset' }),
    ).toThrow()
  })

  it('rejects the contradictory not-recorded + effort combination', () => {
    expect(() =>
      agentMetricsProjection.stateSchema.parse({ provider: 'p', model: 'm', reasoningEffort: 'low', reasoningSource: 'not-recorded' }),
    ).toThrow(/must be absent/)
  })

  it('accepts null and valid metrics, and view passes state through unchanged', () => {
    expect(agentMetricsProjection.stateSchema.parse(null)).toBeNull()
    const state: Metrics = { provider: 'p', model: 'm', reasoningEffort: 'high', reasoningSource: 'request-config' }
    expect(agentMetricsProjection.stateSchema.parse(state)).toEqual(state)
    expect(agentMetricsProjection.wire.view(state)).toBe(state)
  })

  it('carries the stable projection key', () => {
    expect(AGENT_METRICS_KEY).toBe('skyaxisAgentMetrics')
    expect(agentMetricsProjection.key).toBe(AGENT_METRICS_KEY)
    expect(agentMetricsProjection.stateVersion).toBe(1)
  })
})
