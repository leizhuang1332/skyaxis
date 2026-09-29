// @vitest-environment jsdom
/**
 * 知识条目表单 Modal（手动建条/编辑共用，P2 S6）：新建与编辑双标题、
 * editing 全字段播种（含 keyword value）、title 空校验（fieldError + 不
 * 调 onSubmit）、payload 形状双向钉死——requirement 作用域带 requirementId
 * 且无 id（新建），global 作用域无 requirementId（组件拥有 join，调用方
 * 不传），编辑带 id；keyword 触发的 value 进 payload。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { WorkbenchKnowledgeRecord } from '../../src/workbench-shared/protocol.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import { KnowledgeFormModal } from '../../src/client/workbench/knowledge-form-modal.js'

const RID = '11111111-1111-4111-8111-111111111111'
const AT = '2026-09-29T08:00:00.000Z'

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

function row(overrides: Partial<WorkbenchKnowledgeRecord> = {}): WorkbenchKnowledgeRecord {
  return {
    id: 'k1',
    scope: 'global',
    type: 'convention',
    title: '全局条目',
    content: '全局内容',
    trigger: { mode: 'keyword', value: '导出' },
    status: 'active',
    provenance: { at: AT },
    ...overrides,
  }
}

// vitest 未开 globals，RTL 的自动 cleanup 不生效（0003 P2 同款坑）。
afterEach(() => {
  cleanup()
})

function subject(editing: WorkbenchKnowledgeRecord | null, onSubmit: (knowledge: unknown) => void = () => {}) {
  render(<KnowledgeFormModal t={bindZh()} open editing={editing} requirementId={RID} busy={false} onCancel={() => {}} onSubmit={onSubmit as never} />)
}

function dialogOf(name: string): HTMLElement {
  return screen.getByRole('dialog', { name })
}

describe('KnowledgeFormModal（新建/编辑知识条目）', () => {
  it('双标题：editing null → formTitleNew；editing 非 null → formTitleEdit', () => {
    subject(null)
    expect(dialogOf(workbenchZh['knowledge.formTitleNew'])).toBeTruthy()

    cleanup()
    subject(row())
    expect(dialogOf(workbenchZh['knowledge.formTitleEdit'])).toBeTruthy()
  })

  it('播种：editing 全字段进表单——title/content 值、scope/type/trigger radio 勾选、keyword value', () => {
    subject(row())
    const dialog = dialogOf(workbenchZh['knowledge.formTitleEdit'])

    expect((within(dialog).getByLabelText(workbenchZh['knowledge.titleLabel']) as HTMLInputElement).value).toBe('全局条目')
    expect((within(dialog).getByLabelText(workbenchZh['knowledge.contentLabel']) as HTMLTextAreaElement).value).toBe('全局内容')
    expect((within(dialog).getByLabelText(workbenchZh['knowledge.scopeGlobal']) as HTMLInputElement).checked).toBe(true)
    expect((within(dialog).getByLabelText(workbenchZh['knowledge.typeConvention']) as HTMLInputElement).checked).toBe(true)
    expect((within(dialog).getByLabelText(workbenchZh['knowledge.triggerKeyword']) as HTMLInputElement).checked).toBe(true)
    expect((within(dialog).getByLabelText(workbenchZh['knowledge.keywordLabel']) as HTMLInputElement).value).toBe('导出')
  })

  it('title 空校验：仅空白时提交被拦——fieldError 在场、onSubmit 未被调用；修正后可提交', () => {
    const onSubmit = vi.fn()
    subject(null)
    const dialog = dialogOf(workbenchZh['knowledge.formTitleNew'])
    const submit = () => within(dialog).getByRole('button', { name: workbenchZh['action.save'] })

    fireEvent.click(submit())
    // '标题' 同名两处：字段 label + fieldError 文案（错误即字段名，criteria 同款）。
    expect(within(dialog).getAllByText(workbenchZh['knowledge.titleLabel'])).toHaveLength(2)
    expect(onSubmit).not.toHaveBeenCalled()

    fireEvent.change(within(dialog).getByLabelText(workbenchZh['knowledge.titleLabel']), { target: { value: '补上标题' } })
    expect(within(dialog).getAllByText(workbenchZh['knowledge.titleLabel'])).toHaveLength(1)
  })

  it('payload 双向：requirement 作用域带 requirementId 且无 id（新建）；global 作用域无 requirementId', () => {
    const onSubmit = vi.fn()
    subject(null, onSubmit)
    let dialog = dialogOf(workbenchZh['knowledge.formTitleNew'])
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['knowledge.titleLabel']), { target: { value: '本需求条目' } })
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['knowledge.contentLabel']), { target: { value: '内容' } })
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['action.save'] }))
    expect(onSubmit).toHaveBeenCalledWith({
      scope: 'requirement',
      type: 'business',
      title: '本需求条目',
      content: '内容',
      requirementId: RID,
      trigger: { mode: 'always' },
    })

    cleanup()
    const onSubmitGlobal = vi.fn()
    subject(null, onSubmitGlobal)
    dialog = dialogOf(workbenchZh['knowledge.formTitleNew'])
    fireEvent.click(within(dialog).getByLabelText(workbenchZh['knowledge.scopeGlobal']))
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['knowledge.titleLabel']), { target: { value: '全局条目' } })
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['action.save'] }))
    expect(onSubmitGlobal).toHaveBeenCalledWith({
      scope: 'global',
      type: 'business',
      title: '全局条目',
      content: '',
      trigger: { mode: 'always' },
    })
  })

  it('编辑提交：payload 带 id 与播种的 keyword value（scope global 无 requirementId）', () => {
    const onSubmit = vi.fn()
    subject(row({ type: 'convention' }), onSubmit)
    const dialog = dialogOf(workbenchZh['knowledge.formTitleEdit'])

    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['action.save'] }))
    expect(onSubmit).toHaveBeenCalledWith({
      id: 'k1',
      scope: 'global',
      type: 'convention',
      title: '全局条目',
      content: '全局内容',
      trigger: { mode: 'keyword', value: '导出' },
    })
  })
})
