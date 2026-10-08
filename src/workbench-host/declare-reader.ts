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

/** Minimal local shape of ctx.sessionQuery (package not in store — see file header). */
export interface SessionQueryLike {
  readSession(sessionId: string): Promise<{ events: readonly SessionEvent[] }>
}

export type DeclareReadResult =
  | { status: 'ok'; text: string }
  | { status: 'missing'; reason: 'no-service' | 'not-found' | 'unreadable' | 'no-declare-block' }

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

  async readDeclareText(sessionId: string): Promise<DeclareReadResult> {
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
      const fence = findDeclareFence(assistantText(events[index]!))
      if (fence !== null) return { status: 'ok', text: fence }
    }
    return { status: 'missing', reason: 'no-declare-block' }
  }
}
