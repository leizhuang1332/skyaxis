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
  readonly 'view.empty': string
  readonly 'view.loading': string
  readonly 'view.error': string
  readonly 'node.subagent': string
  readonly 'node.workflow': string
  readonly 'node.workflowMember': string
  readonly 'view.hideFailedAttempts': string
  readonly 'view.definition': string
  readonly 'view.definitionScript': string
  readonly 'view.close': string
  readonly 'view.noMetrics': string
  readonly 'metrics.provider': string
  readonly 'metrics.model': string
  readonly 'metrics.reasoning': string
  readonly 'metrics.sourceRequest': string
  readonly 'metrics.sourceAdapter': string
  readonly 'metrics.sourceMissing': string
  readonly 'status.pending': string
  readonly 'status.running': string
  readonly 'status.done': string
  readonly 'status.failed': string
  readonly 'status.cancelled': string
}

/** 视图层可用的 t 函数形状（register 绑定后以 prop 传入 TaskGraphView）。 */
export type TaskGraphT = (key: keyof TaskGraphDictionary) => string

const zh: TaskGraphDictionary = {
  'view.taskGraph': '任务图',
  'view.empty': '暂无选中的 session — 请在左侧打开一个会话。',
  'view.loading': '加载中…',
  'view.error': '任务图加载失败 — 详情见控制台',
  'node.subagent': '子代理',
  'node.workflow': '工作流',
  'node.workflowMember': '工作流成员',
  'view.hideFailedAttempts': '隐藏同名失败尝试',
  'view.definition': '工作流定义',
  'view.definitionScript': '脚本',
  'view.close': '关闭',
  'view.noMetrics': '该节点暂无指标记录',
  'metrics.provider': '提供方',
  'metrics.model': '模型',
  'metrics.reasoning': '思考深度',
  'metrics.sourceRequest': '请求配置',
  'metrics.sourceAdapter': 'Adapter 默认',
  'metrics.sourceMissing': '未记录',
  'status.pending': '未开始',
  'status.running': '进行中',
  'status.done': '完成',
  'status.failed': '失败',
  'status.cancelled': '已取消',
}

const en: TaskGraphDictionary = {
  'view.taskGraph': 'Task Graph',
  'view.empty': 'No session selected — open one from the sidebar.',
  'view.loading': 'Loading…',
  'view.error': 'Failed to load the task graph — see console for details',
  'node.subagent': 'Subagent',
  'node.workflow': 'Workflow',
  'node.workflowMember': 'Workflow member',
  'view.hideFailedAttempts': 'Hide same-name failed attempts',
  'view.definition': 'Workflow definition',
  'view.definitionScript': 'Script',
  'view.close': 'Close',
  'view.noMetrics': 'No metrics recorded for this node',
  'metrics.provider': 'Provider',
  'metrics.model': 'Model',
  'metrics.reasoning': 'Reasoning',
  'metrics.sourceRequest': 'request config',
  'metrics.sourceAdapter': 'adapter default',
  'metrics.sourceMissing': 'not recorded',
  'status.pending': 'pending',
  'status.running': 'running',
  'status.done': 'done',
  'status.failed': 'failed',
  'status.cancelled': 'cancelled',
}

export function registerTaskGraphDictionaries(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register(TASK_GRAPH_LOCALE_NS, { zh, en }),
    'skyaxis.taskGraph: dictionaries',
  )
}
