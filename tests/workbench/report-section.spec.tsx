// @vitest-environment jsdom
/**
 * 换形轮: S1 report face as a file row + click-to-preview modal (the 工作区
 * PRD-doc precedent). Assertions stay at the call/dialog layer — MarkdownText's
 * rendering is not predictable under vitest (the prd-section.spec discipline).
 *  - ready ⇒ file card (display name + full-path disclosure), NO dialog until
 *    clicked; the modal runs its OWN fetch on open (row fetch ≠ body fetch).
 *  - tampered ⇒ the warning line rides INSIDE the modal (细化④ warn-only).
 *  - missing (404) / error ⇒ honest hints + [刷新] retry re-fires the fetch;
 *    no fake card before the file exists.
 *  - no workspace ⇒ the no-file hint, zero fetches, no card.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { analysisReportRelPath } from '../../src/workbench-shared/protocol.js'
import type { WorkbenchController } from '../../src/client/workbench/controller.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import { ReportSection } from '../../src/client/workbench/report-section.js'

const RID = '11111111-1111-4111-1111-111111111111'
const WS = 'C:\\ws\\需求'

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

/** Partial controller — the section consumes analysisReportContent only. */
function fakeController(impl: () => Promise<unknown>): WorkbenchController & { analysisReportContent: ReturnType<typeof vi.fn> } {
  return {
    analysisReportContent: vi.fn(impl),
  } as never
}

afterEach(() => {
  cleanup()
})

describe('换形轮 S1 报告文件卡片（PRD 预览先例）', () => {
  it('ready ⇒ 卡片（显示名 + 全路径披露）无弹窗；点击开预览，弹窗自跑一次独立 fetch', async () => {
    const controller = fakeController(async () => ({ kind: 'ok', content: '# 报告正文', contentTampered: false }))
    render(<ReportSection t={bindZh()} controller={controller} requirementId={RID} workspacePath={WS} />)

    // Existence fetch lands; the card shows the readable name and full path.
    await waitFor(() => expect(controller.analysisReportContent).toHaveBeenCalledTimes(1))
    const card = screen.getByRole('button', { name: new RegExp(workbenchZh['report.preview']) })
    expect(within(card).getByText('analysis/11111111.md')).toBeTruthy()
    expect(within(card).getByText(`${workbenchZh['report.pathPrefix']}C:/ws/需求/${analysisReportRelPath(RID)}`)).toBeTruthy()

    // No dialog before the click — the body never renders inline.
    expect(screen.queryByRole('dialog')).toBeNull()
    fireEvent.click(card)
    const dialog = await screen.findByRole('dialog', { name: workbenchZh['report.title'] })
    expect(dialog).toBeTruthy()
    // The modal's fetch is its own (row existence + modal body = two calls).
    await waitFor(() => expect(controller.analysisReportContent).toHaveBeenCalledTimes(2))
    expect(controller.analysisReportContent).toHaveBeenLastCalledWith(RID, expect.anything())
  })

  it('tampered ⇒ 警示行在弹窗内（warn，不阻断正文渲染路径）', async () => {
    const controller = fakeController(async () => ({ kind: 'ok', content: '# 被改过的报告', contentTampered: true }))
    render(<ReportSection t={bindZh()} controller={controller} requirementId={RID} workspacePath={WS} />)
    fireEvent.click(await screen.findByRole('button', { name: new RegExp(workbenchZh['report.preview']) }))
    const dialog = await screen.findByRole('dialog', { name: workbenchZh['report.title'] })
    expect(within(dialog).getByText(workbenchZh['report.tampered'])).toBeTruthy()
  })

  it('missing（404）⇒ 诚实提示 + [刷新] 重试再触发；无假卡片', async () => {
    const controller = fakeController(async () => ({ kind: 'http-error', status: 404 }))
    render(<ReportSection t={bindZh()} controller={controller} requirementId={RID} workspacePath={WS} />)

    await waitFor(() => expect(screen.getByText(workbenchZh['report.missing'])).toBeTruthy())
    expect(screen.queryByRole('button', { name: new RegExp(workbenchZh['report.preview']) })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['report.refresh'] }))
    await waitFor(() => expect(controller.analysisReportContent).toHaveBeenCalledTimes(2))
  })

  it('error（undefined）⇒ 错误行 + [刷新] 重试', async () => {
    const controller = fakeController(async () => undefined)
    render(<ReportSection t={bindZh()} controller={controller} requirementId={RID} workspacePath={WS} />)

    await waitFor(() => expect(screen.getByText(workbenchZh['report.loadError'])).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['report.refresh'] }))
    await waitFor(() => expect(controller.analysisReportContent).toHaveBeenCalledTimes(2))
  })

  it('无工作区 ⇒ 无文件提示，零 fetch，无卡片', async () => {
    const controller = fakeController(async () => ({ kind: 'ok', content: '#', contentTampered: false }))
    render(<ReportSection t={bindZh()} controller={controller} requirementId={RID} workspacePath="" />)

    expect(screen.getByText(workbenchZh['report.noWorkspace'])).toBeTruthy()
    expect(screen.queryByRole('button')).toBeNull()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(controller.analysisReportContent).not.toHaveBeenCalled()
  })
})
