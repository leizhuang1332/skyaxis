/**
 * Hand-declared wire shape for the `approval/asked` / `approval/decided`
 * session events (v0.4 切片 B).
 *
 * Declared by `@deepseek-ai/dsh-user-approval` in the DSH monorepo (merged
 * into the wire SessionEventMap there), but that package is not a dependency
 * of this repo, so the merge is invisible to our type-check. We re-declare
 * the exact wire shape here so `case 'approval/asked'` narrows properly —
 * same pattern as the todo-write.d.ts precedent.
 *
 * Honest shape (dsh-user-approval 0.2.1-rc.3 lib/types/types.d.ts:27-53,
 * verified for research 0033 §四): log-only audit events — asked carries the
 * human-readable `reason` and optional `callId` linking the approved tool
 * call; decided pairs by `id` with a closed four-value outcome. Neither
 * payload carries turn/step — turn attribution is ambient (fold.ts), unlike
 * assistant/tool events whose payloads carry both explicitly.
 */
// 顶层 `export {}` 让本文件成为模块文件 —— declare module 被当作 module
// augmentation（合并进已解析的真实模块）的必要条件（todo-write.d.ts 踩过）。
export {}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'approval/asked': {
      id: string
      toolName: string
      callId?: string
      reason?: string
    }
    'approval/decided': {
      id: string
      outcome: 'allowed-once' | 'rejected' | 'cancelled' | 'unavailable'
    }
  }
}
