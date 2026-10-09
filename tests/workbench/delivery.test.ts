/**
 * SOW 投递闭包单元（P5a）：结构面组装（services 缺席 ⇒ face 为 undefined，
 * 按钮不渲染的诚实降级前提）+ 官方四步序列（create{cwd} → scope → setDraft
 * → open + selectPanel 尽力而为）+ cwd 空串省略 + 失败收敛 {ok:false}。
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createSowDelivery } from '../../src/client/workbench/delivery.js'

const fakeCtx = (services: Record<string, unknown>): Context => {
  const ctx = {
    get: (name: string) => services[name],
    inject: (names: readonly string[], callback: (scope: unknown) => (() => void) | void) => {
      // Fake tracker: arm immediately when the service is present (the real
      // one fires when the providing fiber activates).
      if (names.every((name) => services[name] !== undefined)) callback({ ...services })
      return () => {}
    },
  } as unknown as Context
  return ctx
}

const sessions = (createImpl?: (opts?: { cwd?: string }) => Promise<string>) => ({
  create: createImpl ?? (async () => 'sess-new'),
  scope: (id: string) => ({ sessionId: id }),
  open: vi.fn(),
})

const conversation = (setDraft = vi.fn()) => ({ input: { for: (actx: unknown) => ({ setDraft: (text: string) => setDraft(text, actx) }) } })

describe('createSowDelivery', () => {
  it('sessions 缺席 / 形状不对 ⇒ undefined（诚实不建面）；conversation 缺席不再是建面条件（验收修复：register 时机 get 对未激活服务答 undefined——改为 inject 反应式布防 + 调用时解析）', async () => {
    expect(createSowDelivery(fakeCtx({}))).toBeUndefined()
    expect(createSowDelivery(fakeCtx({ sessions: {} }))).toBeUndefined()
    expect(createSowDelivery(fakeCtx({ sessions: { create: async () => 's' } }))).toBeUndefined()
    // conversation 未起：face 仍在（按钮渲染），调用时诚实答 no-service。
    const late = createSowDelivery(fakeCtx({ sessions: sessions() }))!
    expect(late).toBeDefined()
    await expect(late('t', 'C:/ws')).resolves.toEqual({ ok: false, reason: 'no-service' })
  })

  it('官方四步：create 带 cwd（空串省略）→ scope → setDraft → open + selectPanel 尽力而为', async () => {
    const create = vi.fn(async (opts?: { cwd?: string }) => (opts?.cwd === 'C:/ws/a' ? 'sess-1' : 'sess-default'))
    const s = sessions(create)
    const setDraft = vi.fn()
    const layout = { selectPanel: vi.fn() }
    const deliver = createSowDelivery(fakeCtx({ sessions: s, conversation: conversation(setDraft), layout }))!
    expect(deliver).toBeDefined()

    const ok = await deliver('任务书全文', 'C:/ws/a')
    expect(ok).toEqual({ ok: true, sessionId: 'sess-1' })
    expect(create).toHaveBeenCalledWith({ cwd: 'C:/ws/a' })
    expect(setDraft).toHaveBeenCalledWith('任务书全文', { sessionId: 'sess-1' })
    expect(s.open).toHaveBeenCalledWith('sess-1')
    expect(layout.selectPanel).toHaveBeenCalledWith(null)

    await deliver('x', '')
    expect(create).toHaveBeenLastCalledWith(undefined) // 空串 cwd ⇒ 省略 opts（host defaultCwd）
    await deliver('x', undefined)
    expect(create).toHaveBeenLastCalledWith(undefined)
  })

  it('selectPanel 抛错不阻塞投递；create/setDraft 抛错 ⇒ {ok:false, reason:"failed"}', async () => {
    const badLayout = { selectPanel: () => { throw new Error('shape mismatch') } }
    const deliver = createSowDelivery(fakeCtx({ sessions: sessions(), conversation: conversation(), layout: badLayout }))!
    expect((await deliver('t', 'C:/ws'))).toEqual({ ok: true, sessionId: 'sess-new' })

    const failing = createSowDelivery(fakeCtx({ sessions: sessions(async () => { throw new Error('gateway down') }), conversation: conversation() }))!
    expect(await failing('t', 'C:/ws')).toEqual({ ok: false, reason: 'failed' })
  })
})
