/**
 * Locale dictionaries for the "任务图 / Task Graph" conversation-view tab.
 *
 * The conversation.view shell reads the stable entry id (`task-graph`) for
 * persistence and renders the localized label whenever the tab strip is
 * projected. Adding a key here is enough to localize a new label.
 */
import type { Context } from '@deepseek-ai/cordis'
// Side-effect import: pulls in the `declare module '@deepseek-ai/cordis'`
// block that adds `locale: LocaleRuntime` to the host `Context` interface.
// Without this, `ctx.locale.register(...)` fails type-check even though the
// runtime proxy resolves it correctly.
import type {} from '@deepseek-ai/dsh-client-locale/client'

/** Locale namespace shared between the dictionary registration and the slot label binding. */
export const TASK_GRAPH_LOCALE_NS = 'skyaxis.taskGraph'

interface TaskGraphDictionary {
  readonly 'view.taskGraph': string
}

const zh: TaskGraphDictionary = {
  'view.taskGraph': '任务图',
}

const en: TaskGraphDictionary = {
  'view.taskGraph': 'Task Graph',
}

export function registerTaskGraphDictionaries(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register(TASK_GRAPH_LOCALE_NS, { zh, en }),
    'skyaxis.taskGraph: dictionaries',
  )
}
