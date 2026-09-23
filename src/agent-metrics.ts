/**
 * agentMetrics 投影（P2b）——"最近一次请求"的 Provider / 模型 / 思考深度 / 来源。
 *
 * 数据源：`request/header` 事件（基础 SessionEventMap 成员，持久事实）。
 * payload：`{ header: EpochHeader, reason, startsSeries? }`，其中
 * `EpochHeader = { config: LlmCallConfig, adapterDefaults?, tools? }`——
 * 与参考插件 dist/06 折叠的 `{ config, adapterDefaults }` 逐字段同构。
 *
 * 与宿主已有 `modelSelection` 投影的关系（0003 §三 查重结论）：语义正交——
 * modelSelection 是"选择意图"（为下一次请求选了什么，无来源标注），
 * 本投影是"请求事实"（实际发生的最近一次请求 + adapterDefaults 溯源）。
 * 消费事实侧，不混用。
 *
 * 诚实约束（dist/06 §三 三道防线的 zod 化）：
 *   1. provider/model 必须非空字符串；
 *   2. reasoningSource 三枚举闭集；
 *   3. 矛盾组合拒绝——`not-recorded` 时 reasoningEffort 必须缺席。
 * 不移植 dist/06 的 reasoningReference 公开默认参考表：没有对 DSH 模型
 * 生态做过核验，没有核验数据就不造参考表（dist/01 原则 1）。
 */
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent, SessionHeader, SessionLogOffset } from '@deepseek-ai/dsh-session'

/** 投影 key（SessionProjectionMap 合并见 agent-metrics-wire.d.ts）。 */
export const AGENT_METRICS_KEY = 'skyaxisAgentMetrics'

/** wire/state 值：null = 尚无 request/header（capability 在、事实未发生）。 */
export interface SkyaxisAgentMetrics {
  provider: string
  model: string
  /** 仅当持久记录存在时携带。 */
  reasoningEffort?: string
  reasoningSource: 'request-config' | 'adapter-default' | 'not-recorded'
}

/** reasoningSource 的合法枚举（保持与接口声明同源）。 */
const REASONING_SOURCES = ['request-config', 'adapter-default', 'not-recorded'] as const

/**
 * 状态 schema：null ∪ metrics，superRefine 强制诚实组合。
 * 同时用作 stateSchema（入库校验）与 wire viewSchema（出库校验）。
 */
const agentMetricsSchema = z
  .object({
    provider: z.string().min(1, 'requires non-empty string provider'),
    model: z.string().min(1, 'requires non-empty string model'),
    reasoningEffort: z.string().min(1).optional(),
    reasoningSource: z.enum(REASONING_SOURCES),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.reasoningSource === 'not-recorded' && value.reasoningEffort !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['reasoningEffort'],
        message: 'must be absent when reasoningSource is not-recorded',
      })
    }
  })

const agentMetricsStateSchema = z.union([z.null(), agentMetricsSchema])

function metricsEquals(
  left: SkyaxisAgentMetrics,
  right: SkyaxisAgentMetrics,
): boolean {
  return (
    left.provider === right.provider
    && left.model === right.model
    && left.reasoningEffort === right.reasoningEffort
    && left.reasoningSource === right.reasoningSource
  )
}

/** 从 request/header 事件载荷读出折叠值（防御性读取，字段漂移时按未记录处理）。 */
function foldHeaderEvent(event: SessionEvent<'request/header'>): SkyaxisAgentMetrics {
  const header = event.data.header as {
    config?: { provider?: unknown; model?: unknown; reasoningEffort?: unknown }
    adapterDefaults?: { reasoningEffort?: unknown }
  }
  const config = header.config ?? {}
  const provider = typeof config.provider === 'string' ? config.provider : ''
  const model = typeof config.model === 'string' ? config.model : ''
  const effort = typeof config.reasoningEffort === 'string' ? config.reasoningEffort : undefined
  return {
    provider,
    model,
    ...(effort === undefined ? {} : { reasoningEffort: effort }),
    reasoningSource:
      effort === undefined
        ? ('not-recorded' as const)
        : header.adapterDefaults?.reasoningEffort === true
          ? ('adapter-default' as const)
          : ('request-config' as const),
  }
}

/**
 * 纯投影定义：host 经 ctx.sessionProjections.register 挂载（src/index.ts），
 * apply 不关心的事件必须返回同引用（Object.is → 零下游工作）。
 *
 * 用 `satisfies` 而非类型标注：保留字面量类型（wire 非可选、key 为字面量），
 * 否则 register 的 with-wire 重载会因 `wire?:` 可选而不匹配。
 */
export const agentMetricsProjection = {
  key: AGENT_METRICS_KEY,
  stateVersion: 1,
  stateSchema: agentMetricsStateSchema,
  init(_header: SessionHeader, _inheritedEventCount: SessionLogOffset): SkyaxisAgentMetrics | null {
    return null
  },
  apply(state: SkyaxisAgentMetrics | null, event: SessionEvent): SkyaxisAgentMetrics | null {
    if (event.type !== 'request/header') return state
    const next = foldHeaderEvent(event)
    if (state !== null && metricsEquals(state, next)) return state
    return next
  },
  wire: {
    viewSchema: agentMetricsStateSchema,
    view(state: SkyaxisAgentMetrics | null): SkyaxisAgentMetrics | null {
      return state
    },
  },
} satisfies ProjectionDefinition<typeof AGENT_METRICS_KEY, SkyaxisAgentMetrics | null>
