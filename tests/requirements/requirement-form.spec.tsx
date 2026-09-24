// @vitest-environment jsdom
/**
 * Requirement form: local title-required validation, the save handoff to
 * the controller, and the retry path on failure (the flat flow — no
 * validation/gate machinery to cover).
 */
import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { RequirementRecord } from '../../src/requirements-shared/protocol.js'
import type { RequirementsController } from '../../src/client/requirements/controller.js'
import type { RequirementsT } from '../../src/client/requirements/dictionary.js'
import { RequirementForm } from '../../src/client/requirements/requirement-form.js'

const DICT = {
  zh: {
    'form.titleCreate': '新增需求',
    'form.titleEdit': '编辑需求',
    'form.title': '标题',
    'form.titlePlaceholder': '例如：支持多仓库并行检索',
    'form.description': '描述',
    'form.descriptionPlaceholder': '选填，一段简短说明',
    'form.cancel': '取消',
    'form.submit': '保存',
    'form.submitting': '保存中…',
    'form.closeLabel': '关闭',
    'error.titleRequired': '请输入需求标题',
  },
} as const

const bindZh = (): RequirementsT => (key) => (DICT.zh as Record<string, string>)[key] ?? key

const record = (): RequirementRecord => ({
  id: '11111111-1111-4111-8111-111111111111',
  title: '既有需求',
  description: '既有说明',
  createdAt: '2026-09-25T09:30:00.000Z',
  updatedAt: '2026-09-25T09:30:00.000Z',
})

function fakeController(): RequirementsController {
  return {
    refresh: vi.fn(async () => undefined),
    save: vi.fn(async () => true),
    remove: vi.fn(async () => undefined),
    openCreate: vi.fn(),
    openEdit: vi.fn(),
    closeForm: vi.fn(),
    dismissBanner: vi.fn(),
    dispose: vi.fn(),
  } as unknown as RequirementsController
}

describe('RequirementForm', () => {
  it('validates locally before anything else (empty title never calls save)', async () => {
    const controller = fakeController()
    const { unmount } = render(
      <RequirementForm t={bindZh()} editing={{ kind: 'create' }} revision={0} controller={controller} />,
    )
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(screen.getByText('请输入需求标题')).toBeTruthy())
    expect(controller.save).not.toHaveBeenCalled()
    unmount()
  })

  it('hands the trimmed body to controller.save on success', async () => {
    const controller = fakeController()
    const { unmount } = render(
      <RequirementForm t={bindZh()} editing={{ kind: 'create' }} revision={3} controller={controller} />,
    )
    fireEvent.change(screen.getByPlaceholderText('例如：支持多仓库并行检索'), { target: { value: '  支持多仓库并行检索  ' } })
    fireEvent.change(screen.getByPlaceholderText('选填，一段简短说明'), { target: { value: '  说明  ' } })
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(controller.save).toHaveBeenCalledTimes(1))
    expect(controller.save).toHaveBeenCalledWith({
      expectedRevision: 3,
      requirement: { title: '支持多仓库并行检索', description: '说明' },
    })
    unmount()
  })

  it('carries the edit id and stays mounted for retry on failure', async () => {
    const controller = fakeController()
    ;(controller.save as ReturnType<typeof vi.fn>).mockResolvedValue(false)
    const existing = record()
    const { unmount } = render(
      <RequirementForm t={bindZh()} editing={{ kind: 'edit', requirement: existing }} revision={1} controller={controller} />,
    )
    expect(screen.getByText('编辑需求')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(controller.save).toHaveBeenCalledTimes(1))
    expect(controller.save).toHaveBeenCalledWith({
      expectedRevision: 1,
      requirement: { id: existing.id, title: '既有需求', description: '既有说明' },
    })
    // Failure: the form stays open (no closeForm) and the submit resets for retry.
    expect(controller.closeForm).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: '保存' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: '保存' }))
    await waitFor(() => expect(controller.save).toHaveBeenCalledTimes(2))
    unmount()
  })
})
