/**
 * Session declare reader (P3b): host-side extraction of a session's final
 * `# skyaxis-declare` block via `ctx.sessionQuery.readSession`.
 *
 * The engine face is STRUCTURAL (the PendingInteractionsLike precedent in
 * client/waiting-tracker.ts): `@deepseek-ai/dsh-session-query` is not a
 * dependency of this repo (resolvable only inside the .pnpm transitive
 * closure), so we declare the one method we consume and narrow through
 * `unknown` at the inject site — no package dependency, no Context
 * augmentation conflict. `SessionEvent` itself comes from the resolvable
 * `@deepseek-ai/dsh-session` devDep (type-only, erased).
 *
 * Correctness anchor — ASSISTANT-ONLY SCAN: the SOW document handed to the
 * session embeds the declare SKELETON, so the user/message event already
 * contains the marker; scanning the raw log would import the empty template.
 * We walk events in REVERSE and only `assistant/message` text blocks; the
 * LAST closed declare fence in the newest matching event wins (an
 * interrupted turn leaves the fence open and extracts nothing).
 *
 * Wired from ctx.inject(['sessionQuery'], …) in src/index.ts (the
 * workspaceBinder.setRegistry setter precedent); absent engine ⇒ 'no-service'
 * and the client degrades to the paste channel (D3 fallback, always alive).
 */
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { findDeclareFence } from './declare-parse.js'
import { findMarkerFence } from './fence.js'

const REVIEW_MARKER = '# skyaxis-review'

/** Minimal local shape of ctx.sessionQuery (package not in store — see file header). */
export interface SessionQueryLike {
  readSession(sessionId: string): Promise<{ events: readonly SessionEvent[] }>
  /**
   * 回传轮 shell repair: cross-session full-text search (the real engine's
   * searchSessions — "query text interpreted as data, never executable FTS
   * syntax"). Structurally optional: older engine builds lack it and the
   * repair degrades honestly to the disclosed miss.
   */
  searchSessions?(request: { query: string; limit?: number }): Promise<{ items: readonly { header: { id: string; createdAt?: number } }[] }>
}

export type DeclareReadResult =
  | { status: 'ok'; text: string }
  | {
    status: 'missing'
    reason: 'no-service' | 'not-found' | 'unreadable' | 'no-declare-block'
    /**
     * 回传轮 observability: a compact language-neutral fingerprint of what
     * the scan DID see, attached only to the no-declare-block miss (the
     * diagnosis blind spot — "no block" turned out to hide several distinct
     * wild shapes). Shape: events=<n> [<type:count,…>] chars=<n> fences=<n>
     * unclosed=<0|1> markers=<n>.
     */
    scan?: string
    /** True when the read log contains NO user/message at all — the delivery SHELL (四次诊断). */
    shell?: boolean
  }

export type ReviewReadResult =
  | { status: 'ok'; text: string }
  | { status: 'missing'; reason: 'no-service' | 'not-found' | 'unreadable' | 'no-review-block' }

/** Text of one assistant-surface event — its text content blocks joined (reasoning/tool blocks contribute nothing). */
function assistantText(event: SessionEvent): string {
  if (event.type === 'assistant/attempt') {
    // 三次诊断: an attempt that committed no surface message still embeds
    // its EXACT stream — a cancelled / stream-error turn's delivered text
    // lives here and nowhere else (types.d.ts: "failed, retried, cancelled,
    // or stream-error attempt"). Join the text-chunks records.
    const stream = (event.data as { stream?: unknown }).stream
    if (!Array.isArray(stream)) return ''
    const parts: string[] = []
    for (const record of stream) {
      if ((record as { type?: unknown } | null)?.type !== 'text-chunks') continue
      const texts = (record as { texts?: unknown }).texts
      if (!Array.isArray(texts)) continue
      for (const text of texts) {
        if (typeof text === 'string') parts.push(text)
      }
    }
    return parts.join('')
  }
  if (event.type !== 'assistant/message') return ''
  const message = (event.data as { message?: { content?: unknown } }).message
  const content = message?.content
  // 二次诊断 tolerance: some pipelines serialize a single-part message's
  // content as a plain STRING, not a block array — accept both shapes.
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const text = (block as { type?: unknown; text?: unknown } | null)?.text
    if ((block as { type?: unknown } | null)?.type === 'text' && typeof text === 'string') parts.push(text)
  }
  return parts.join('\n')
}

export class SessionDeclareReader {
  #engine: SessionQueryLike | undefined

  /** Wired from ctx.inject(['sessionQuery'], ...); undefined unwires (fetch → no-service). */
  setEngine(engine: SessionQueryLike | undefined): void {
    this.#engine = engine
  }

  /**
   * Read the session log and walk assistant/message events newest-first,
   * returning the FIRST whose text satisfies `locate`. Shared by both fetch
   * faces so the assistant-only scan (the template-misfire defense) and the
   * duck-typed error taxonomy live in one place.
   */
  async #scan(sessionId: string, locate: (text: string) => string | null): Promise<ScanResult> {
    if (this.#engine === undefined) return { status: 'missing', reason: 'no-service' }
    let events: readonly SessionEvent[]
    try {
      const snapshot = await this.#engine.readSession(sessionId)
      events = snapshot.events
    } catch (error) {
      // Duck-typed taxonomy check (the CatalogLike discipline — the typed
      // SessionQueryError class itself is not importable from this repo).
      const code = (error as { code?: unknown } | null)?.code
      return { status: 'missing', reason: code === 'SESSION_QUERY_SESSION_NOT_FOUND' ? 'not-found' : 'unreadable' }
    }
    for (let index = events.length - 1; index >= 0; index--) {
      const located = locate(assistantText(events[index]!))
      if (located !== null) return { status: 'ok', text: located }
    }
    return { status: 'missing', reason: 'none', events }
  }

  /** Declare fetch: hands back the FENCE BODY (the declare block is the payload). */
  async readDeclareText(sessionId: string): Promise<DeclareReadResult> {
    const result = await this.#scan(sessionId, (text) => findDeclareFence(text))
    if (result.status === 'ok') return result
    if (result.reason === 'none') {
      const events = result.events
      return {
        status: 'missing',
        reason: 'no-declare-block',
        scan: scanFingerprint(events, '# skyaxis-declare'),
        shell: !events.some((event) => event.type === 'user/message'),
      }
    }
    return { status: 'missing', reason: result.reason }
  }

  /**
   * 回传轮 shell repair: content-address the REAL conversation session by
   * the delivered task book's anchor text. The engine's cross-session search
   * returns hits ranked by strongest event; we exclude the shell itself and
   * take the NEWEST remaining header (re-deliveries of the same requirement
   * produce same-anchor sessions — newest wins, mirroring ruling ②). Absent
   * engine face / search failure / no hits ⇒ undefined (caller keeps the
   * disclosed miss).
   */
  async findTaskbookSession(anchor: string, excludeSessionId: string): Promise<string | undefined> {
    const search = this.#engine?.searchSessions
    if (search === undefined) return undefined
    let page: { items: readonly { header: { id: string; createdAt?: number } }[] }
    try {
      page = await search.call(this.#engine, { query: anchor, limit: 8 })
    } catch {
      return undefined
    }
    const candidates = page.items
      .map((item) => item?.header)
      .filter((header): header is { id: string; createdAt?: number } => header !== undefined && typeof header.id === 'string' && header.id.length > 0 && header.id !== excludeSessionId)
    if (candidates.length === 0) return undefined
    let best = candidates[0]!
    for (const candidate of candidates) {
      if ((candidate.createdAt ?? 0) > (best.createdAt ?? 0)) best = candidate
    }
    return best.id
  }

  /**
   * Review fetch (P5b): hands back the WHOLE assistant message that carries a
   * `# skyaxis-review` block — a review report IS free-form markdown and the
   * convention block is part of it, so the stored body should be the entire
   * message (its contentHash then covers the block and the idempotency anchor
   * works on the whole document). The marker still LOCATES the message (so the
   * user/message template skeleton can never be mistaken for a report — the
   * declare template-misfire defense carries over verbatim).
   */
  async readReviewText(sessionId: string): Promise<ReviewReadResult> {
    const result = await this.#scan(sessionId, (text) => (findMarkerFence(text, REVIEW_MARKER) !== null ? text : null))
    if (result.status === 'ok') return result
    return { status: 'missing', reason: result.reason === 'none' ? 'no-review-block' : result.reason }
  }
}

/** Internal scan outcome — 'none' means "engine read fine, no match" (events ride along for the fingerprint). */
type ScanResult =
  | { status: 'ok'; text: string }
  | { status: 'missing'; reason: 'no-service' | 'not-found' | 'unreadable' }
  | { status: 'missing'; reason: 'none'; events: readonly SessionEvent[] }

/**
 * Compact scan fingerprint for the no-declare-block miss (see DeclareReadResult.scan):
 * an event-TYPE histogram (三次诊断 — assistant=0 with 4 events was only
 * half a diagnosis; the histogram names the shapes) plus marker mentions
 * over ALL assistant texts (any column, even prose) and fence stats of the
 * LAST assistant text, so the remaining wild shapes (subagent-authored
 * report / wrong session id / indented block / mis-shaped fences) are
 * tellable apart from the UI line alone.
 */
function scanFingerprint(events: readonly SessionEvent[], marker: string): string {
  const needle = marker.replace(/^#\s+/, '')
  const counts = new Map<string, number>()
  let markers = 0
  let last = ''
  for (const event of events) {
    counts.set(event.type, (counts.get(event.type) ?? 0) + 1)
    if (event.type !== 'assistant/message' && event.type !== 'assistant/attempt') continue
    const text = assistantText(event)
    for (const line of text.split(/\r?\n/)) {
      if (line.includes(needle)) markers += 1
    }
    last = text
  }
  const types = [...counts.entries()].map(([type, count]) => `${type}:${count}`).join(',')
  let fences = 0
  let unclosed = false
  let inFence = false
  for (const line of last.split(/\r?\n/)) {
    if (inFence) {
      if (/^```\s*$/.test(line)) {
        fences += 1
        inFence = false
      }
      continue
    }
    if (/^```[A-Za-z0-9_-]*\s*$/.test(line)) inFence = true
  }
  if (inFence) unclosed = true
  return `events=${events.length} [${types}] chars=${last.length} fences=${fences} unclosed=${unclosed ? 1 : 0} markers=${markers}`
}
