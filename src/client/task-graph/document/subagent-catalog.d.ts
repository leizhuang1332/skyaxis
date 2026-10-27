/**
 * Hand-declared wire shape for the `subagent/catalog` session event
 * (v0.4 切片 B).
 *
 * Declared by `@deepseek-ai/dsh-subagent` in the DSH monorepo (merged into
 * the wire SessionEventMap there), but that package is not a dependency of
 * this repo (only in the pnpm store as a transitive stray), so the merge is
 * invisible to our type-check. Re-declared here with the exact wire shape —
 * same pattern as the todo-write.d.ts precedent.
 *
 * Honest shape (dsh-subagent 0.2.1-rc.3 lib/types/catalog.d.ts:20-42,
 * verified for research 0033 §六): versioned parent-owned direct-child
 * discovery fact (v0 local / v1 adds unknown / v2 external). 切片 B 的 fold
 * 只消费 `childId`（spawn fact 级解析的 catalog 交叉验证集）；mode/label 是
 * 血缘投影侧（subagents.ts 经 list 投影）的事，不在此重复消费。
 */
// 顶层 `export {}` 让本文件成为模块文件（同上，todo-write.d.ts 踩过的教训）。
export {}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'subagent/catalog': {
      childId: import('@deepseek-ai/dsh-session').SessionId
      childCreatedAt: number
      version: 0 | 1 | 2
      mode: 'one-shot' | 'continuable' | 'unknown' | 'external'
      label?: string
    }
  }
}
