/**
 * sessionChipState 纯函数单元（P2b 四态矩阵：waiting > running > blank >
 * idle）。ex session-strip.spec——strip 面 2026-10-19 用户裁定退役，纯函数
 * 迁 session-chip.ts，矩阵随迁（原第四态两用例 + 基础三态合并为全矩阵四断言）。
 */
import { describe, expect, it } from 'vitest'
import { sessionChipState } from '../../src/client/workbench/session-chip.js'

describe('sessionChipState（四态推导）', () => {
  it('waiting 压过 running（approval 等待期间 running 仍 true——waterfall 是更精确事实）', () => {
    expect(sessionChipState(true, true, false)).toEqual({ dot: 'warning', labelKey: 'session.stateWaiting' })
    expect(sessionChipState(true, false, true)).toEqual({ dot: 'warning', labelKey: 'session.stateWaiting' })
  })

  it('running 次之（非 waiting 的运行中）', () => {
    expect(sessionChipState(false, true, false)).toEqual({ dot: 'ongoing', labelKey: 'session.stateRunning' })
    expect(sessionChipState(false, true, true)).toEqual({ dot: 'ongoing', labelKey: 'session.stateRunning' })
  })

  it('blank 再次（空壳会话——投递残留/未开始）', () => {
    expect(sessionChipState(false, false, true)).toEqual({ dot: 'idle', labelKey: 'session.stateBlank' })
  })

  it('全否 → done 点 + 空闲文案', () => {
    expect(sessionChipState(false, false, false)).toEqual({ dot: 'done', labelKey: 'session.stateIdle' })
  })
})
