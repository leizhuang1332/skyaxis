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
import { TaskGraphView } from './view.js'

/** Stable entry id used as the persisted selection key in ConversationStoreState.view. */
export const TASK_GRAPH_VIEW_ID = 'task-graph'

/** Tab order within the conversation view strip (chats take the leftmost seats). */
export const TASK_GRAPH_VIEW_ORDER = 30

export function registerTaskGraphView(ctx: Context): () => void {
  registerTaskGraphDictionaries(ctx)
  const t = ctx.locale.bind(TASK_GRAPH_LOCALE_NS)

  const dispose = ctx.slots.inject('conversation.view', () =>
    ctx.slots.register(
      {
        name: 'conversation.view',
        id: TASK_GRAPH_VIEW_ID,
        order: TASK_GRAPH_VIEW_ORDER,
        locale: TASK_GRAPH_LOCALE_NS,
        label: () => t('view.taskGraph'),
      },
      TaskGraphView,
    ),
  )

  return () => {
    dispose()
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
    'skyaxis.taskGraph': 'view.taskGraph'
  }
}
