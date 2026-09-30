// @vitest-environment jsdom
/**
 * P2 session picker（关联 session 弹窗）客户端组件测试：行渲染与 running
 * 点（ongoing/idle）、已绑本工作包的行 radio 禁用、选行+选用途→关联按钮
 * 落 onBind(sessionId, purpose) 且弹窗不自行关闭（父层决定）、无选中/busy
 * 时关联禁用、默认用途 dev、空列表 pickerEmpty、取消关闭。
 *
 * Modal portal 到 body，RTL 在 vitest 下无自动 cleanup，afterEach 显式
 * 清理（board-section.spec 同款坑位注释）。全部断言走真词典 workbenchZh。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import { SessionPicker } from '../../src/client/workbench/session-picker.js'

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

function pickerRow(id: string, running = false, blank = false, waiting = false): { id: string; displayTitle: string; running: boolean; blank: boolean; waiting: boolean } {
  return { id, displayTitle: `会话-${id}`, running, blank, waiting }
}

function subject(overrides: Partial<Parameters<typeof SessionPicker>[0]> = {}): {
  onClose: ReturnType<typeof vi.fn>
  onBind: ReturnType<typeof vi.fn>
} {
  const onClose = vi.fn()
  const onBind = vi.fn()
  render(
    <SessionPicker
      t={bindZh()}
      open
      rows={[pickerRow('s1', true), pickerRow('s2'), pickerRow('s3')]}
      boundSessionIds={[]}
      busy={false}
      onClose={onClose}
      onBind={onBind}
      {...overrides}
    />,
  )
  return { onClose, onBind }
}

const dialog = (): HTMLElement => screen.getByRole('dialog', { name: workbenchZh['session.bindTitle'] })

// vitest 未开 globals，RTL 的自动 cleanup 不生效；Modal portal 进 body，
// 不显式清理会让后一个用例看见前一个用例残留的 dialog（0003 P2 同款坑）。
afterEach(() => {
  cleanup()
})

describe('SessionPicker（P2 关联 session 弹窗）', () => {
  it('行渲染：radio+running 点（ongoing/idle）+displayTitle；顶部 pickerHint 在场', () => {
    subject()

    const body = dialog()
    expect(within(body).getByText(workbenchZh['session.pickerHint'])).toBeTruthy()
    for (const id of ['s1', 's2', 's3']) {
      const radio = within(body).getByLabelText(`会话-${id}`) as HTMLInputElement
      expect(radio.type).toBe('radio')
      expect(radio.name).toBe('sessionId')
      const dot = (radio.parentElement as HTMLElement).querySelector('[data-state]')
      expect(dot?.getAttribute('data-state')).toBe(id === 's1' ? 'ongoing' : 'done')
    }
  })

  it('已绑本工作包的行：radio disabled（其余可选）', () => {
    subject({ boundSessionIds: ['s2'] })

    const body = dialog()
    expect((within(body).getByLabelText('会话-s1') as HTMLInputElement).disabled).toBe(false)
    expect((within(body).getByLabelText('会话-s2') as HTMLInputElement).disabled).toBe(true)
    expect((within(body).getByLabelText('会话-s3') as HTMLInputElement).disabled).toBe(false)
  })

  it('选行+改用途→关联：落 onBind(sessionId, purpose)；弹窗不自行关闭（父层决定）', () => {
    const { onBind } = subject()

    fireEvent.click(within(dialog()).getByLabelText('会话-s3'))
    fireEvent.click(within(dialog()).getByLabelText(workbenchZh['session.purposeAnalysis']))
    fireEvent.click(within(dialog()).getByRole('button', { name: workbenchZh['session.pickerSubmit'] }))
    expect(onBind).toHaveBeenCalledTimes(1)
    expect(onBind).toHaveBeenCalledWith('s3', 'analysis')
    expect(screen.getByRole('dialog', { name: workbenchZh['session.bindTitle'] })).toBeTruthy()
  })

  it('默认用途 dev（S3 语境）：只选行不改用途即落 dev', () => {
    const { onBind } = subject()

    const devRadio = within(dialog()).getByLabelText(workbenchZh['session.purposeDev']) as HTMLInputElement
    expect(devRadio.checked).toBe(true)

    fireEvent.click(within(dialog()).getByLabelText('会话-s1'))
    fireEvent.click(within(dialog()).getByRole('button', { name: workbenchZh['session.pickerSubmit'] }))
    expect(onBind).toHaveBeenCalledWith('s1', 'dev')
  })

  it('无选中禁用关联；busy 同样禁用（即使已有选中）', () => {
    const { onBind } = subject()
    const submit = (): HTMLButtonElement => within(dialog()).getByRole('button', { name: workbenchZh['session.pickerSubmit'] }) as HTMLButtonElement
    expect(submit().disabled).toBe(true)

    fireEvent.click(within(dialog()).getByLabelText('会话-s2'))
    expect(submit().disabled).toBe(false)
    fireEvent.click(submit())
    expect(onBind).toHaveBeenCalledTimes(1)
    cleanup()

    subject({ busy: true })
    fireEvent.click(within(dialog()).getByLabelText('会话-s2'))
    expect(submit().disabled).toBe(true)
    fireEvent.click(submit())
    expect(onBind).toHaveBeenCalledTimes(1)
  })

  it('空列表：pickerEmpty 单行提示，无行无用途组', () => {
    subject({ rows: [] })

    const body = dialog()
    expect(within(body).getByText(workbenchZh['session.pickerEmpty'])).toBeTruthy()
    expect(within(body).queryByLabelText('会话-s1')).toBeNull()
    expect(within(body).queryByText(workbenchZh['session.pickerPurposeLabel'])).toBeNull()
  })

  it('取消（footer ghost）与右上角关闭都走 onClose', () => {
    const { onClose } = subject()

    fireEvent.click(within(dialog()).getAllByRole('button', { name: workbenchZh['action.cancel'] })[0])
    expect(onClose).toHaveBeenCalledTimes(1)
    fireEvent.click(within(dialog()).getAllByRole('button', { name: workbenchZh['action.cancel'] })[1])
    expect(onClose).toHaveBeenCalledTimes(2)
  })
})
