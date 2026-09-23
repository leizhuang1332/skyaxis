/**
 * Host loader entry for the task-board plugin.
 *
 * P2b：可选注册 `skyaxisAgentMetrics` session 投影（"最近一次请求"的
 * provider / model / 思考深度 / 来源，定义见 agent-metrics.ts）。顶层
 * `inject` 保持为空——服务缺席时注册静默跳过，客户端读作 capability
 * absence（projectionValues 缺 key），绝不让插件加载失败波及宿主。
 */
import type { Context } from '@deepseek-ai/cordis'
import { agentMetricsProjection } from './agent-metrics.js'

export const inject: readonly string[] = []

export function apply(ctx: Context): void {
  // ctx.inject 是可选依赖解析（服务缺席时插件静默等待，不崩）；register 的
  // disposer 骑在调用 fiber 上，随插件卸载自动摘 key（无需再包 ctx.effect）。
  ctx.inject(['sessionProjections'], (scope) => {
    scope.sessionProjections.register(agentMetricsProjection)
  })
}
