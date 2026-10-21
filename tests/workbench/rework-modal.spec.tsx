// @vitest-environment jsdom
/**
 * 0019 返工话 Modal（client 组件测试）：组装透出（buildReworkMessage 种子
 * = 尾 fail 理由，头行带 WP 号与需求标题）+ 目标会话行（id 前 8 位 +
 * displayTitle + 跳会话）+ 用户编辑优先（0009 editedText 形制——发送用编辑
 * 后文本）+ 发送两态（成功含降级关闭 / 失败留置可重试）+ 信使缺席 ⇒ 发送钮
 * 隐藏（复制兜底在场）。Modal portal 到 body，afterEach 显式清理。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { WorkbenchWorkPackage } from '../../src/workbench-shared/protocol.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import { ReworkModal } from '../../src/client/workbench/rework-modal.js'

const AT = '2026-09-29T08:00:00.000Z'

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

function wp(overrides: Partial<WorkbenchWorkPackage> = {}): WorkbenchWorkPackage {
  return {
    id: 'WP3',
    title: '导出队列',
    boundary: '边界',
    order: 1,
    dependsOn: [],
    covers: [],
    status: 'in-dev',
    plans: [],
    sessions: [],
    commits: [],
    acceptances: [
      { at: AT, result: 'pass' },
      { at: AT, result: 'fail', note: '十万行导出超时' },
    ],
    ...overrides,
  }
}

const baseProps = {
  t: bindZh(),
  open: true,
  workPackage: wp(),
  requirementTitle: '导出功能改造',
  targetSessionId: 'sess-dev-12345678',
  targetDisplayTitle: '会话标题',
}

describe('ReworkModal', () => {
  afterEach(() => cleanup())

  // 0021 渲染轮: the preview defaults to RENDERED markdown — flip the toggle
  // FIRST (idempotent: only when the textarea is absent) and hand back the
  // editor (the sow-modal.spec ensureEditMode twin).
  const ensureEditMode = (): HTMLTextAreaElement => {
    if (screen.queryByTestId('rework-preview') === null) {
      fireEvent.click(screen.getByRole('button', { name: workbenchZh['md.edit'] }))
    }
    return screen.getByTestId('rework-preview') as HTMLTextAreaElement
  }

  it('组装透出：预览=buildReworkMessage 种子（头行/轮数/尾 fail 理由/重吐声明块指令）；目标会话行 id 前 8 位+标题', () => {
    const navigate = vi.fn()
    render(<ReworkModal {...baseProps} onNavigateSession={navigate} onClose={() => {}} />)
    const dialog = screen.getByRole('dialog', { name: workbenchZh['rework.title'] })
    const preview = ensureEditMode()
    expect(preview.value).toContain('# 返工话 WP3 · 导出功能改造')
    expect(preview.value).toContain('验收未通过（第 2 轮验收）')
    expect(preview.value).toContain('返工理由：\n十万行导出超时')
    expect(preview.value).toContain('workPackage: WP3')
    expect(within(dialog).getByText(/sess-dev/)).toBeTruthy()
    expect(within(dialog).getByText(/会话标题/)).toBeTruthy()
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['inbox.jumpToSession'] }))
    expect(navigate).toHaveBeenCalledWith('sess-dev-12345678')
  })

  it('编辑优先（0009 形制）：改预览后发送用编辑文本', async () => {
    const send = vi.fn(async () => ({ ok: true, sessionId: 's', sent: true }))
    render(<ReworkModal {...baseProps} send={send} onClose={() => {}} />)
    fireEvent.change(ensureEditMode(), { target: { value: '改过的返工话' } })
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['rework.send'] }))
    await waitFor(() => expect(send).toHaveBeenCalledWith('sess-dev-12345678', '改过的返工话'))
  })

  it('0021 渲染轮：预览默认渲染态（textarea 缺席、渲染容器在场）；切换往返编辑持久、重开重置渲染默认', async () => {
    const { rerender } = render(<ReworkModal {...baseProps} onClose={() => {}} />)
    // 默认渲染面（MarkdownText 在 vitest 下是代理桩——只钉容器/缺席）。
    expect(screen.getByTestId('rework-rendered')).toBeTruthy()
    expect(screen.queryByTestId('rework-preview')).toBeNull()
    expect(screen.getByRole('button', { name: workbenchZh['md.edit'] })).toBeTruthy()

    // 切到编辑：textarea 带种子文本；键入后切回渲染再切编辑——0009 编辑持久。
    const editor = ensureEditMode()
    expect(editor.value).toContain('# 返工话 WP3 · 导出功能改造')
    fireEvent.change(editor, { target: { value: '我的返工话版本' } })
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['md.preview'] }))
    expect(screen.queryByTestId('rework-preview')).toBeNull()
    expect(screen.getByTestId('rework-rendered')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['md.edit'] }))
    expect((screen.getByTestId('rework-preview') as HTMLTextAreaElement).value).toBe('我的返工话版本')

    // 关闭重开 ⇒ 渲染默认面 + 编辑复位（种子重建）。
    rerender(<ReworkModal {...baseProps} open={false} onClose={() => {}} />)
    rerender(<ReworkModal {...baseProps} open onClose={() => {}} />)
    expect(screen.getByTestId('rework-rendered')).toBeTruthy()
    expect(screen.queryByTestId('rework-preview')).toBeNull()
  })

  it('发送成功（含降级 sent:false）⇒ 关闭；失败 ⇒ 留置出 alert 且可重试', async () => {
    const onClose = vi.fn()
    const send = vi.fn(async () => ({ ok: true, sessionId: 's', sent: false }))
    const { unmount } = render(<ReworkModal {...baseProps} send={send} onClose={onClose} />)
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['rework.send'] }))
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1))
    unmount()
    cleanup()

    const onClose2 = vi.fn()
    let outcome: { ok: boolean; sessionId?: string; sent?: boolean; reason?: 'no-service' | 'failed' } = { ok: false, reason: 'no-service' }
    const sendFace = vi.fn(async () => outcome)
    render(<ReworkModal {...baseProps} send={sendFace} onClose={onClose2} />)
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['rework.send'] }))
    await waitFor(() => expect(screen.getByRole('alert').textContent).toContain(workbenchZh['rework.sendFailed']))
    expect(onClose2).not.toHaveBeenCalled()
    outcome = { ok: true, sessionId: 's', sent: true }
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['rework.send'] }))
    await waitFor(() => expect(onClose2).toHaveBeenCalledTimes(1))
  })

  it('信使缺席 ⇒ 发送钮隐藏（复制兜底在场）——诚实不建面', () => {
    render(<ReworkModal {...baseProps} onClose={() => {}} />)
    expect(screen.queryByRole('button', { name: workbenchZh['rework.send'] })).toBeNull()
    expect(screen.getByRole('button', { name: workbenchZh['wp.copyBody'] })).toBeTruthy()
  })
})
