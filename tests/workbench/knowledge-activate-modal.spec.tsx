// @vitest-environment jsdom
/**
 * 激活 Modal（P2 S6）：radio 默认值（类型预选候选、作用域默认仅本需求、
 * 触发默认 always）、keyword 选中浮现必填输入且为空禁用提交、两档作用域
 * （workspace 档不存在——P2 裁决的负向钉子）、payload 归一化（keyword 带
 * trim 后的 value、always/manual 无 value 键）、busy 禁用提交。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import type { KnowledgeCandidate } from '../../src/workbench-shared/protocol.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import { KnowledgeActivateModal } from '../../src/client/workbench/knowledge-activate-modal.js'

const AT = '2026-09-29T08:00:00.000Z'

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

function candidate(overrides: Partial<KnowledgeCandidate> = {}): KnowledgeCandidate {
  return { id: 'c1', title: '候选-c1', draft: '草案', type: 'business', at: AT, status: 'pending', ...overrides }
}

// vitest 未开 globals，RTL 的自动 cleanup 不生效（0003 P2 同款坑）。
afterEach(() => {
  cleanup()
})

function subject(c: KnowledgeCandidate | null, onSubmit: (knowledge: unknown) => void = () => {}, busy = false) {
  render(<KnowledgeActivateModal t={bindZh()} open candidate={c} busy={busy} onCancel={() => {}} onSubmit={onSubmit as never} />)
  return screen.getByRole('dialog', { name: workbenchZh['knowledge.activateTitle'] })
}

describe('KnowledgeActivateModal（激活知识条目）', () => {
  it('radio 默认值：类型预选候选 type；作用域默认仅本需求；触发默认 always', () => {
    const dialog = subject(candidate({ type: 'convention' }))

    expect((within(dialog).getByLabelText(workbenchZh['knowledge.typeConvention']) as HTMLInputElement).checked).toBe(true)
    expect((within(dialog).getByLabelText(workbenchZh['knowledge.typeBusiness']) as HTMLInputElement).checked).toBe(false)
    expect((within(dialog).getByLabelText(workbenchZh['knowledge.scopeRequirement']) as HTMLInputElement).checked).toBe(true)
    expect((within(dialog).getByLabelText(workbenchZh['knowledge.triggerAlways']) as HTMLInputElement).checked).toBe(true)
    // keyword 未选 ⇒ 关键词输入不浮现。
    expect(within(dialog).queryByLabelText(workbenchZh['knowledge.keywordLabel'])).toBeNull()
  })

  it('两档作用域：global/requirement 在场，workspace 档不存在（P2 裁决）', () => {
    const dialog = subject(candidate())

    expect(within(dialog).getByLabelText(workbenchZh['knowledge.scopeGlobal'])).toBeTruthy()
    expect(within(dialog).getByLabelText(workbenchZh['knowledge.scopeRequirement'])).toBeTruthy()
    expect(within(dialog).queryByText(/workspace/i)).toBeNull()
  })

  it('keyword 选中浮现必填输入；为空时提交禁用，填入后解禁', () => {
    const dialog = subject(candidate())
    const submit = () => within(dialog).getByRole('button', { name: workbenchZh['knowledge.activate'] }) as HTMLButtonElement

    fireEvent.click(within(dialog).getByLabelText(workbenchZh['knowledge.triggerKeyword']))
    expect(within(dialog).getByLabelText(workbenchZh['knowledge.keywordLabel'])).toBeTruthy()
    expect(submit().disabled).toBe(true)

    fireEvent.change(within(dialog).getByLabelText(workbenchZh['knowledge.keywordLabel']), { target: { value: 'x' } })
    expect(submit().disabled).toBe(false)
  })

  it('payload 归一化：keyword 提交带 trim 后 value；切回 always 后 value 键消失', () => {
    const onSubmit = vi.fn()
    const dialog = subject(candidate(), onSubmit)
    const submit = () => within(dialog).getByRole('button', { name: workbenchZh['knowledge.activate'] })

    fireEvent.click(within(dialog).getByLabelText(workbenchZh['knowledge.triggerKeyword']))
    fireEvent.change(within(dialog).getByLabelText(workbenchZh['knowledge.keywordLabel']), { target: { value: '  导出  ' } })
    fireEvent.click(submit())
    expect(onSubmit).toHaveBeenCalledWith({ scope: 'requirement', type: 'business', trigger: { mode: 'keyword', value: '导出' } })

    onSubmit.mockClear()
    fireEvent.click(within(dialog).getByLabelText(workbenchZh['knowledge.triggerAlways']))
    fireEvent.click(submit())
    expect(onSubmit).toHaveBeenCalledWith({ scope: 'requirement', type: 'business', trigger: { mode: 'always' } })
  })

  it('payload 作用域：切到 global 后提交带 scope global；manual 无 value 键', () => {
    const onSubmit = vi.fn()
    const dialog = subject(candidate(), onSubmit)
    const submit = () => within(dialog).getByRole('button', { name: workbenchZh['knowledge.activate'] })

    fireEvent.click(within(dialog).getByLabelText(workbenchZh['knowledge.scopeGlobal']))
    fireEvent.click(within(dialog).getByLabelText(workbenchZh['knowledge.triggerManual']))
    fireEvent.click(submit())
    expect(onSubmit).toHaveBeenCalledWith({ scope: 'global', type: 'business', trigger: { mode: 'manual' } })
  })

  it('busy 禁用提交；open=false 不渲染', () => {
    const dialog = subject(candidate(), () => {}, true)
    expect((within(dialog).getByRole('button', { name: workbenchZh['knowledge.activate'] }) as HTMLButtonElement).disabled).toBe(true)

    cleanup()
    render(<KnowledgeActivateModal t={bindZh()} open={false} candidate={candidate()} busy={false} onCancel={() => {}} onSubmit={() => {}} />)
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
