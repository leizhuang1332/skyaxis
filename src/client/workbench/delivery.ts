/**
 * SOW delivery v3 (0017 D1; probe-verified on the real machine 2026-10-19):
 * create the session in the requirement's workspace and PROMPT the task book
 * straight into it — no open(), no jump, no draft. The modal preview IS the
 * send consent (the text there has been user-editable since 0009 and the
 * button honestly reads 投递并发送) — this supersedes the 0007 §3.2 v2
 * ruling (「人握门禁」: create+setDraft+user presses send) by explicit
 * re-ratification in decisions/0017; scope of the reversal is delivery only
 * (0016 D2-A steering verbs stay deep-link-only).
 *
 * Probe evidence (0017 刀零): prompt into a NEVER-opened created session is
 * accepted and the created id turns real (the client flips blankBit=false
 * and fires onEngaged on acceptance — dsh-api-session-controller
 * client.js:1695-1699). The v2 shell pathology (the real conversation
 * materializing at a NEW id after the user sent via the conversation Hero —
 * decisions/0016 修订 #95/#96) never occurs on this path: the Hero is never
 * involved. Static supports: binding() materializes for any listed session
 * (resolve()/eligible()), and the SDK itself RPCs into never-opened created
 * sessions (fork() → binding(childId).session.rename).
 *
 * Degrade (0017 D3): a rejected/throwing prompt — or a missing prompt face —
 * falls back to the v2 tail (setDraft + open + selectPanel), so the task is
 * never stranded. Degraded deliveries report sent:false; the dev
 * bind-at-delivery (0017 刀二) gates on sent — a degraded shell may still be
 * re-materialized elsewhere, title/content addressing repairs it later.
 *
 * Workspace attachment (刀一验收修正): the session is created with a
 * workspaceId resolved from the requirement's workspacePath (live list match
 * → create-or-resolve registration → honest cwd-only degrade) — cwd-only
 * sessions never ATTACH and stay invisible in the DSH sidebar's per-workspace
 * list. See resolveCreateOpts.
 *
 * Access: same cordis `ctx.get` discipline as v2 — sessions (create/binding/
 * scope/open) is required at arm time; conversation (degrade-only now) is
 * armed reactively via ctx.inject (the machine-verified waiting-tracker
 * pattern) and resolved again at call time.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Minimal prompt text part (contract PromptContentPart 的 text 臂). */
interface PromptTextPart {
  readonly type: 'text'
  readonly text: string
}

/** Minimal RemoteResult error arm (typert-protocol types.d.ts:65-71) — 只判 ok，错误细节不消费。 */
type PromptResult = { readonly ok: true } | { readonly ok: false }

/** Minimal ISession.prompt face (contract/session.d.ts:81-83). */
interface SessionPromptFace {
  prompt(content: PromptTextPart[], mode: 'queue' | 'steer'): Promise<PromptResult>
}

/** Minimal SessionBinding.session 臂（service.d.ts:103-110 只取消费字段）. */
interface BindingFace {
  readonly session?: SessionPromptFace
}

/** Minimal shape of ctx.conversation.input (degrade 路径专用). */
interface ConversationInputFace {
  setDraft(text: string): void
}

interface ConversationFace {
  input: { for(actx: unknown): ConversationInputFace }
}

/** Minimal shape of ctx.sessions.create/binding/scope/open (ISessions 消费面). */
interface SessionsCreateFace {
  create(opts?: { cwd?: string; workspaceId?: string }): Promise<string>
  binding(id: string): BindingFace | undefined
  scope(sessionId: string): unknown
  open(sessionId: string): void
}

/** Minimal WorkspaceView (workspace-controller types.d.ts:12-24 消费面). */
interface WorkspaceViewFace {
  readonly workspaceId: string
  readonly path: string
}

/** Minimal ctx.workspaces face（Service 'workspaces'：controller + list 模型）. */
interface WorkspacesFace {
  readonly list?: { getSnapshot(): { readonly items: readonly WorkspaceViewFace[] } }
  create?(input: { readonly path: string }): Promise<WorkspaceViewFace>
}

/**
 * Host-path equality for workspace matching: case-insensitive + separator-
 * insensitive + trailing-slash-insensitive (zh-CN Win11 实机——台账路径与
 * WorkspaceView.path 可能差在反斜杠/大小写/尾斜杠；sow.ts:424 反斜杠折叠先例).
 */
const sameHostPath = (left: string, right: string): boolean => {
  const norm = (path: string): string => path.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase()
  return norm(left) === norm(right)
}

/**
 * Resolve the create opts for the requirement's workspace (刀一验收修正):
 * sessions created with cwd ONLY never attach to a Workspace — the host's
 * SessionCommandController.create attaches exclusively on workspaceId
 * (index.js:586-593), so a cwd-only session is invisible in the DSH
 * sidebar's per-workspace session list (user acceptance finding
 * 2026-10-19). Resolve the path against the live workspace list; a miss
 * REGISTERS it (workspaces.create is create-or-resolve by canonical path —
 * host index.js:196-213 resolveByPath 先行, idempotent); the face absent or
 * the registration failing degrades honestly to cwd-only (functional
 * session, sidebar-invisible — never worse than the pre-fix state).
 */
async function resolveCreateOpts(
  get: ((name: string) => unknown) | undefined,
  sessions: SessionsCreateFace,
  workspacePath: string | undefined,
): Promise<{ cwd?: string; workspaceId?: string } | undefined> {
  if (workspacePath === undefined || workspacePath === '') return undefined
  const workspaces = get?.('workspaces') as WorkspacesFace | undefined
  const items = workspaces?.list?.getSnapshot?.().items
  const hit = items?.find((row) => sameHostPath(row.path, workspacePath))
  if (hit !== undefined) return { workspaceId: hit.workspaceId }
  try {
    const registered = await workspaces?.create?.({ path: workspacePath })
    if (registered !== undefined) return { workspaceId: registered.workspaceId }
  } catch {
    // Registration refused (invalid/absent directory…) — honest cwd degrade.
  }
  return { cwd: workspacePath }
}

/** Minimal shape of ctx.layout (degrade 尾巴的尽力而为步). */
interface LayoutFace {
  selectPanel(panel: string | null): void
}

export interface DeliverOutcome {
  readonly ok: boolean
  readonly sessionId?: string
  /** true = prompt 已自动发送（v3 主路径）；false/absent = 降级为草稿待手发（v2 尾巴）。 */
  readonly sent?: boolean
  readonly reason?: 'no-service' | 'failed'
}

/**
 * Deliver face: workspacePath is PER REQUIREMENT, so it rides the CALL (the
 * register-level closure captures only ctx services, never requirement data).
 */
export type DeliverFace = (text: string, workspacePath: string | undefined) => Promise<DeliverOutcome>

/**
 * 0019 rework-note send face: prompt text into an ALREADY-EXISTING session —
 * the failed-acceptance WP's tail dev binding. sessionId rides the call for
 * the same per-requirement reason as DeliverFace's workspacePath.
 */
export type SendMessageFace = (sessionId: string, text: string) => Promise<DeliverOutcome>

/**
 * The degrade-only conversation face, armed reactively (pre-shell register
 * timing answered undefined for not-yet-active fibers in v2; same discipline
 * retained), resolved again at call time. Shared by the v3 delivery and the
 * 0019 session-messenger closures — both fall back to the v2 tail through it.
 */
function armConversation(ctx: Context, get: ((name: string) => unknown) | undefined): () => ConversationFace | undefined {
  let conversation: ConversationFace | undefined = get?.('conversation') as ConversationFace | undefined
  ctx.inject(['conversation'], (scope: unknown) => {
    conversation = (scope as { conversation?: ConversationFace }).conversation
    return () => {
      conversation = undefined
    }
  })
  return () => conversation
}

/**
 * The shared v2 degrade tail: draft into the conversation input + open +
 * selectPanel — the user presses send (0017 D3). Caller wraps in try/catch
 * and maps a throw to {ok:false,'failed'}.
 */
function v2Tail(
  sessions: SessionsCreateFace,
  conversationFace: ConversationFace,
  sessionId: string,
  text: string,
  get: ((name: string) => unknown) | undefined,
): DeliverOutcome {
  const actx = sessions.scope(sessionId)
  conversationFace.input.for(actx).setDraft(text)
  sessions.open(sessionId)
  // Official openSession tail — return focus to the Conversation main
  // panel. Best-effort.
  try {
    const layout = get?.('layout') as LayoutFace | undefined
    layout?.selectPanel(null)
  } catch {
    // A layout service with a different shape never blocks the send.
  }
  return { ok: true, sessionId, sent: false }
}

/** The sessions-face shape check shared by both closures (four members). */
const sessionsFaceOk = (sessions: SessionsCreateFace | undefined): sessions is SessionsCreateFace =>
  sessions !== undefined && typeof sessions.create === 'function' && typeof sessions.binding === 'function'
    && typeof sessions.scope === 'function' && typeof sessions.open === 'function'

/**
 * Assemble the delivery closure from ctx. Returns undefined when the SESSIONS
 * face is absent or malformed (jsdom; compositions without it) — the SOW
 * modal then renders no delivery button (honest no-render).
 */
export function createSowDelivery(ctx: Context): DeliverFace | undefined {
  // ctx.get: no inject requirement; absent ⇒ undefined (v2 头注先例).
  const get = (ctx as unknown as { get?: (name: string) => unknown }).get
  const sessions = get?.('sessions') as SessionsCreateFace | undefined
  if (!sessionsFaceOk(sessions)) return undefined

  const resolveConversation = armConversation(ctx, get)

  return async (text: string, workspacePath: string | undefined): Promise<DeliverOutcome> => {
    let sessionId: string
    try {
      // 刀一验收修正: workspaceId 优先（挂工作区→侧栏可见），cwd 为诚实降级档.
      sessionId = await sessions.create(await resolveCreateOpts(get, sessions, workspacePath))
    } catch {
      return { ok: false, reason: 'failed' }
    }

    // v3 main: prompt straight into the never-opened session (刀零实证：
    // 接受即变实，无 shell 物化、无 Hero 交互).
    const session = sessions.binding(sessionId)?.session
    if (session !== undefined && typeof session.prompt === 'function') {
      try {
        const admitted = await session.prompt([{ type: 'text', text }], 'queue')
        if (admitted.ok) return { ok: true, sessionId, sent: true }
      } catch {
        // 落入降级尾巴（D3）——任务不中断.
      }
    }

    // Degrade = the v2 tail: draft + open + jump, the user presses send.
    const conversationFace = resolveConversation() ?? get?.('conversation') as ConversationFace | undefined
    if (conversationFace === undefined || typeof conversationFace.input?.for !== 'function') {
      return { ok: false, reason: 'no-service' }
    }
    try {
      return v2Tail(sessions, conversationFace, sessionId, text, get)
    } catch {
      return { ok: false, reason: 'failed' }
    }
  }
}

/**
 * 0019 rework-note messenger (decision 0019 D1-B): prompt text straight into
 * an ALREADY-EXISTING session — the bound dev session of a failed-acceptance
 * work package. Same RPC as the v3 delivery main path (probe evidence 0017
 * 刀零); the only new face is "the target already exists and may be idle or
 * running" — idle takes the message as a fresh round, running queues it
 * (host-native semantics, the「排队补话」word's literal meaning). NO create():
 * the id is the ledger's tail dev binding, never a minted session.
 *
 * Degrade: a rejected/throwing prompt — or a missing prompt face — falls back
 * to the v2 tail on the SAME id (setDraft + open + selectPanel), so the note
 * is never stranded; conversation absent too → honest no-service (the modal's
 * copy button stays the manual fallback).
 */
export function createSessionMessenger(ctx: Context): SendMessageFace | undefined {
  const get = (ctx as unknown as { get?: (name: string) => unknown }).get
  const sessions = get?.('sessions') as SessionsCreateFace | undefined
  if (!sessionsFaceOk(sessions)) return undefined

  const resolveConversation = armConversation(ctx, get)

  return async (sessionId: string, text: string): Promise<DeliverOutcome> => {
    const session = sessions.binding(sessionId)?.session
    if (session !== undefined && typeof session.prompt === 'function') {
      try {
        const admitted = await session.prompt([{ type: 'text', text }], 'queue')
        if (admitted.ok) return { ok: true, sessionId, sent: true }
      } catch {
        // 落入降级尾巴——返工话不中断.
      }
    }

    const conversationFace = resolveConversation() ?? get?.('conversation') as ConversationFace | undefined
    if (conversationFace === undefined || typeof conversationFace.input?.for !== 'function') {
      return { ok: false, reason: 'no-service' }
    }
    try {
      return v2Tail(sessions, conversationFace, sessionId, text, get)
    } catch {
      return { ok: false, reason: 'failed' }
    }
  }
}
