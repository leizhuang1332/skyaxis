/**
 * SOW delivery v2 (P5a; research 0007 §3.2 user-ratified form): create a new
 * session in the requirement's workspace, prefill the composer draft, leave
 * the SEND key with the user —「人握门禁」. prompt-style auto-send stays out.
 *
 * Route ruling (source-audited, recorded in milestones): setDraft goes
 * through `ctx.conversation.input.for(actx).setDraft(text)` — the official
 * draft hand-off (the conversation Hero's workspace switch and ui-commands'
 * `input.for(actx).notify` are 100%-isomorphic precedents). The slot-props
 * route is a DEAD END for us: inputActions reaches only components mounted
 * for the CURRENT staged session, and the delivery target is a freshly
 * created (not yet open) session. The ctx route is pure object layer — the
 * InputHub builds the shell lazily, the draft lives in a headless Lexical
 * editor, and the composer renders it on mount AFTER open. setDraft BEFORE
 * open is the official order.
 *
 * Access: cordis `ctx.get(name)` reads services WITHOUT the inject-list
 * requirement (cordis/lib/index.js:748; ui-commands' inject array doesn't
 * carry 'conversation' either) — absent services answer undefined and the
 * face degrades honestly. All three faces are structural minimal shapes
 * (packages not in this repo's dependency tree — the PendingInteractionsLike
 * precedent in ../waiting-tracker.ts).
 *
 * Known window (officially accepted, recorded): a draft set before open
 * lives in shell memory only; it persists to localStorage once the user
 * touches the input. Official beforeOpen hand-offs accept the same window.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Minimal shape of ctx.conversation.input (package not in store). */
interface ConversationInputFace {
  setDraft(text: string): void
}

interface ConversationFace {
  input: { for(actx: unknown): ConversationInputFace }
}

/** Minimal shape of ctx.sessions.create/scope (ISessions members we consume). */
interface SessionsCreateFace {
  create(opts?: { cwd?: string }): Promise<string>
  scope(sessionId: string): unknown
  open(sessionId: string): void
}

/** Minimal shape of ctx.layout (optional post-open nicety). */
interface LayoutFace {
  selectPanel(panel: string | null): void
}

export interface DeliverOutcome {
  readonly ok: boolean
  readonly sessionId?: string
  readonly reason?: 'no-service' | 'failed'
}

/**
 * Deliver face: workspacePath is PER REQUIREMENT, so it rides the CALL (the
 * register-level closure captures only ctx services, never requirement data).
 */
export type DeliverFace = (text: string, workspacePath: string | undefined) => Promise<DeliverOutcome>

/**
 * Assemble the delivery closure from ctx. Returns undefined when any required
 * service is absent (jsdom, compositions without the conversation shell) —
 * the SOW modal then renders no delivery button (honest no-render).
 */
export function createSowDelivery(ctx: Context): DeliverFace | undefined {
  // ctx.get: no inject requirement; absent ⇒ undefined (see file header).
  const sessions = (ctx as unknown as { get?: (name: string) => unknown }).get?.('sessions') as SessionsCreateFace | undefined
  const conversation = (ctx as unknown as { get?: (name: string) => unknown }).get?.('conversation') as ConversationFace | undefined
  const layout = (ctx as unknown as { get?: (name: string) => unknown }).get?.('layout') as LayoutFace | undefined
  if (sessions === undefined || conversation === undefined) return undefined
  if (typeof sessions.create !== 'function' || typeof sessions.scope !== 'function' || typeof sessions.open !== 'function') return undefined
  if (typeof conversation.input?.for !== 'function') return undefined

  return async (text: string, workspacePath: string | undefined): Promise<DeliverOutcome> => {
    try {
      // Official four-step (cwd: the requirement workspace; create = create-or-adopt).
      const sessionId = await sessions.create(workspacePath !== undefined && workspacePath !== '' ? { cwd: workspacePath } : undefined)
      const actx = sessions.scope(sessionId)
      conversation.input.for(actx).setDraft(text)
      sessions.open(sessionId)
      // Official openSession tail — return focus to the Conversation main
      // panel (the delivery started from the workbench tab). Best-effort.
      try {
        layout?.selectPanel(null)
      } catch {
        // A layout service with a different shape never blocks delivery.
      }
      return { ok: true, sessionId }
    } catch {
      return { ok: false, reason: 'failed' }
    }
  }
}
