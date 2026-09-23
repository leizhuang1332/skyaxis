/**
 * 把 `skyaxisAgentMetrics` 声明进 session-projection 的两张合并表：
 *
 *   - SessionProjectionStateMap（host 折叠状态表）：ProjectionDefinition 的
 *     key 泛型约束要求 key 在此表中；
 *   - SessionProjectionMap（client 可见 wire 值表）：wire 值经
 *     ProjectionValueStore 推送自动到达客户端
 *     `byId[id].projectionValues.skyaxisAgentMetrics`。
 *
 * 顶层 `export {}` 让本文件成为模块文件——这是 `declare module` 被当作
 * module augmentation（合并进已解析的真实模块）而非独立环境模块声明的
 * 必要条件（P1 踩过，见 todo-write.d.ts 注释）。
 */
import type { SkyaxisAgentMetrics } from './agent-metrics.js'

export {}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    skyaxisAgentMetrics: SkyaxisAgentMetrics | null
  }

  interface SessionProjectionMap {
    skyaxisAgentMetrics: SkyaxisAgentMetrics | null
  }
}
