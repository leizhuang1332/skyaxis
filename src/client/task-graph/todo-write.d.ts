/**
 * Hand-declared wire shape for the `todo/write` session event.
 *
 * The event is declared by `@deepseek-ai/dsh-tool-todo` in the DSH monorepo
 * (merged into the wire SessionEventMap there — see the typert host table:
 * `'todo/write': { todos: TodoItem[] }`), but that package is not a dependency
 * of this repo, so the merge is invisible to our type-check. We re-declare it
 * here with the exact wire shape so `case 'todo/write'` narrows properly
 * (same pattern as dsh-subagent's catalog.d.ts merging into the same outlet).
 *
 * Honest shape, per the typert table: `content` + `status` only — **no `turn`
 * field and no protocol id**. Turn attribution is derived from the ambient
 * turn counter (turn/start / user/message) in infer.ts, never from this
 * payload. If a future dsh-tool-todo ships its own types, drop this file and
 * depend on theirs.
 * Verified against dsh 0.2.1-rc.3 (todo/tool-todo src/types.ts): shapes unchanged (0033 knife-one).
 */
// 顶层 `export {}` 让本文件成为模块文件 —— 这是 `declare module` 被当作
// module augmentation（合并进已解析的真实模块）而非独立环境模块声明的
// 必要条件。少了它，本文件是全局脚本，declare module 会造出一个同名但
// 身份独立的模块，root 包的 re-export 看不到合并结果（踩过）。
export {}

declare module '@deepseek-ai/dsh-session/types' {
  interface TodoItem {
    content: string
    status: 'pending' | 'in_progress' | 'completed'
  }

  interface SessionEventMap {
    'todo/write': { todos: TodoItem[] }
  }
}
