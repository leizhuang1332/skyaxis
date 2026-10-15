// @vitest-environment jsdom
/**
 * 0008: S1 requirement-baseline-doc face as a file row + click-to-preview
 * modal (the report-section twin — assertions stay at the call/dialog layer,
 * MarkdownText is not asserted). Five states mirrored from the report face:
 * ready (card + own modal fetch), tampered (warning inside the modal,
 * understandBaseline.docHash compare), missing/error (honest hints + retry),
 * no workspace (zero fetches).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { requirementDocRelPath } from '../../src/workbench-shared/protocol.js'
import type { WorkbenchController } from '../../src/client/workbench/controller.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import { RequirementDocSection } from '../../src/client/workbench/requirement-doc-section.js'

const RID = '11111111-1111-4111-8111-111111111111'
const WS = 'C:\\ws\\需求'

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

/** Partial controller — the section consumes requirementDocContent only. */
function fakeController(impl: () => Promise<unknown>): WorkbenchController & { requirementDocContent: ReturnType<typeof vi.fn> } {
  return {
    requirementDocContent: vi.fn(impl),
  } as never
}

afterEach(() => {
  cleanup()
})

describe('0008 S1 需求基线文档卡片（report 卡片先例）', () => {
  it('ready ⇒ 卡片（显示名 requirements/<前8>.md + 全路径披露）无弹窗；点击开预览，弹窗自跑一次独立 fetch', async () => {
    const controller = fakeController(async () => ({ kind: 'ok', content: '# 需求基线 · 报价管理', contentTampered: false }))
    render(<RequirementDocSection t={bindZh()} controller={controller} requirementId={RID} workspacePath={WS} />)

    await waitFor(() => expect(controller.requirementDocContent).toHaveBeenCalledTimes(1))
    const card = screen.getByRole('button', { name: new RegExp(workbenchZh['baseline.preview']) })
    expect(within(card).getByText('requirements/11111111.md')).toBeTruthy()
    expect(within(card).getByText(`${workbenchZh['baseline.pathPrefix']}C:/ws/需求/${requirementDocRelPath(RID)}`)).toBeTruthy()

    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(card)
    const dialog = await screen.findByRole('dialog', { name: workbenchZh['baseline.title'] })
    expect(dialog).toBeTruthy()
    await waitFor(() => expect(controller.requirementDocContent).toHaveBeenCalledTimes(2))
    expect(controller.requirementDocContent).toHaveBeenLastCalledWith(RID, expect.anything())
  })

  it('tampered ⇒ 警示行在弹窗内（warn，不阻断正文渲染路径——对照 understandBaseline.docHash）', async () => {
    const controller = fakeController(async () => ({ kind: 'ok', content: '# 被外部改过的基线', contentTampered: true }))
    render(<RequirementDocSection t={bindZh()} controller={controller} requirementId={RID} workspacePath={WS} />)
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(workbenchZh['baseline.preview']) }))
    const dialog = await screen.findByRole('dialog', { name: workbenchZh['baseline.title'] })
    expect(within(dialog).getByText(workbenchZh['baseline.tampered'])).toBeTruthy()
  })

  it('missing（404）⇒ 诚实提示（未生成）+ [刷新] 重试再触发；无假卡片', async () => {
    const controller = fakeController(async () => ({ kind: 'http-error', status: 404 }))
    render(<RequirementDocSection t={bindZh()} controller={controller} requirementId={RID} workspacePath={WS} />)

    await waitFor(() => expect(screen.getByText(workbenchZh['baseline.missing'])).toBeTruthy())
    expect(screen.queryByRole('button', { name: new RegExp(workbenchZh['baseline.preview']) })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['baseline.refresh'] }))
    await waitFor(() => expect(controller.requirementDocContent).toHaveBeenCalledTimes(2))
  })

  it('error（undefined）⇒ 错误行 + [刷新] 重试', async () => {
    const controller = fakeController(async () => undefined)
    render(<RequirementDocSection t={bindZh()} controller={controller} requirementId={RID} workspacePath={WS} />)

    await waitFor(() => expect(screen.getByText(workbenchZh['baseline.loadError'])).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['baseline.refresh'] }))
    await waitFor(() => expect(controller.requirementDocContent).toHaveBeenCalledTimes(2))
  })

  it('无工作区 ⇒ 无文件提示，零 fetch，无卡片', async () => {
    const controller = fakeController(async () => ({ kind: 'ok', content: '#', contentTampered: false }))
    render(<RequirementDocSection t={bindZh()} controller={controller} requirementId={RID} workspacePath="" />)

    expect(screen.getByText(workbenchZh['baseline.noWorkspace'])).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(controller.requirementDocContent).not.toHaveBeenCalled()
  })
})
