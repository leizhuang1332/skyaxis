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
import { sessionsFace, startTaskGraphConnector } from './connector.js'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** Stable entry id used as the persisted selection key in ConversationStoreState.view. */
export const TASK_GRAPH_VIEW_ID = 'task-graph'

/** Tab order within the conversation view strip (chats take the leftmost seats). */
export const TASK_GRAPH_VIEW_ORDER = 30

export function registerTaskGraphView(ctx: Context): () => void {
  registerTaskGraphDictionaries(ctx)
  const t = ctx.locale.bind(TASK_GRAPH_LOCALE_NS)

  // plan 决策 1：store 跟随 apply 的 disposer 一起销毁；不走 store seat。
  const store = createTaskGraphStore()

  // 懒启动（双标签页事故的修正）：连接器不再随插件 apply 启动，改由
  // TaskGraphView 首次挂载时调用本工厂启动、卸载时释放返回的 disposer——
  // 没打开任务图 tab 的标签页不持有事件窗口订阅，host 不再被
  // "N 标签页 × 无条件窗口流送"放大负载（chat 视图同为挂载期订阅）。
  const startConnector = (): (() => void) =>
    startTaskGraphConnector(ctx, store, {
      subagentFallbackLabel: () => t('node.subagent'),
      workflowRunFallbackLabel: () => t('node.workflow'),
      workflowMemberFallbackLabel: () => t('node.workflowMember'),
    })

  // P2a 导航（诚实规则）：优先走 catalog 直系地址 openSubagent；没有地址时
  // 仅当 id 仍在 host 列表（ids）里才 open（open 对未知 id 会 fail loud）。
  // connector 的 buildSubagentGraph 已按同一 ids 门控标 navigable，这里是
  // 点击时的第二道守卫（两道读的是同一份 list 快照事实）。
  const navigate = (id: string): void => {
    const sessions = sessionsFace(ctx)
    const sessionId = id as SessionId
    const address = sessions.subagentAddress(sessionId)
    if (address) {
      sessions.openSubagent(address)
      return
    }
    if (sessions.list.getSnapshot().ids.includes(sessionId)) {
      sessions.open(sessionId)
    }
  }

  // 直接传组件函数，store 通过 prop 注入。SlotComponent<P> = (props: P) => ReactNode
  // 要求 props 类型对齐 ComposedProps；TaskGraphView 自己的 props 是
  // { store, t, navigate, startConnector }，多余字段（标准 kit 注入的
  // useStore / actions 等）会被丢弃——此 entry 不消费它们。
  const Component = (): ReactNode => (
    <TaskGraphView
      store={store}
      t={t satisfies TaskGraphT}
      navigate={navigate}
      startConnector={startConnector}
    />
  )

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

  // connector 的生命周期归视图挂载管（挂载启动 / 卸载释放）；slot 卸载会
  // unmount 组件 → effect cleanup 释放连接器，此处只处理 slot 本身。
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
    'skyaxis.taskGraph':
      | 'view.taskGraph'
      | 'view.empty'
      | 'view.loading'
      | 'view.error'
      | 'node.subagent'
      | 'node.workflow'
      | 'node.workflowMember'
      | 'view.hideFailedAttempts'
      | 'view.definition'
      | 'view.definitionScript'
      | 'view.close'
      | 'view.noMetrics'
      | 'metrics.provider'
      | 'metrics.model'
      | 'metrics.reasoning'
      | 'metrics.sourceRequest'
      | 'metrics.sourceAdapter'
      | 'metrics.sourceMissing'
      | 'status.pending'
      | 'status.running'
      | 'status.done'
      | 'status.failed'
      | 'status.cancelled'
  }
}
