/**
 * Browser loader entry for the task-board plugin skeleton.
 *
 * Registers the "任务图 / Task Graph" tab in the `conversation.view` slot.
 * The slot consumers (chat, trajectory, ...) handle their own entries; this
 * file only adds one more entry alongside them. Selection stays governed by
 * the conversation shell:
 *   1. persisted `ConversationStoreState.view` if still registered,
 *   2. `chat` fallback,
 *   3. nothing — never the first registered entry.
 *
 * `inject` lists the ctx service-property names this plugin reads:
 *   - `locale` — installed by `@deepseek-ai/dsh-client-locale` via
 *     `ctx.provide('locale', LocaleRuntime)`; this is also where
 *     `registerTaskGraphDictionaries(...)` pushes the zh/en entries.
 *   - `slots` — installed by `@deepseek-ai/dsh-client-ui-renderer` via
 *     `SlotRegistry` (its `Service` ctor registers under the key 'slots');
 *     the dispatch into `conversation.view` rides on this.
 *
 * cordis's reflect layer proxies ctx property reads through a strict
 * allow-list (`fiber.inject`); any property read not declared here throws
 * `cannot get property "<name>" without inject` at apply() time (see
 * `node_modules/@deepseek-ai/cordis/src/reflect.ts:144`). Declaring
 * `@scope/pkg` strings here instead — as an earlier draft did — looks
 * superficially similar but never matches a real service key, and cordis's
 * plugin-id fallback then hangs because `@deepseek-ai/dsh-client-ui-slots`
 * is a pure library (no `dsh.client` block) and never activates as a plugin.
 *
 * Profile-level ordering (ensure these plugins are loaded BEFORE skyaxis)
 * is set in `package.json#dsh.client.inject`; it does not overlap with
 * this cordis-level declaration.
 */
import type { Context } from '@deepseek-ai/cordis'
import { registerTaskGraphView } from './task-graph/register.jsx'
import { registerReposPoolView } from './repos-pool/register.jsx'

/**
 * Inject list — cordis reflect 层会在 apply 阶段校验 ctx 属性读取是否在 inject 列表里。
 *  - `locale`  — 由 `@deepseek-ai/dsh-client-locale` install，提供 `LocaleRuntime`
 *  - `slots`  — 由 `@deepseek-ai/dsh-client-ui-renderer` install，提供 `SlotRegistry`
 *  - `sessions` — 由 `@deepseek-ai/dsh-api-session-controller` install，提供 `ISessions`；
 *                task-graph connector 用 `ctx.sessions.list` + `binding(id).eventSource`
 *                拉真实 session 事件窗口（research/0002 §3.2 出路 A）。
 */
export const inject: readonly string[] = ['locale', 'slots', 'sessions']

export function apply(ctx: Context): () => void {
  const disposeTaskGraph = registerTaskGraphView(ctx)
  const disposeReposPool = registerReposPoolView(ctx)
  return () => {
    disposeReposPool()
    disposeTaskGraph()
  }
}
