/**
 * SOW delivery v3 (0017 D1; probe-verified on the real machine 2026-10-19 on
 * host 0.1.5-rc.2; rc.3 rework 2026-11-03, decisions/0038):
 * create the session in the requirement's workspace and PROMPT the task book
 * straight into it — no open(), no jump, no draft. The modal preview IS the
 * send consent (the text there has been user-editable since 0009 and the
 * button honestly reads 投递并发送) — this supersedes the 0007 §3.2 v2
 * ruling (「人握门禁」: create+setDraft+user presses send) by explicit
 * re-ratification in decisions/0017; scope of the reversal is delivery only
 * (0016 D2-A steering verbs stay deep-link-only).
 *
 * Probe evidence (0017 刀零): prompt into a NEVER-opened created session is
 * accepted and the created id turns real. The v2 shell pathology (the real
 * conversation materializing at a NEW id after the user sent via the
 * conversation Hero — decisions/0016 修订 #95/#96) never occurs on this
 * path: the Hero is never involved.
 *
 * rc.3 session-reference discipline (0033 upgrade regression, 0038 修复轮):
 * `create()` only CATALOGUES the id — `binding()`/`scope()` answer undefined
 * until `retain()` materializes the shared scope (client service.ts scopes
 * map; the SDK's own doc: "retain it before borrowing its binding"). The
 * 0017 probe predates the host upgrade (0.1.5-rc.2 bound created ids
 * without retain), so post-0033 both the prompt arm AND the v2 tail's
 * scope() silently dead-armed — every delivery degraded to the copy
 * fallback. Fix: retain({source:'skyaxisDelivery'}) around BOTH arms,
 * release in finally (the admitted prompt is host-durable; release only
 * tears down the client scope/history window — the sidebar re-retains on
 * open).
 *
 * Degrade (0017 D3): a rejected/throwing prompt — or a missing prompt face —
 * falls back to the v2 tail (setDraft + openSession 导航), so the task is
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
 * Access: same cordis `ctx.get` discipline as v2 — sessions (create/retain/
 * binding/scope; 0033：open 退役, 0038：retain 必需) is required at arm time;
 * conversation (degrade-only now) is armed reactively via ctx.inject (the
 * machine-verified waiting-tracker pattern) and resolved again at call time.
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

/** Minimal SessionReference 消费面（rc.3 引用纪律：retain 同步物化共享 scope，release 归还）. */
interface SessionReferenceFace {
  /** Shared binding; valid until release (client service.ts:196-199). */
  readonly binding: BindingFace
  release(): void
}

/** Minimal shape of ctx.sessions.create/retain/binding/scope (ISessions 消费面；0033：open 退役；0038：retain 必需). */
interface SessionsCreateFace {
  create(opts?: { cwd?: string; workspaceId?: string }): Promise<string>
  retain(id: string, options: { source: string }): SessionReferenceFace
  binding(id: string): BindingFace | undefined
  scope(sessionId: string): unknown
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
 * Exported for the review-import candidate scoping (0024 修订#2) — one
 * spelling of the comparison, never two.
 */
export const sameHostPath = (left: string, right: string): boolean => {
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
 * The shared v2 degrade tail: draft into the conversation input + navigate —
 * the user presses send (0017 D3). Caller wraps in try/catch and maps a throw
 * to {ok:false,'failed'}.
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
  // 0033 改道（0.2.1-rc.3）：ISessions.open 退役，导航统一走宿主
  // UiWorkspace.openSession（单段式 select+show Conversation，含回主面板
  // ——原 open+selectPanel 两步被其一步覆盖）。Best-effort：face 缺席或
  // 异形不阻塞——草稿已落，用户可自行切换。
  try {
    const uiWorkspace = get?.('uiWorkspace') as { openSession(target: unknown): void } | undefined
    uiWorkspace?.openSession(sessionId)
  } catch {
    // A uiWorkspace service with a different shape never blocks the send.
  }
  return { ok: true, sessionId, sent: false }
}

/** The sessions-face shape check shared by both closures (four members；0033：open 退役；0038：retain 必需). */
const sessionsFaceOk = (sessions: SessionsCreateFace | undefined): sessions is SessionsCreateFace =>
  sessions !== undefined && typeof sessions.create === 'function' && typeof sessions.binding === 'function'
    && typeof sessions.scope === 'function' && typeof sessions.retain === 'function'

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

    // rc.3 引用纪律（0038）: create 只入目录，retain 才物化共享 scope——
    // 引用须覆盖双臂（v2 尾的 scope() 同样吃它），prompt 落定后即归还
    // （宿主侧已持久，release 只拆客户端 scope/历史窗）.
    const reference = sessions.retain(sessionId, { source: 'skyaxisDelivery' })
    try {
      // v3 main: prompt straight into the never-opened session (刀零实证：
      // 接受即变实，无 shell 物化、无 Hero 交互).
      const session = reference.binding.session
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
    } finally {
      reference.release()
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
 * to the v2 tail on the SAME id (setDraft + openSession 导航), so the note
 * is never stranded; conversation absent too → honest no-service (the modal's
 * copy button stays the manual fallback).
 */
export function createSessionMessenger(ctx: Context): SendMessageFace | undefined {
  const get = (ctx as unknown as { get?: (name: string) => unknown }).get
  const sessions = get?.('sessions') as SessionsCreateFace | undefined
  if (!sessionsFaceOk(sessions)) return undefined

  const resolveConversation = armConversation(ctx, get)

  return async (sessionId: string, text: string): Promise<DeliverOutcome> => {
    // rc.3 引用纪律（0038）同投递主路径：retain 物化 scope 后才借得到
    // binding——目标会话可能从未被任何人 retain（投递后即 release 的壳），
    // refcount 对已被侧栏 retain 的活跃会话安全（+1/-1）.
    const reference = sessions.retain(sessionId, { source: 'skyaxisDelivery' })
    try {
      const session = reference.binding.session
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
    } finally {
      reference.release()
    }
  }
}
