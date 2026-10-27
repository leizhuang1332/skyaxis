/**
 * 明细面板模型（v0.4 切片 B，ADR 0036 §2.4）：(document, node) → PanelModel
 * 纯函数。明细面板的唯一数据源——view 只渲染模型，不自行拼数据；本模块
 * 可单测（不依赖 React / cordis）。
 *
 * 按节点 kind 出判别联合模型；缺失数据一律诚实降级（无 spawn 不渲染
 * section、无配对结果的工具调用不臆造时长），绝不造事实。
 */
import type { SkyaxisAgentMetrics } from '../../../agent-metrics.js'
import type { TaskNode, TaskStatus } from '../types.js'
import type {
  ActivityDoc,
  ActivityKind,
  SessionDocument,
  SpawnFacts,
  TaskRevision,
} from '../document/types.js'
import type { WorkflowDefinition } from '../workflows.js'

/** turn 面板的活动行（summary 行 + 原始活动供展开渲染）。 */
export interface ActivityLine {
  key: string
  kind: ActivityKind
  /** 摘要行标题：工具名 / 消息首段 / 审批工具名。 */
  title: string
  /** 工具调用时长（配对结果才有）；assistant/approval 无（不臆造）。 */
  durationMs?: number
  /** 工具失败位。 */
  isError?: boolean
  /** 审批待决位（无 decided）。 */
  pending?: boolean
  outcome?: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
  /** 原始活动事实（<details> 展开区渲染用）。 */
  activity: ActivityDoc
}

export interface RootPanel {
  kind: 'root'
  label: string
  status: TaskStatus
  metrics?: SkyaxisAgentMetrics
  hasMore: boolean
}

export interface TurnPanel {
  kind: 'turn'
  /** 面板头标题（节点 label——首条消息首行，与画布一致）。 */
  label: string
  index: number
  /** 该 turn 全部人类消息全文（时间序）。 */
  messages: readonly { text: string; time: number }[]
  durationMs?: number
  /** 结束原因（kind + error 的 message/code 原文；未收场缺省）。 */
  endReason?: { kind: string; message?: string; code?: string }
  activities: readonly ActivityLine[]
}

export interface TaskPanel {
  kind: 'task'
  /** 面板头标题（节点 label——content 截断，与画布一致；全文在 content）。 */
  label: string
  key: string
  /** content 全文（画布 label 是截断，面板不截）。 */
  content: string
  /** 逐 write 修订时间线。 */
  history: readonly TaskRevision[]
}

export interface SubagentPanel {
  kind: 'subagent'
  label: string
  status?: TaskStatus
  metrics?: SkyaxisAgentMetrics
  navigable: boolean
  navigationId?: string
  /** 委派事实（本会话事件窗口内可考时；投影边界外诚实缺省）。 */
  spawn?: SpawnFacts
}

export interface WorkflowPanel {
  kind: 'workflow'
  label: string
  status?: TaskStatus
  durationMs?: number
  definition?: WorkflowDefinition
}

/** phase / member 及防御兜底（root 域外无文档事实的节点）。 */
export interface GenericPanel {
  kind: 'node'
  label: string
  status?: TaskStatus
  metrics?: SkyaxisAgentMetrics
  navigable?: boolean
  navigationId?: string
}

export type PanelModel =
  | RootPanel
  | TurnPanel
  | TaskPanel
  | SubagentPanel
  | WorkflowPanel
  | GenericPanel

/** 节点 id → turn index（task-chain 的 `user-{index}` 约定）。 */
const turnIndexOf = (id: string): number | undefined => {
  if (!id.startsWith('user-')) return undefined
  const n = Number(id.slice('user-'.length))
  return Number.isInteger(n) ? n : undefined
}

/** 节点 id → 全局 task key（`todo-{key}` 约定）。 */
const taskKeyOf = (id: string): string | undefined =>
  id.startsWith('todo-') ? id.slice('todo-'.length) : undefined

export function panelModelFor(document: SessionDocument, node: TaskNode): PanelModel {
  switch (node.type) {
    case 'root':
      return {
        kind: 'root',
        label: document.label,
        status: document.rootStatus,
        ...(document.rootMetrics === undefined ? {} : { metrics: document.rootMetrics }),
        hasMore: document.hasMore,
      }

    case 'user-prompt': {
      const index = turnIndexOf(node.id)
      const turn = index === undefined ? undefined : document.turns.find((t) => t.index === index)
      if (turn === undefined) {
        return { kind: 'node', label: node.data.label }
      }
      const messages = turn.userPromptRefs.map((ref) => {
        const event = document.contents.get(ref)
        const raw = event as { time?: number } | undefined
        return { text: event === undefined ? '' : messageFullText(event), time: raw?.time ?? 0 }
      })
      const reason = turn.endReason
      return {
        kind: 'turn',
        label: node.data.label,
        index: turn.index,
        messages,
        ...(turn.startTime !== undefined && turn.endTime !== undefined
          ? { durationMs: turn.endTime - turn.startTime }
          : {}),
        ...(reason === undefined
          ? {}
          : {
              endReason: {
                kind: reason.kind,
                ...readErrorFields(reason),
              },
            }),
        activities: activityLines(document, turn.activityKeys),
      }
    }

    case 'task': {
      const key = taskKeyOf(node.id)
      const entry = key === undefined ? undefined : document.tasks.get(key)
      if (entry === undefined) {
        return { kind: 'node', label: node.data.label }
      }
      return {
        kind: 'task',
        label: node.data.label,
        key: entry.key,
        content: entry.content,
        history: entry.history,
      }
    }

    case 'subagent': {
      const childId = node.data.navigationId
      const spawnActivity =
        childId === undefined
          ? undefined
          : [...document.activities.values()].find(
              (a): a is Extract<ActivityDoc, { kind: 'tool-call' }> =>
                a.kind === 'tool-call' && a.spawn !== undefined && String(a.spawn.childId) === childId,
            )
      return {
        kind: 'subagent',
        label: node.data.label,
        ...(node.data.status === undefined ? {} : { status: node.data.status }),
        ...(node.data.metrics === undefined ? {} : { metrics: node.data.metrics }),
        navigable: node.data.navigable === true,
        ...(childId === undefined ? {} : { navigationId: childId }),
        ...(spawnActivity === undefined ? {} : { spawn: spawnActivity.spawn }),
      }
    }

    case 'workflow':
      return {
        kind: 'workflow',
        label: node.data.label,
        ...(node.data.status === undefined ? {} : { status: node.data.status }),
        ...(node.data.durationMs === undefined ? {} : { durationMs: node.data.durationMs }),
        ...(node.data.definition === undefined ? {} : { definition: node.data.definition }),
      }

    // workflow-phase / workflow-member（及防御兜底）：无文档层专属事实。
    default:
      return {
        kind: 'node',
        label: node.data.label,
        ...(node.data.status === undefined ? {} : { status: node.data.status }),
        ...(node.data.metrics === undefined ? {} : { metrics: node.data.metrics }),
        ...(node.data.navigable === undefined ? {} : { navigable: node.data.navigable }),
        ...(node.data.navigationId === undefined ? {} : { navigationId: node.data.navigationId }),
      }
  }
}

/** turn 活动清单（key → 活动行；缺失 key 防御跳过）。 */
function activityLines(
  document: SessionDocument,
  keys: readonly string[],
): ActivityLine[] {
  const lines: ActivityLine[] = []
  for (const key of keys) {
    const activity = document.activities.get(key)
    if (activity === undefined) continue
    lines.push({
      key: activity.key,
      kind: activity.kind,
      title:
        activity.kind === 'tool-call'
          ? activity.name
          : activity.kind === 'approval'
            ? activity.toolName
            : truncate(activity.text, 60),
      ...(activity.kind === 'tool-call' && activity.result !== undefined
        ? { durationMs: activity.result.durationMs, isError: activity.result.isError }
        : {}),
      ...(activity.kind === 'approval'
        ? activity.outcome === undefined
          ? { pending: true }
          : { outcome: activity.outcome }
        : {}),
      activity,
    })
  }
  return lines
}

/** turn/end 的 error 分支 LlmFailure 字段防御读（message/code 原文）。 */
function readErrorFields(reason: unknown): { message?: string; code?: string } {
  if (typeof reason !== 'object' || reason === null) return {}
  const r = reason as { error?: unknown }
  if (r.error === undefined || typeof r.error !== 'object') return {}
  const e = r.error as { message?: unknown; code?: unknown }
  return {
    ...(typeof e.message === 'string' ? { message: e.message } : {}),
    ...(typeof e.code === 'string' ? { code: e.code } : {}),
  }
}

/** user/message 事件全文（全部 text blocks 连接——面板正文，非首行截断）。 */
function messageFullText(event: { data: unknown }): string {
  const content = (event.data as unknown as { content?: readonly unknown[] }).content ?? []
  const parts: string[] = []
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue
    const p = part as { type?: unknown; text?: unknown }
    if (p.type === 'text' && typeof p.text === 'string' && p.text !== '') parts.push(p.text)
  }
  return parts.join('\n')
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}

/**
 * 时长人类化（纯函数）：`340ms` / `3.2s` / `2m 05s` / `1h 04m`。
 * 负值/缺省防御：Math.max(0, ms)。
 */
export function formatDuration(ms: number): string {
  const v = Math.max(0, Math.round(ms))
  if (v < 1000) return `${v}ms`
  if (v < 60_000) return `${(v / 1000).toFixed(1)}s`
  if (v < 3_600_000) {
    const m = Math.floor(v / 60_000)
    const s = Math.floor((v % 60_000) / 1000)
    return `${m}m ${String(s).padStart(2, '0')}s`
  }
  const h = Math.floor(v / 3_600_000)
  const m = Math.floor((v % 3_600_000) / 60_000)
  return `${h}h ${String(m).padStart(2, '0')}m`
}
