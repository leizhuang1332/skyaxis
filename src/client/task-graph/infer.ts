/**
 * Session 事件窗口 → 任务图推断。
 *
 * 规则摘要（research/0002 §五 + ADR 0001 §五）：
 *   - root 节点：永远一个
 *   - step 节点：step/start ... step/end 配对；status 由事件 + 内部 tool 错误聚合
 *   - tool-call 节点：所属 step 下挂；status 取 tool/result（error 标记 → failed）
 *   - approval 节点：tool/call.name 以 "approval" 开头时升级（v0.1 demo 占位用）
 *
 * Subagent 子树 v0.1 demo 不做（依赖 useProjection 拼装，留 v0.2）。
 *
 * 这是纯函数，相同入参必返回相同出参；connector 把它包成 store 写入。
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionEventLikeEntry } from '@deepseek-ai/dsh-api-session-controller/client'
import type { TaskNode, TaskEdge, TaskStatus } from './types.js'

interface InferredNode extends TaskNode {
  data: TaskNode['data'] & {
    /** 仅推断期使用：节点在 step/end 后是否要升级为 failed。 */
    _hasError?: boolean
  }
}

export function inferTaskGraph(
  entries: readonly SessionEventLikeEntry[],
  sessionLabel: string,
): { nodes: TaskNode[]; edges: TaskEdge[] } {
  // 只用 durable entry；transient live-chunk 不参与节点构建。
  const events = entries
    .filter((e): e is Extract<SessionEventLikeEntry, { type: 'event' }> => e.type === 'event')
    .map((e) => e.event)
    // entries 已按 seq 连续排序，但保险起见显式排一次。
    .sort((a, b) => a.seq - b.seq)

  const rawNodes: InferredNode[] = []
  const rawEdges: TaskEdge[] = []

  // root 节点（永远 1 个）
  rawNodes.push({
    id: 'root',
    type: 'root',
    position: { x: 0, y: 0 },
    data: { label: sessionLabel, status: 'running' },
  })

  let stepCounter = 0
  /** stepId → { toolIds: [], error: false, assistantLabel?: string } */
  const openSteps = new Map<
    string,
    { toolIds: string[]; error: boolean; assistantLabel?: string }
  >()
  let lastStepId: string | undefined
  /** toolCallId → stepId，用于 tool/result 反查父 step。 */
  const toolParentStep = new Map<string, string>()

  for (const ev of events) {
    switch (ev.type) {
      case 'step/start': {
        stepCounter += 1
        const stepId = makeStepId(ev.data.turn, ev.data.step)
        openSteps.set(stepId, { toolIds: [], error: false })
        lastStepId = stepId
        rawNodes.push({
          id: stepId,
          type: 'step',
          position: { x: 0, y: 0 },
          data: { label: `Step ${stepCounter}`, status: 'running' },
        })
        rawEdges.push({ id: `e-root-${stepId}`, source: 'root', target: stepId })
        break
      }
      case 'step/end': {
        const stepId = makeStepId(ev.data.turn, ev.data.step)
        const step = openSteps.get(stepId)
        if (step) {
          const status: TaskStatus = step.error ? 'failed' : 'done'
          const label = step.assistantLabel
          updateNode(rawNodes, stepId, { status, ...(label ? { label } : {}) })
          openSteps.delete(stepId)
          if (lastStepId === stepId) lastStepId = undefined
        }
        break
      }
      case 'assistant/message': {
        const stepId = makeStepId(ev.data.turn, ev.data.step)
        const step = openSteps.get(stepId)
        const text = extractFirstText(ev.data.message.content)
        if (step && text && !step.assistantLabel) {
          step.assistantLabel = text
          // 仅替换默认 "Step N" 标签，保留已有自定义。
          const node = rawNodes.find((n) => n.id === stepId)
          if (node && /^Step \d+$/.test(node.data.label)) {
            updateNode(rawNodes, stepId, { label: text })
          }
        }
        break
      }
      case 'tool/call': {
        if (!lastStepId) break
        const toolId = makeToolId(ev.data.callId)
        const isApproval = ev.data.name.toLowerCase().startsWith('approval')
        toolParentStep.set(toolId, lastStepId)
        const step = openSteps.get(lastStepId)
        if (step) step.toolIds.push(toolId)
        rawNodes.push({
          id: toolId,
          type: isApproval ? 'approval' : 'step',
          position: { x: 0, y: 0 },
          data: { label: ev.data.name, status: 'running' },
        })
        rawEdges.push({ id: `e-${lastStepId}-${toolId}`, source: lastStepId, target: toolId })
        break
      }
      case 'tool/result': {
        const callId = ev.data.message.source.callId
        const toolId = makeToolId(callId)
        const parentStepId = toolParentStep.get(toolId)
        const isError = isToolResultError(ev)
        updateNode(rawNodes, toolId, { status: isError ? 'failed' : 'done' })
        if (isError && parentStepId) {
          const step = openSteps.get(parentStepId)
          if (step) step.error = true
        }
        break
      }
      // 其他事件类型 v0.1 demo 不参与推断（turn/*、system/*、request/*、session/end-seed、user/message）。
      default:
        break
    }
  }

  // 未关闭的 step 保持 running（与原始事件流一致）。
  for (const stepId of openSteps.keys()) {
    updateNode(rawNodes, stepId, { status: 'running' })
  }

  // 剥离推断期私有字段。
  const nodes: TaskNode[] = rawNodes.map((n) => {
    const { _hasError: _ignore, ...data } = n.data
    void _ignore
    return { ...n, data }
  })
  return { nodes, edges: rawEdges }
}

function makeStepId(turn: number, step: number): string {
  return `step-${turn}-${step}`
}

function makeToolId(callId: string): string {
  return `tool-${callId}`
}

function updateNode(
  nodes: InferredNode[],
  id: string,
  patch: Partial<TaskNode['data']>,
): void {
  const node = nodes.find((n) => n.id === id)
  if (node) node.data = { ...node.data, ...patch }
}

function isToolResultError(ev: SessionEvent<'tool/result'>): boolean {
  // 两层错误信号：ToolResultBlock.isError（model-facing）和事件级 error（identity）。
  const block = ev.data.message.content[0]
  if (block && block.isError === true) return true
  if (ev.data.error !== undefined) return true
  return false
}

/**
 * 从 assistant content blocks 里抽取第一个 text 段落的首行（≤60 字符）。
 * Reasoning / tool-call 块不参与 label 推断。
 */
function extractFirstText(content: readonly unknown[]): string {
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue
    const p = part as { type?: unknown; text?: unknown }
    if (p.type === 'text' && typeof p.text === 'string') {
      const firstLine = p.text.split(/\r?\n/)[0]?.trim() ?? ''
      return truncate(firstLine, 60)
    }
  }
  return ''
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}
