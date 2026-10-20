/**
 * SOW 投递闭包单元（0017 刀一 v3）：结构面组装（services 缺席 ⇒ face 为
 * undefined，按钮不渲染的诚实降级前提）+ v3 主路径（create{cwd} → binding →
 * prompt('queue')，不 open 不 setDraft 不跳转，sent:true）+ 降级尾巴（prompt
 * 拒/抛/面缺席 → setDraft+open+selectPanel，sent:false）+ no-service/failed
 * 收敛。刀零实机四查已过门（ok:true/accepted/created id 直接变实）。
 */
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { createSessionMessenger, createSowDelivery } from '../../src/client/workbench/delivery.js'

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

type PromptImpl = (content: { type: 'text'; text: string }[], mode: 'queue' | 'steer') => Promise<{ ok: boolean }>

const sessions = (opts?: {
  createImpl?: (opts?: { cwd?: string }) => Promise<string>
  promptImpl?: PromptImpl
  /** 供降级路径用——默认即真实形状（scope/open 在场）。 */
  noBinding?: boolean
}) => {
  const prompt = vi.fn(opts?.promptImpl ?? (async () => ({ ok: true })))
  const face = {
    create: opts?.createImpl ?? (async () => 'sess-new'),
    binding: opts?.noBinding === true ? () => undefined : () => ({ session: { prompt } }),
    scope: (id: string) => ({ sessionId: id }),
    open: vi.fn(),
  }
  return { face, prompt, open: face.open }
}

const conversation = (setDraft = vi.fn()) => ({ input: { for: (actx: unknown) => ({ setDraft: (text: string) => setDraft(text, actx) }) } })

describe('createSowDelivery', () => {
  it('sessions 缺席 / 形状不对（create/binding/scope/open 任一）⇒ undefined（诚实不建面）', () => {
    expect(createSowDelivery(fakeCtx({}))).toBeUndefined()
    expect(createSowDelivery(fakeCtx({ sessions: {} }))).toBeUndefined()
    expect(createSowDelivery(fakeCtx({ sessions: { create: async () => 's' } }))).toBeUndefined()
    expect(createSowDelivery(fakeCtx({ sessions: { create: async () => 's', binding: () => undefined } }))).toBeUndefined()
  })

  it('v3 主路径：create 带 cwd（空串省略）→ prompt([{type:"text"}],"queue")；不 setDraft / 不 open / 不 selectPanel；sent:true；conversation 缺席不挡主路径', async () => {
    const create = vi.fn(async (opts?: { cwd?: string }) => (opts?.cwd === 'C:/ws/a' ? 'sess-1' : 'sess-default'))
    const { face, prompt, open } = sessions({ createImpl: create })
    const setDraft = vi.fn()
    const layout = { selectPanel: vi.fn() }
    // conversation 故意缺席——主路径独立性（v2 曾以之为硬前置）。
    const deliver = createSowDelivery(fakeCtx({ sessions: face, layout }))!
    expect(deliver).toBeDefined()

    const ok = await deliver('任务书全文', 'C:/ws/a')
    expect(ok).toEqual({ ok: true, sessionId: 'sess-1', sent: true })
    expect(create).toHaveBeenCalledWith({ cwd: 'C:/ws/a' })
    expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: '任务书全文' }], 'queue')
    expect(open).not.toHaveBeenCalled()
    expect(setDraft).not.toHaveBeenCalled()
    expect(layout.selectPanel).not.toHaveBeenCalled()

    await deliver('x', '')
    expect(create).toHaveBeenLastCalledWith(undefined) // 空串 cwd ⇒ 省略 opts（host defaultCwd）
    await deliver('x', undefined)
    expect(create).toHaveBeenLastCalledWith(undefined)
  })

  it('降级尾巴（D3）：prompt 被拒 ⇒ setDraft+open+selectPanel，sent:false（任务不中断）', async () => {
    const { face, prompt, open } = sessions({ promptImpl: async () => ({ ok: false }) })
    const setDraft = vi.fn()
    const layout = { selectPanel: vi.fn() }
    const deliver = createSowDelivery(fakeCtx({ sessions: face, conversation: conversation(setDraft), layout }))!

    expect(await deliver('t', 'C:/ws')).toEqual({ ok: true, sessionId: 'sess-new', sent: false })
    expect(prompt).toHaveBeenCalledTimes(1)
    expect(setDraft).toHaveBeenCalledWith('t', { sessionId: 'sess-new' })
    expect(open).toHaveBeenCalledWith('sess-new')
    expect(layout.selectPanel).toHaveBeenCalledWith(null)
  })

  it('降级触发面：prompt 抛错 / binding 无 session 面 ⇒ 同一 v2 尾巴', async () => {
    const throwing = sessions({ promptImpl: async () => { throw new Error('rpc down') } })
    const deliverThrowing = createSowDelivery(fakeCtx({ sessions: throwing.face, conversation: conversation() }))!
    expect(await deliverThrowing('t', 'C:/ws')).toEqual({ ok: true, sessionId: 'sess-new', sent: false })

    const bare = sessions({ noBinding: true })
    const deliverBare = createSowDelivery(fakeCtx({ sessions: bare.face, conversation: conversation() }))!
    expect(await deliverBare('t', 'C:/ws')).toEqual({ ok: true, sessionId: 'sess-new', sent: false })
  })

  it('selectPanel 抛错不阻塞降级；create 抛错 ⇒ {ok:false,"failed"}', async () => {
    const badLayout = { selectPanel: () => { throw new Error('shape mismatch') } }
    const degraded = createSowDelivery(fakeCtx({ sessions: sessions({ promptImpl: async () => ({ ok: false }) }).face, conversation: conversation(), layout: badLayout }))!
    expect(await degraded('t', 'C:/ws')).toEqual({ ok: true, sessionId: 'sess-new', sent: false })

    const failing = createSowDelivery(fakeCtx({ sessions: sessions({ createImpl: async () => { throw new Error('gateway down') } }).face, conversation: conversation() }))!
    expect(await failing('t', 'C:/ws')).toEqual({ ok: false, reason: 'failed' })
  })

  it('no-service：prompt 面缺席且 conversation 缺席 ⇒ 诚实失败（复制兜底在场）', async () => {
    const bare = sessions({ noBinding: true })
    const deliver = createSowDelivery(fakeCtx({ sessions: bare.face }))!
    await expect(deliver('t', 'C:/ws')).resolves.toEqual({ ok: false, reason: 'no-service' })
  })

  it('刀一验收修正——工作区挂靠：路径命中已注册工作区（大小写/反斜杠/尾斜杠不敏感）⇒ create({workspaceId})，不注册不传 cwd', async () => {
    const create = vi.fn(async () => 'sess-ws')
    const { face, prompt } = sessions({ createImpl: create })
    const wsCreate = vi.fn()
    const workspaces = { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', path: 'c:\\WS\\Demo\\' }] }) }, create: wsCreate }
    const deliver = createSowDelivery(fakeCtx({ sessions: face, workspaces }))!

    const ok = await deliver('任务书', 'C:/ws/demo')
    expect(ok).toEqual({ ok: true, sessionId: 'sess-ws', sent: true })
    expect(create).toHaveBeenCalledWith({ workspaceId: 'ws-1' })
    expect(wsCreate).not.toHaveBeenCalled()
    expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: '任务书' }], 'queue')
  })

  it('刀一验收修正——未注册路径 ⇒ workspaces.create({path}) 先注册（create-or-resolve）再 create({workspaceId})', async () => {
    const create = vi.fn(async () => 'sess-ws2')
    const { face } = sessions({ createImpl: create })
    const workspaces = { list: { getSnapshot: () => ({ items: [{ workspaceId: 'ws-1', path: 'C:/other' }] }) }, create: vi.fn(async () => ({ workspaceId: 'ws-reg', path: 'C:/ws/new' })) }
    const deliver = createSowDelivery(fakeCtx({ sessions: face, workspaces }))!

    await deliver('t', 'C:\\ws\\new')
    expect(workspaces.create).toHaveBeenCalledWith({ path: 'C:\\ws\\new' })
    expect(create).toHaveBeenCalledWith({ workspaceId: 'ws-reg' })
  })

  it('刀一验收修正——workspaces 面缺席 / 注册抛错 / 注册拒 ⇒ 诚实降级 create({cwd})（会话可用但侧栏不可见，不劣于修正前）', async () => {
    const createAbsent = vi.fn(async () => 's1')
    const d1 = createSowDelivery(fakeCtx({ sessions: sessions({ createImpl: createAbsent }).face }))!
    await d1('t', 'C:/ws/a')
    expect(createAbsent).toHaveBeenCalledWith({ cwd: 'C:/ws/a' })

    const createThrow = vi.fn(async () => 's2')
    const throwing = { list: { getSnapshot: () => ({ items: [] }) }, create: async () => { throw new Error('invalid path') } }
    const d2 = createSowDelivery(fakeCtx({ sessions: sessions({ createImpl: createThrow }).face, workspaces: throwing }))!
    await d2('t', 'C:/ws/b')
    expect(createThrow).toHaveBeenCalledWith({ cwd: 'C:/ws/b' })

    const createUndefined = vi.fn(async () => 's3')
    const odd = { list: { getSnapshot: () => ({ items: [] }) } } // 无 create 面
    const d3 = createSowDelivery(fakeCtx({ sessions: sessions({ createImpl: createUndefined }).face, workspaces: odd }))!
    await d3('t', 'C:/ws/c')
    expect(createUndefined).toHaveBeenCalledWith({ cwd: 'C:/ws/c' })
  })
})

describe('createSessionMessenger（0019 返工话信使）', () => {
  it('sessions 缺席 / 形状不对 ⇒ undefined（诚实不建面——返工话 Modal 隐藏发送钮，复制兜底）', () => {
    expect(createSessionMessenger(fakeCtx({}))).toBeUndefined()
    expect(createSessionMessenger(fakeCtx({ sessions: { binding: () => undefined } }))).toBeUndefined()
  })

  it('主路径：零 create——prompt([{type:"text"}],"queue") 打进指定会话；sent:true；conversation 缺席不挡主路径', async () => {
    const create = vi.fn(async () => 'never-minted')
    const { face, prompt, open } = sessions({ createImpl: create })
    const setDraft = vi.fn()
    const layout = { selectPanel: vi.fn() }
    // conversation 故意缺席——主路径独立性。
    const send = createSessionMessenger(fakeCtx({ sessions: face, layout }))!
    expect(send).toBeDefined()

    expect(await send('sess-dev-9', '返工话全文')).toEqual({ ok: true, sessionId: 'sess-dev-9', sent: true })
    expect(create).not.toHaveBeenCalled()
    expect(prompt).toHaveBeenCalledWith([{ type: 'text', text: '返工话全文' }], 'queue')
    expect(open).not.toHaveBeenCalled()
    expect(setDraft).not.toHaveBeenCalled()
    expect(layout.selectPanel).not.toHaveBeenCalled()
  })

  it('降级尾巴：prompt 被拒 ⇒ setDraft+open+selectPanel 打到同一 id（scope 透传），sent:false（返工话不中断）', async () => {
    const { face, open } = sessions({ promptImpl: async () => ({ ok: false }) })
    const setDraft = vi.fn()
    const layout = { selectPanel: vi.fn() }
    const send = createSessionMessenger(fakeCtx({ sessions: face, conversation: conversation(setDraft), layout }))!

    expect(await send('sess-dev-9', 't')).toEqual({ ok: true, sessionId: 'sess-dev-9', sent: false })
    expect(setDraft).toHaveBeenCalledWith('t', { sessionId: 'sess-dev-9' })
    expect(open).toHaveBeenCalledWith('sess-dev-9')
    expect(layout.selectPanel).toHaveBeenCalledWith(null)
  })

  it('降级触发面：prompt 抛错 / binding 无 session 面 ⇒ 同一 v2 尾巴', async () => {
    const throwing = sessions({ promptImpl: async () => { throw new Error('rpc down') } })
    const sendThrowing = createSessionMessenger(fakeCtx({ sessions: throwing.face, conversation: conversation() }))!
    expect(await sendThrowing('s1', 't')).toEqual({ ok: true, sessionId: 's1', sent: false })

    const bare = sessions({ noBinding: true })
    const sendBare = createSessionMessenger(fakeCtx({ sessions: bare.face, conversation: conversation() }))!
    expect(await sendBare('s2', 't')).toEqual({ ok: true, sessionId: 's2', sent: false })
  })

  it('no-service：prompt 面缺席且 conversation 缺席 ⇒ 诚实失败（Modal 的复制兜底在场）', async () => {
    const bare = sessions({ noBinding: true })
    const send = createSessionMessenger(fakeCtx({ sessions: bare.face }))!
    await expect(send('s', 't')).resolves.toEqual({ ok: false, reason: 'no-service' })
  })
})
