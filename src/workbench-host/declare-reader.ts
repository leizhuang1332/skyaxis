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
}

export type DeclareReadResult =
  | { status: 'ok'; text: string }
  | { status: 'missing'; reason: 'no-service' | 'not-found' | 'unreadable' | 'no-declare-block' }

export type ReviewReadResult =
  | { status: 'ok'; text: string }
  | { status: 'missing'; reason: 'no-service' | 'not-found' | 'unreadable' | 'no-review-block' }

/** Text of one assistant/message event — its text content blocks joined (reasoning/tool blocks contribute nothing). */
function assistantText(event: SessionEvent): string {
  if (event.type !== 'assistant/message') return ''
  const message = (event.data as { message?: { content?: unknown } }).message
  const content = message?.content
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
    return { status: 'missing', reason: 'none' }
  }

  /** Declare fetch: hands back the FENCE BODY (the declare block is the payload). */
  async readDeclareText(sessionId: string): Promise<DeclareReadResult> {
    const result = await this.#scan(sessionId, (text) => findDeclareFence(text))
    if (result.status === 'ok') return result
    return { status: 'missing', reason: result.reason === 'none' ? 'no-declare-block' : result.reason }
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

/** Internal scan outcome — 'none' means "engine read fine, no match". */
type ScanResult =
  | { status: 'ok'; text: string }
  | { status: 'missing'; reason: 'no-service' | 'not-found' | 'unreadable' | 'none' }
