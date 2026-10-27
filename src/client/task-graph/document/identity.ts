/**
 * 任务全局身份（ADR 0036 §2.3 拍板：精确 content 锚，不搞模糊匹配）。
 *
 * key 方案：`hash`（content 的 FNV-1a base36）/ `hash#N`（同一次 write 内
 * 第 N+1 次出现同 content，N≥1）。同 content 跨 turn / 跨 write 复用同一
 * key——todo/write 是整会话单一列表的 whole-list 替换（非每 turn 独立
 * 列表），续写时 content 字符串不变、只有 status 变，精确锚即可合并；
 * 改措辞 = 新 key 是诚实行为。
 *
 * hashContent 从退役的 infer.ts 原样移植（P0 起点）：不引入加密库，todo
 * 级别碰撞概率可忽略，碰撞后果只是两个任务共用一个节点（可接受的退化）。
 */

/** content 字符串 → 稳定哈希片段（FNV-1a 32 位，输出 base36）。 */
export function hashContent(content: string): string {
  let h = 0x811c9dc5 // FNV offset basis
  for (let i = 0; i < content.length; i += 1) {
    h ^= content.charCodeAt(i)
    h = Math.imul(h, 0x01000193) // FNV prime
  }
  return (h >>> 0).toString(36) // 归一为无符号 32 位 + base36
}

/**
 * 一次 todo/write 内逐条目的 key 派生（有状态：计数本 write 内同 content
 * 的出现次数）。与退役 infer.ts 的 `hash#N-1` 偏移方案相比改为直白的
 * `hash#N`（N 从 1 起）——跨 write 同位对齐（第 N 次出现对第 N 次）不变。
 */
export class WriteKeyAssigner {
  private readonly seen = new Map<string, number>()

  /** 返回该 content 本次出现对应的全局 key；同一 write 内重复出现得到 `#N` 后缀。 */
  keyFor(content: string): string {
    const hash = hashContent(content)
    const occurrence = this.seen.get(hash) ?? 0
    this.seen.set(hash, occurrence + 1)
    return occurrence === 0 ? hash : `${hash}#${occurrence}`
  }
}

/** task 节点 id = `todo-{key}`（无 turn 段——v0.3 时代 `todo-{turn}-{key}` 退役）。 */
export const taskNodeId = (key: string): string => `todo-${key}`
