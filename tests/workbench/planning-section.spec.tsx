// @vitest-environment jsdom
/**
 * 0012: S2 planning face — the 技术规划文档 card (WorkspaceDocSection instance)
 * plus the 采纳软门 chrome: [生成规划任务书] entry, [采纳规划] ack (doc-presence
 * probe disclosure + checkbox-gated confirm — the understand ack twin), the
 * adopted gonogo banner with [撤销采纳], and the upstream stale badge
 * (planBaseline.requirementDocHash vs the CURRENT understandBaseline.docHash,
 * bare !==). Assertions stay at the call/dialog layer.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { WorkbenchRecord } from '../../src/workbench-shared/protocol.js'
import type { WorkbenchController } from '../../src/client/workbench/controller.js'
import type { WorkbenchT } from '../../src/client/workbench/dictionary.js'
import { workbenchZh } from '../../src/client/workbench/dictionary.js'
import { PlanningSection } from '../../src/client/workbench/planning-section.js'

const RID = '11111111-1111-4111-8111-111111111111'
const WS = 'C:\\ws\\需求'
const AT = '2026-10-15T08:00:00.000Z'

const bindZh = (): WorkbenchT => (key) => (workbenchZh as unknown as Record<string, string>)[key] ?? key

function record(overrides: Partial<WorkbenchRecord> = {}): WorkbenchRecord {
  return {
    requirementId: RID,
    stage: 'plan',
    stageHistory: [{ stage: 'plan', at: AT }],
    criteria: [],
    findings: [],
    workPackages: [],
    releaseItems: [],
    reviewReports: [],
    knowledgeCandidates: [],
    ...overrides,
  }
}

function fakeController(impl: () => Promise<unknown>): WorkbenchController & { planningDocContent: ReturnType<typeof vi.fn>; adoptPlan: ReturnType<typeof vi.fn>; revokePlanAdoption: ReturnType<typeof vi.fn> } {
  return {
    planningDocContent: vi.fn(impl),
    adoptPlan: vi.fn(async () => true),
    revokePlanAdoption: vi.fn(async () => true),
  } as never
}

const slot = (rec: WorkbenchRecord) => ({ phase: 'ready', revision: 3, record: rec, planFileExists: [], reviewFileExists: [], releaseDrifted: [], busy: false }) as never

afterEach(() => {
  cleanup()
})

describe('0012 S2 技术规划卡片（采纳软门）', () => {
  it('未采纳 ⇒ 卡片 + [生成规划任务书] + [采纳规划]；ack 开门即探测、勾选门控、确认调用 adoptPlan(RID)', async () => {
    const controller = fakeController(async () => ({ kind: 'ok', content: '# 技术规划', contentTampered: false }))
    render(<PlanningSection t={bindZh()} slot={slot(record())} controller={controller} requirementId={RID} workspacePath={WS} record={record()} />)

    await waitFor(() => expect(controller.planningDocContent).toHaveBeenCalledTimes(1)) // 存在性探测
    expect(screen.getByRole('button', { name: workbenchZh['sow.planButton'] })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['planning.adoptButton'] }))
    const dialog = await screen.findByRole('dialog', { name: workbenchZh['planning.adoptTitle'] })
    await waitFor(() => expect(within(dialog).getByText(workbenchZh['planning.ackDocWillAnchor'])).toBeTruthy()) // 探测结果披露
    // 勾选门控：未勾选时确认禁用。
    const confirm = within(dialog).getByRole('button', { name: workbenchZh['planning.adoptConfirm'] })
    expect(confirm.hasAttribute('disabled')).toBe(true)
    fireEvent.click(within(dialog).getByRole('checkbox'))
    expect(confirm.hasAttribute('disabled')).toBe(false)
    fireEvent.click(confirm)
    await waitFor(() => expect(controller.adoptPlan).toHaveBeenCalledWith(RID))
  })

  it('探测 no-doc（undefined）⇒ ack 披露 ackNoDoc（软门：采纳仍成立）', async () => {
    const controller = fakeController(async () => undefined)
    render(<PlanningSection t={bindZh()} slot={slot(record())} controller={controller} requirementId={RID} workspacePath={WS} record={record()} />)
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['planning.adoptButton'] }))
    const dialog = await screen.findByRole('dialog', { name: workbenchZh['planning.adoptTitle'] })
    await waitFor(() => expect(within(dialog).getByText(workbenchZh['planning.ackNoDoc'])).toBeTruthy())
  })

  it('已采纳 ⇒ gonogo 横幅（已采纳 + 日期）+ [撤销采纳] 勾选确认调用 revokePlanAdoption；无 stale 徽章（上游锚一致）', async () => {
    const controller = fakeController(async () => ({ kind: 'ok', content: '# 技术规划', contentTampered: false }))
    const adopted = record({
      planAdoptedAt: AT,
      planBaseline: { at: AT, docHash: 'p'.repeat(64), requirementDocHash: 'r'.repeat(64) },
      understandApprovedAt: AT,
      understandBaseline: { at: AT, criteria: [], findings: [], clarifications: [], docHash: 'r'.repeat(64) },
    })
    render(<PlanningSection t={bindZh()} slot={slot(adopted)} controller={controller} requirementId={RID} workspacePath={WS} record={adopted} />)

    expect(screen.queryByRole('button', { name: workbenchZh['planning.adoptButton'] })).toBeNull()
    expect(screen.getByText(workbenchZh['planning.adoptedTag'])).toBeTruthy()
    expect(screen.queryByText(workbenchZh['planning.staleBadge'])).toBeNull() // 上游一致 ⇒ 安静
    fireEvent.click(screen.getByRole('button', { name: workbenchZh['planning.revokeButton'] }))
    const dialog = await screen.findByRole('dialog', { name: workbenchZh['planning.revokeTitle'] })
    fireEvent.click(within(dialog).getByRole('checkbox'))
    fireEvent.click(within(dialog).getByRole('button', { name: workbenchZh['planning.revokeConfirm'] }))
    await waitFor(() => expect(controller.revokePlanAdoption).toHaveBeenCalledWith(RID))
  })

  it('上游基线变更（requirementDocHash 与现行 understandBaseline.docHash 不一致）⇒ stale 徽章', async () => {
    const controller = fakeController(async () => ({ kind: 'ok', content: '# 技术规划', contentTampered: false }))
    const stale = record({
      planAdoptedAt: AT,
      planBaseline: { at: AT, docHash: 'p'.repeat(64), requirementDocHash: 'r'.repeat(64) },
      understandApprovedAt: AT,
      understandBaseline: { at: AT, criteria: [], findings: [], clarifications: [], docHash: 'z'.repeat(64) }, // 重定稿换锚
    })
    render(<PlanningSection t={bindZh()} slot={slot(stale)} controller={controller} requirementId={RID} workspacePath={WS} record={stale} />)
    expect(screen.getByText(workbenchZh['planning.staleBadge'])).toBeTruthy()
  })

  it('无工作区 ⇒ 卡片区诚实提示 + 采纳按钮仍在（ackNoDoc 路径），零探测 fetch', async () => {
    const controller = fakeController(async () => ({ kind: 'ok', content: '#', contentTampered: false }))
    render(<PlanningSection t={bindZh()} slot={slot(record())} controller={controller} requirementId={RID} workspacePath="" record={record()} />)
    expect(screen.getByText(workbenchZh['planning.noWorkspace'])).toBeTruthy()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(controller.planningDocContent).not.toHaveBeenCalled()
  })
})
