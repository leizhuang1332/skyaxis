// @vitest-environment jsdom
/**
 * ScanModal（挂账轮 产物对账）：三面恒显带零值、按当前需求过滤（client 侧
 * join）、刷新重拉、失败态警示——只读披露零动作（fetcher 经 fake
 * controller 注入，reviewFetch 纯读先例）。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { WorkbenchScanResponseOk } from '../../src/workbench-shared/protocol.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import { ScanModal } from '../../src/client/workbench/scan-modal.js'
import type { WorkbenchController } from '../../src/client/workbench/controller.js'

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

const emptyScan = (): WorkbenchScanResponseOk => ({ ok: true, orphans: [], missing: [], trash: [] })

const RID = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'

type ScanOutcome = { kind: 'ok'; response: WorkbenchScanResponseOk } | { kind: 'network' }

function scanResponse(): WorkbenchScanResponseOk {
  return {
    ok: true,
    orphans: [
      { requirementId: RID, kind: 'plan', workPackageId: 'WP1', version: 2 },
      { requirementId: OTHER, kind: 'plan', workPackageId: 'WP1', version: 1 },
      { requirementId: RID, kind: 'unknown', name: 'stray.txt' },
    ],
    missing: [
      { requirementId: RID, kind: 'review', reviewId: '48b3597e-58b8-40e5-a62b-4a052a41b917' },
    ],
    trash: [
      { requirementId: RID, deletedAt: '2026-09-29T08:00:00.000Z' },
      { requirementId: OTHER, deletedAt: '2026-09-30T08:00:00.000Z' },
    ],
  }
}

function fakeController(scan: () => Promise<ScanOutcome>): WorkbenchController {
  return { scan } as unknown as WorkbenchController
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('ScanModal（挂账轮 产物对账）', () => {
  it('打开即拉取：三面计数恒显，且只渲染当前需求的行（client 侧 join）', async () => {
    const scan = vi.fn(async () => ({ kind: 'ok' as const, response: scanResponse() }))
    render(<ScanModal t={bindZh()} open requirementId={RID} controller={fakeController(scan)} onClose={() => {}} />)
    const dialog = await screen.findByRole('dialog')

    await waitFor(() => expect(within(dialog).getByText('WP1 · v2')).toBeTruthy())
    // RID 过滤：OTHER 的孤儿/墓碑行一律不出现。
    expect(within(dialog).queryByText('WP1 · v1')).toBeNull()
    expect(within(dialog).queryByText('2026-09-30T08:00:00.000Z')).toBeNull()
    // kind 标签 + 引用键 / 文件名 / reviewId / deletedAt 各就各位。
    expect(within(dialog).getByText(workbenchZh['scan.kindPlan'])).toBeTruthy()
    expect(within(dialog).getByText(workbenchZh['scan.kindUnknown'])).toBeTruthy()
    expect(within(dialog).getByText(workbenchZh['scan.kindReview'])).toBeTruthy()
    expect(within(dialog).getByText('stray.txt')).toBeTruthy()
    expect(within(dialog).getByText('48b3597e-58b8-40e5-a62b-4a052a41b917')).toBeTruthy()
    expect(within(dialog).getByText('2026-09-29T08:00:00.000Z')).toBeTruthy()
    // 三面节头计数：孤儿 2 / 缺失 1 / trash 1（过滤后口径）。
    expect(within(dialog).getByText(`${workbenchZh['scan.orphans']}（2）`)).toBeTruthy()
    expect(within(dialog).getByText(`${workbenchZh['scan.missing']}（1）`)).toBeTruthy()
    expect(within(dialog).getByText(`${workbenchZh['scan.trash']}（1）`)).toBeTruthy()
  })

  it('空响应：三面全零值仍恒显（对账读数非徽章，gonogo 恒显零值先例）', async () => {
    const scan = vi.fn(async () => ({ kind: 'ok' as const, response: emptyScan() }))
    render(<ScanModal t={bindZh()} open requirementId={RID} controller={fakeController(scan)} onClose={() => {}} />)
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getAllByText(workbenchZh['scan.empty'])).toHaveLength(3))
    expect(within(dialog).getAllByText(/（0）/)).toHaveLength(3)
  })

  it('刷新按钮重拉（nonce 重发请求）', async () => {
    const scan = vi.fn(async () => ({ kind: 'ok' as const, response: emptyScan() }))
    render(<ScanModal t={bindZh()} open requirementId={RID} controller={fakeController(scan)} onClose={() => {}} />)
    await screen.findByRole('dialog')
    await waitFor(() => expect(scan).toHaveBeenCalledTimes(1))
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['scan.refresh'] }))
    await waitFor(() => expect(scan).toHaveBeenCalledTimes(2))
  })

  it('失败态：警示行出现，刷新可恢复', async () => {
    let fail = true
    const scan = vi.fn(async () => (fail
      ? { kind: 'network' as const }
      : { kind: 'ok' as const, response: emptyScan() }))
    render(<ScanModal t={bindZh()} open requirementId={RID} controller={fakeController(scan)} onClose={() => {}} />)
    const dialog = await screen.findByRole('dialog')
    await waitFor(() => expect(within(dialog).getByText(workbenchZh['scan.failed'])).toBeTruthy())
    fail = false
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['scan.refresh'] }))
    await waitFor(() => expect(within(dialog).queryByText(workbenchZh['scan.failed'])).toBeNull())
  })
})
