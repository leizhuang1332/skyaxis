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
  readonly 'view.earlierEvents': string
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
  readonly 'panel.history': string
  readonly 'panel.duration': string
  readonly 'panel.turnMessages': string
  readonly 'panel.turnActivities': string
  readonly 'panel.endReason': string
  readonly 'panel.activity.assistant': string
  readonly 'panel.activity.tool': string
  readonly 'panel.activity.approval': string
  readonly 'panel.tool.args': string
  readonly 'panel.tool.result': string
  readonly 'panel.tool.error': string
  readonly 'panel.approval.reason': string
  readonly 'panel.approval.outcome': string
  readonly 'panel.approval.pending': string
  readonly 'panel.spawn': string
  readonly 'panel.spawnPrompt': string
  readonly 'panel.openSession': string
  readonly 'panel.tokens': string
  readonly 'panel.reasoning': string
  readonly 'panel.interrupted': string
  readonly 'panel.noActivities': string
  readonly 'legend.fact': string
  readonly 'legend.inferred': string
  readonly 'status.pending': string
  readonly 'status.running': string
  readonly 'status.done': string
  readonly 'status.failed': string
  readonly 'status.cancelled': string
  readonly 'status.waiting': string
}

/** 视图层可用的 t 函数形状（register 绑定后以 prop 传入 TaskGraphView）。 */
export type TaskGraphT = (key: keyof TaskGraphDictionary) => string

const zh: TaskGraphDictionary = {
  'view.taskGraph': '任务图',
  'view.empty': '暂无选中的 session — 请在左侧打开一个会话。',
  'view.loading': '加载中…',
  'view.error': '任务图加载失败 — 详情见控制台',
  'view.earlierEvents': '更早的事件未载入',
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
  'panel.history': '修订时间线',
  'panel.duration': '时长',
  'panel.turnMessages': '输入消息',
  'panel.turnActivities': '本轮活动',
  'panel.endReason': '结束原因',
  'panel.activity.assistant': '助手消息',
  'panel.activity.tool': '工具调用',
  'panel.activity.approval': '审批',
  'panel.tool.args': '参数',
  'panel.tool.result': '结果',
  'panel.tool.error': '错误',
  'panel.approval.reason': '问题',
  'panel.approval.outcome': '结局',
  'panel.approval.pending': '待决',
  'panel.spawn': '委派',
  'panel.spawnPrompt': '委派 Prompt',
  'panel.openSession': '打开会话',
  'panel.tokens': 'Token',
  'panel.reasoning': '思考',
  'panel.interrupted': '已中断',
  'panel.noActivities': '本轮无活动记录',
  'legend.fact': '实线：wire 事实',
  'legend.inferred': '虚线：推断顺序',
  'status.pending': '未开始',
  'status.running': '进行中',
  'status.done': '完成',
  'status.failed': '失败',
  'status.cancelled': '已取消',
  'status.waiting': '待输入',
}

const en: TaskGraphDictionary = {
  'view.taskGraph': 'Task Graph',
  'view.empty': 'No session selected — open one from the sidebar.',
  'view.loading': 'Loading…',
  'view.error': 'Failed to load the task graph — see console for details',
  'view.earlierEvents': 'Earlier events not loaded',
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
  'panel.history': 'Revision history',
  'panel.duration': 'Duration',
  'panel.turnMessages': 'Input messages',
  'panel.turnActivities': 'Turn activities',
  'panel.endReason': 'End reason',
  'panel.activity.assistant': 'Assistant message',
  'panel.activity.tool': 'Tool call',
  'panel.activity.approval': 'Approval',
  'panel.tool.args': 'Arguments',
  'panel.tool.result': 'Result',
  'panel.tool.error': 'Error',
  'panel.approval.reason': 'Question',
  'panel.approval.outcome': 'Outcome',
  'panel.approval.pending': 'Pending',
  'panel.spawn': 'Delegation',
  'panel.spawnPrompt': 'Delegation prompt',
  'panel.openSession': 'Open session',
  'panel.tokens': 'Tokens',
  'panel.reasoning': 'Reasoning',
  'panel.interrupted': 'Interrupted',
  'panel.noActivities': 'No activity recorded in this turn',
  'legend.fact': 'Solid: wire facts',
  'legend.inferred': 'Dashed: inferred order',
  'status.pending': 'pending',
  'status.running': 'running',
  'status.done': 'done',
  'status.failed': 'failed',
  'status.cancelled': 'cancelled',
  'status.waiting': 'waiting for input',
}

export function registerTaskGraphDictionaries(ctx: Context): void {
  ctx.effect(
    () => ctx.locale.register(TASK_GRAPH_LOCALE_NS, { zh, en }),
    'skyaxis.taskGraph: dictionaries',
  )
}
