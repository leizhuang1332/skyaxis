/**
 * Session 事件窗口 → 任务图推断。
 *
 * 规则摘要（research/0002 §五 + ADR 0001 §五 + v0.2 重构）：
 *   - root 节点：永远一个
 *   - step 节点：step/start ... step/end 配对；label 取自 assistant text（识别有序列表
 *     / Markdown checkbox 后可拆出多个 step 兄弟节点）；status 由事件 + 内部 tool
 *     错误 + approval pending 聚合
 *   - tool-call 节点：**v0.2 删除**（与 DSH 原生 trajectory 重叠，无差异化价值）；
 *     仅保留错误聚合 + approval → waiting 状态升级逻辑
 *   - approval 节点：tool/call.name 以 "approval" 开头时**只影响 step 状态**，
 *     不再单独成节点（v0.1 的 approval 节点类型保留 type 占位但本函数不再生成）
 *
 * Subagent 子树 v0.2 demo 不做（依赖 useProjection 拼装，留后续 ADR）。
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
  /** stepId → { toolIds: [], error: false, assistantLabel?, hasApprovalPending } */
  const openSteps = new Map<
    string,
    {
      toolIds: string[]
      error: boolean
      assistantLabel?: string
      hasApprovalPending: boolean
    }
  >()
  let lastStepId: string | undefined
  /** toolCallId → { stepId, isApproval }，用于 tool/result 反查父 step。 */
  const toolParentStep = new Map<string, { stepId: string; isApproval: boolean }>()

  for (const ev of events) {
    switch (ev.type) {
      case 'step/start': {
        stepCounter += 1
        const stepId = makeStepId(ev.data.turn, ev.data.step)
        openSteps.set(stepId, { toolIds: [], error: false, hasApprovalPending: false })
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
          const status: TaskStatus = step.error
            ? 'failed'
            : step.hasApprovalPending
              ? 'waiting'
              : 'done'
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
        const labels = extractStepLabels(ev.data.message.content)
        if (step && labels.length > 0 && !step.assistantLabel) {
          const first = labels[0]!
          step.assistantLabel = first
          const node = rawNodes.find((n) => n.id === stepId)
          if (node && /^Step \d+$/.test(node.data.label)) {
            updateNode(rawNodes, stepId, { label: first })
            // 拆解：assistant text 含 ≥2 个列表项 → 在原 step 之后插入兄弟 step 节点。
            // 仅在原 step 仍为默认 "Step K" 时拆分，避免重复渲染。
            if (labels.length >= 2) {
              for (let i = 1; i < labels.length; i++) {
                const sibStepId = makeSyntheticStepId(
                  ev.data.turn,
                  ev.data.step,
                  i,
                )
                rawNodes.push({
                  id: sibStepId,
                  type: 'step',
                  position: { x: 0, y: 0 },
                  data: { label: labels[i]!, status: 'done' },
                })
                rawEdges.push({
                  id: `e-root-${sibStepId}`,
                  source: 'root',
                  target: sibStepId,
                })
              }
            }
          }
        }
        break
      }
      case 'tool/call': {
        // v0.2：tool-call 不再作为图节点渲染（与 DSH 原生 trajectory 重叠）。
        // 仅保留错误聚合 + approval 识别，向上影响 step 状态。
        if (!lastStepId) break
        const toolId = makeToolId(ev.data.callId)
        const isApproval = ev.data.name.toLowerCase().startsWith('approval')
        toolParentStep.set(toolId, { stepId: lastStepId, isApproval })
        const step = openSteps.get(lastStepId)
        if (step) {
          step.toolIds.push(toolId)
          if (isApproval) step.hasApprovalPending = true
        }
        break
      }
      case 'tool/result': {
        const callId = ev.data.message.source.callId
        const toolId = makeToolId(callId)
        const parent = toolParentStep.get(toolId)
        if (!parent) break
        const isError = isToolResultError(ev)
        if (isError) {
          const step = openSteps.get(parent.stepId)
          if (step) step.error = true
        }
        if (parent.isApproval) {
          // approval 工具已收 result → 不再 waiting
          const step = openSteps.get(parent.stepId)
          if (step) step.hasApprovalPending = false
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

/**
 * 拆解出的兄弟 step 节点的合成 id。
 * 与真实 `(turn, step)` 命名空间隔离（加 `-L{i}` 后缀），
 * 防止与后续真实 step 冲突。
 */
function makeSyntheticStepId(turn: number, step: number, index: number): string {
  return `step-${turn}-${step}-L${index}`
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
 * 从 assistant content blocks 里抽取 step label 数组。
 *
 * v0.2 行为：
 *   1. 拼接所有 `type === 'text'` block（多段以 `\n` 连接），得到 markdown 全文
 *   2. 按出现顺序扫描两种模式：
 *      - Markdown checkbox：`/^[\s>]*-\s\[(?:\s|x|X)\]\s+(.+?)$/m`
 *      - 有序列表：`/^[\s>]*\d+\.\s+(.+?)$/m`
 *      每条命中作为独立 label（≤60 字符）
 *   3. 兜底：两种模式都未命中 → 返回首段首行（≤60 字符）
 *   4. 完全无文本 → 返回空数组（不生成 label）
 *
 * Reasoning / image / file / tool-call 块不参与 label 抽取。
 */
function extractStepLabels(content: readonly unknown[]): string[] {
  const parts: string[] = []
  for (const part of content) {
    if (typeof part !== 'object' || part === null) continue
    const p = part as { type?: unknown; text?: unknown }
    if (p.type === 'text' && typeof p.text === 'string') {
      parts.push(p.text)
    }
  }
  if (parts.length === 0) return []
  const text = parts.join('\n')

  // 模式 1：Markdown checkbox（含未完成 [ ] 与已完成 [x]/[X]）
  const checkboxRe = /^[\s>]*-\s\[(?:\s|x|X)\]\s+(.+?)$/gm
  // 模式 2：有序列表（1. / 2. / ...）
  const orderedRe = /^[\s>]*\d+\.\s+(.+?)$/gm

  const labels: string[] = []
  // 用一个统一的扫描器：按行号升序收集两种模式的命中
  const hits: { line: number; text: string }[] = []
  collectMatches(text, checkboxRe, hits)
  collectMatches(text, orderedRe, hits)
  hits.sort((a, b) => a.line - b.line)
  for (const h of hits) {
    const trimmed = h.text.trim()
    if (trimmed.length === 0) continue
    labels.push(truncate(trimmed, 60))
  }

  if (labels.length > 0) return labels

  // 兜底：首段首行
  const firstLine = text.split(/\r?\n/)[0]?.trim() ?? ''
  if (firstLine.length === 0) return []
  return [truncate(firstLine, 60)]
}

function collectMatches(
  text: string,
  re: RegExp,
  out: { line: number; text: string }[],
): void {
  // 重置 lastIndex 以避免全局 regex 的副作用
  re.lastIndex = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    // 计算 m.index 所在的行号（0-based）
    const line = text.slice(0, m.index).split(/\r?\n/).length - 1
    out.push({ line, text: m[1] ?? '' })
    // 防御性：零宽度匹配会导致死循环
    if (m.index === re.lastIndex) re.lastIndex++
  }
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max - 1) + '…' : s
}
