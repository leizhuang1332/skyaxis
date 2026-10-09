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
 * Assemble the delivery closure from ctx. Returns undefined when the SESSIONS
 * face is absent or malformed (jsdom; compositions without it) — the SOW
 * modal then renders no delivery button (honest no-render).
 *
 * The CONVERSATION face is deliberately NOT required here: cordis `get`
 * answers `undefined` for services whose providing fiber is not yet active
 * (verified: cordis lib/index.js:755-770「or undefined when not (yet)
 * provided」), and skyaxis may apply before the conversation shell does —
 * a register-time check would permanently kill the face. Instead the face
 * is armed REACTIVELY via ctx.inject (the machine-verified waiting-tracker/
 * uiSession pattern) and resolved again at CALL time; a click before the
 * shell is up answers the honest {ok:false, reason:'no-service'}.
 *
 * Temporary acceptance diagnostics (the P2b three-way pattern — remove after
 * 实机验收): register / arm / call-failure each log one console.info line so
 * a missing button is attributable from the host Console.
 */
export function createSowDelivery(ctx: Context): DeliverFace | undefined {
  // ctx.get: no inject requirement; absent ⇒ undefined (see file header).
  const get = (ctx as unknown as { get?: (name: string) => unknown }).get
  const sessions = get?.('sessions') as SessionsCreateFace | undefined
  if (sessions === undefined || typeof sessions.create !== 'function' || typeof sessions.scope !== 'function' || typeof sessions.open !== 'function') {
    console.info('[skyaxis] SOW delivery unavailable: sessions face absent or malformed')
    return undefined
  }

  let conversation: ConversationFace | undefined = get?.('conversation') as ConversationFace | undefined
  const disposeConversation = ctx.inject(['conversation'], (scope: unknown) => {
    conversation = (scope as { conversation?: ConversationFace }).conversation
    console.info('[skyaxis] SOW delivery: conversation face armed')
    return () => {
      conversation = undefined
    }
  })

  return async (text: string, workspacePath: string | undefined): Promise<DeliverOutcome> => {
    try {
      // Resolve at CALL time (register-time state may be pre-shell).
      const conversationFace = conversation ?? get?.('conversation') as ConversationFace | undefined
      if (conversationFace === undefined || typeof conversationFace.input?.for !== 'function') {
        console.info('[skyaxis] SOW delivery failed: conversation face not yet available (no-service)')
        return { ok: false, reason: 'no-service' }
      }
      // Official four-step (cwd: the requirement workspace; create = create-or-adopt).
      const sessionId = await sessions.create(workspacePath !== undefined && workspacePath !== '' ? { cwd: workspacePath } : undefined)
      const actx = sessions.scope(sessionId)
      conversationFace.input.for(actx).setDraft(text)
      sessions.open(sessionId)
      // Official openSession tail — return focus to the Conversation main
      // panel (the delivery started from the workbench tab). Best-effort.
      try {
        const layout = get?.('layout') as LayoutFace | undefined
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
