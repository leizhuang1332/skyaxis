/**
 * Execution fold (0016 P1b) — the client-side defensive parser that folds a
 * session-digest tail window into an ExecutionDigest for the collapsed live
 * column. Same domain as task-graph/infer.ts + workflows.ts: seq-sort before
 * fold, switch + default:break for unknown types (counted, not silently
 * dropped), duck-typed payload reads with `?? 0` defaults, skip-don't-invent.
 *
 * The P0 alignment: tool/call name+arguments → toolName+argsPreview (P0
 * tool/call histogram: read/grep/pwsh/edit/glob/write/todo_write); edit/write
 * arguments JSON carries file_path → fileChanges; assistant/message carries
 * usage tokens (P0: usage lives in assistant/message); request/context
 * carries model+contextWindow. Every field is individually guarded — a
 * schema drift degrades to an absent field, never a wrong one.
 */
import type { ExecutionDigest, ExecutionEntry, SessionDigestEvent } from '../../workbench-shared/protocol.js'

/** Sort by seq (permutation invariance — the workflows.ts discipline). */
function bySeq(a: SessionDigestEvent, b: SessionDigestEvent): number {
  return (a.seq ?? 0) - (b.seq ?? 0)
}

/** Safe turn/step extraction from a data payload. */
function readTurnStep(data: unknown): { turn: number; step?: number } {
  if (typeof data !== 'object' || data === null) return { turn: 0 }
  const r = data as Record<string, unknown>
  const turn = typeof r.turn === 'number' ? r.turn : 0
  const step = typeof r.step === 'number' ? r.step : undefined
  return { turn, ...(step !== undefined ? { step } : {}) }
}

/** Extract file_path from edit/write tool arguments (JSON string). */
function extractFilePath(argumentsJson: unknown): string | undefined {
  if (typeof argumentsJson !== 'string') return undefined
  try {
    const parsed: unknown = JSON.parse(argumentsJson)
    if (typeof parsed !== 'object' || parsed === null) return undefined
    const path = (parsed as Record<string, unknown>).file_path
    return typeof path === 'string' && path.length > 0 ? path : undefined
  } catch {
    return undefined
  }
}

/** Extract a short text from assistant message content blocks. */
function extractText(data: unknown): { text?: string; tokens?: number } {
  if (typeof data !== 'object' || data === null) return {}
  const r = data as Record<string, unknown>
  const message = r.message
  if (typeof message !== 'object' || message === null) return {}
  const m = message as Record<string, unknown>
  const content = m.content
  const usage = m.usage
  let tokens: number | undefined
  if (typeof usage === 'object' && usage !== null) {
    const total = (usage as Record<string, unknown>).totalTokens
    if (typeof total === 'number') tokens = total
  }
  if (!Array.isArray(content)) return { ...(tokens !== undefined ? { tokens } : {}) }
  const parts: string[] = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const b = block as Record<string, unknown>
    if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
  }
  return {
    ...(parts.length > 0 ? { text: parts.join('\n').slice(0, 500) } : {}),
    ...(tokens !== undefined ? { tokens } : {}),
  }
}

/** Extract model/contextWindow from a request/context event. */
function extractModelContext(data: unknown): { model?: string; contextWindow?: number } {
  if (typeof data !== 'object' || data === null) return {}
  const r = data as Record<string, unknown>
  const model = typeof r.model === 'string' ? r.model : undefined
  const contextWindow = typeof r.contextWindow === 'number' ? r.contextWindow : undefined
  return {
    ...(model !== undefined ? { model } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
  }
}

/** Extract deliverable files from a deliverables/presented event. */
function extractDeliverables(data: unknown): Array<{ path: string; description: string }> {
  if (typeof data !== 'object' || data === null) return []
  const files = (data as Record<string, unknown>).files
  if (!Array.isArray(files)) return []
  const out: Array<{ path: string; description: string }> = []
  for (const file of files) {
    if (typeof file !== 'object' || file === null) continue
    const f = file as Record<string, unknown>
    if (typeof f.path !== 'string' || f.path.length === 0) continue
    out.push({ path: f.path, description: typeof f.description === 'string' ? f.description : '' })
  }
  return out
}

/**
 * Fold a tail-window of session events into an ExecutionDigest.
 * Unknown event types are counted (unknownEventCount) — never silently
 * dropped, never fabricated into entries.
 */
export function foldExecutionDigest(events: readonly SessionDigestEvent[], lastEventCount: number): ExecutionDigest {
  const sorted = [...events].sort(bySeq)
  const entries: ExecutionEntry[] = []
  const fileChanges: string[] = []
  const deliverableFiles: Array<{ path: string; description: string }> = []
  let totalTokens = 0
  let model: string | undefined
  let contextWindow: number | undefined
  let queuedMessageCount = 0
  let unknownEventCount = 0
  // Pending tool calls keyed by callId, for result backfill
  const pendingTools = new Map<string, ExecutionEntry>()

  for (const ev of sorted) {
    const timestamp = ev.time ?? 0
    const { turn, step } = readTurnStep(ev.data)
    switch (ev.type) {
      case 'turn/start': {
        entries.push({ kind: 'turn-start', turn, timestamp })
        break
      }
      case 'turn/end': {
        entries.push({ kind: 'turn-end', turn, timestamp })
        break
      }
      case 'step/start': {
        entries.push({ kind: 'step-start', turn, ...(step !== undefined ? { step } : {}), timestamp })
        break
      }
      case 'tool/call': {
        if (typeof ev.data !== 'object' || ev.data === null) break
        const d = ev.data as Record<string, unknown>
        const callId = typeof d.callId === 'string' ? d.callId : undefined
        const name = typeof d.name === 'string' ? d.name : undefined
        const args = typeof d.arguments === 'string' ? d.arguments : undefined
        if (name === undefined) break // don't fabricate nameless tools
        const argsPreview = args !== undefined ? args.slice(0, 120) : undefined
        const entry: ExecutionEntry = {
          kind: 'tool-call',
          turn,
          ...(step !== undefined ? { step } : {}),
          ...(name !== undefined ? { toolName: name } : {}),
          ...(argsPreview !== undefined ? { toolArgsPreview: argsPreview } : {}),
          timestamp,
        }
        entries.push(entry)
        if (callId !== undefined) pendingTools.set(callId, entry)
        // edit/write → fileChanges
        if (name === 'edit' || name === 'write') {
          const filePath = extractFilePath(args)
          if (filePath !== undefined && !fileChanges.includes(filePath)) fileChanges.push(filePath)
        }
        break
      }
      case 'tool/result': {
        if (typeof ev.data !== 'object' || ev.data === null) break
        const d = ev.data as Record<string, unknown>
        const message = d.message
        if (typeof message !== 'object' || message === null) break
        const msg = message as Record<string, unknown>
        const source = msg.source
        if (typeof source !== 'object' || source === null) break
        const src = source as Record<string, unknown>
        const callId = typeof src.callId === 'string' ? src.callId : undefined
        if (callId === undefined) break
        const pending = pendingTools.get(callId)
        if (pending === undefined) break // orphan result — don't fabricate
        // Backfill result preview (first 120 chars of first tool-result text)
        const content = msg.content
        if (Array.isArray(content)) {
          for (const block of content) {
            if (typeof block !== 'object' || block === null) continue
            const b = block as Record<string, unknown>
            if (b.type === 'tool-result' && typeof b.text === 'string') {
              // The entry is already pushed; mutate via index lookup
              const idx = entries.indexOf(pending)
              if (idx >= 0) {
                entries[idx] = {
                  ...pending,
                  ...(b.text.length > 0 ? { resultPreview: b.text.slice(0, 120) } : {}),
                }
              }
              break
            }
          }
        }
        break
      }
      case 'assistant/message': {
        const { text, tokens } = extractText(ev.data)
        if (text !== undefined || tokens !== undefined) {
          entries.push({
            kind: 'text',
            turn,
            ...(step !== undefined ? { step } : {}),
            ...(text !== undefined ? { text } : {}),
            ...(tokens !== undefined ? { tokens } : {}),
            timestamp,
          })
        }
        if (tokens !== undefined) totalTokens += tokens
        break
      }
      case 'user/message': {
        if (typeof ev.data !== 'object' || ev.data === null) break
        const content = (ev.data as Record<string, unknown>).content
        let text: string | undefined
        if (typeof content === 'string') text = content.slice(0, 200)
        else if (Array.isArray(content)) {
          const parts: string[] = []
          for (const block of content) {
            if (typeof block !== 'object' || block === null) continue
            const b = block as Record<string, unknown>
            if (b.type === 'text' && typeof b.text === 'string') parts.push(b.text)
          }
          if (parts.length > 0) text = parts.join('\n').slice(0, 200)
        }
        entries.push({ kind: 'user-message', turn, ...(text !== undefined ? { text } : {}), timestamp })
        break
      }
      case 'agent/inbox/spliced': {
        queuedMessageCount++
        break
      }
      case 'deliverables/presented': {
        deliverableFiles.push(...extractDeliverables(ev.data))
        break
      }
      case 'request/context': {
        const extracted = extractModelContext(ev.data)
        if (extracted.model !== undefined) model = extracted.model
        if (extracted.contextWindow !== undefined) contextWindow = extracted.contextWindow
        break
      }
      case 'session':
      case 'session/title':
      case 'session/title-llm-request':
      case 'session/end-seed':
      case 'permission/preset':
      case 'sandbox/mode':
      case 'approval/policy':
      case 'request/header':
      case 'system/message':
      case 'assistant/attempt':
      case 'todo/write':
        // Known-but-not-rendered types — not unknown, just not in the live view
        break
      default:
        unknownEventCount++
        break
    }
  }

  return {
    lastEventCount,
    ...(model !== undefined ? { model } : {}),
    ...(totalTokens > 0 ? { totalTokens } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    fileChanges,
    queuedMessageCount,
    deliverableFiles,
    unknownEventCount,
    entries,
  }
}
