/**
 * Registers the "任务图 / Task Graph" entry into the `conversation.view`
 * slot. The host conversation shell projects every registered entry into
 * `ViewTab[]` and activates one at a time, choosing the persisted preference,
 * the `chat` fallback, then nothing — never the first registered entry.
 *
 * Selection identity (kept stable across renames so persisted preferences
 * survive relabel):
 *   - id     : "task-graph"
 *   - locale : TASK_GRAPH_LOCALE_NS / "view.taskGraph"
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ReactNode } from 'react'
// Side-effect imports: both /client entries contain `declare module
// '@deepseek-ai/cordis'` blocks that add `locale: LocaleRuntime` and
// `slots: SlotRegistry` to the host `Context` interface. Without these, the
// runtime-correct `ctx.locale.*` and `ctx.slots.*` calls fail type-check.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import {
  TASK_GRAPH_LOCALE_NS,
  registerTaskGraphDictionaries,
} from './dictionary.js'
import type { TaskGraphT } from './dictionary.js'
import { TaskGraphView } from './view.js'
import { createTaskGraphStore } from './store.js'
import { startTaskGraphConnector } from './connector.js'

/** Stable entry id used as the persisted selection key in ConversationStoreState.view. */
export const TASK_GRAPH_VIEW_ID = 'task-graph'

/** Tab order within the conversation view strip (chats take the leftmost seats). */
export const TASK_GRAPH_VIEW_ORDER = 30

export function registerTaskGraphView(ctx: Context): () => void {
  registerTaskGraphDictionaries(ctx)
  const t = ctx.locale.bind(TASK_GRAPH_LOCALE_NS)

  // plan 决策 1：store / connector 跟随 apply 的 disposer 一起销毁；
  // 不走 store seat（v0.1 demo 不需要跨 slot 共享，scope 协议代价不值）。
  const store = createTaskGraphStore()
  const stopConnector = startTaskGraphConnector(ctx, store)

  // 直接传组件函数，store 通过 prop 注入。SlotComponent<P> = (props: P) => ReactNode
  // 要求 props 类型对齐 ComposedProps；TaskGraphView 自己的 props 是 { store, t }，
  // 多余字段（标准 kit 注入的 useStore / actions 等）会被丢弃——此 entry 不消费它们。
  const Component = (): ReactNode => <TaskGraphView store={store} t={t satisfies TaskGraphT} />

  const dispose = ctx.slots.inject('conversation.view', () =>
    ctx.slots.register(
      {
        name: 'conversation.view',
        id: TASK_GRAPH_VIEW_ID,
        order: TASK_GRAPH_VIEW_ORDER,
        locale: TASK_GRAPH_LOCALE_NS,
        label: () => t('view.taskGraph'),
      },
      Component,
    ),
  )

  return () => {
    dispose()
    stopConnector()
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    taskGraphView?: never
  }
}

/**
 * Local merges into `@deepseek-ai/dsh-client-ui-slots` so the host's
 * `conversation.view` slot (declared by `client-ui-conversation`, not
 * depended on here) and our private `skyaxis.taskGraph` locale namespace
 * are visible to the typed `register()`/`bind()` calls in this package.
 *
 * Scope and kind mirror what the host conversation shell declares (a list
 * slot under session-scoped conversation.session), so the typed
 * ComposedProps contract correctly models what the entry receives at
 * render time. Without these merges the TypeScript `SlotMap` only contains
 * `'root'` plus the settings rows, and the locale namespace table only
 * contains the locale plugin's own keys.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    'conversation.view': {
      kind: 'list'
      scope: 'session'
    }
  }
  interface LocaleNamespaceMap {
    'skyaxis.taskGraph': 'view.taskGraph' | 'view.empty' | 'view.loading'
  }
}
